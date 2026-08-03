#!/usr/bin/env bash
# Aplica la configuración de memoria/timeout de PROVISION.md §2.
#
#   ./scripts/config_lambdas.sh --dry-run    # muestra qué haría, sin tocar nada
#   ./scripts/config_lambdas.sh              # aplica
#
# ⚠️ Sube TAMBIÉN el VisibilityTimeout de las colas de los workers. Es obligatorio: si la
# función puede tardar 300 s y la cola libera el mensaje a los 360 s, al subir el timeout sin
# tocar la cola SQS re-entrega el lote mientras la primera invocación sigue trabajando.
# Regla de AWS: VisibilityTimeout >= 6 x timeout de la función.
#
# ⚠️ El CD (deploy-lambdas.yml) solo fija memoria/timeout al CREAR una función; no pisa lo
# que se configure aquí. Las lambdas nuevas nacerán con el default (256 MB / 60 s) y hay que
# volver a correr esto si caen en un grupo que no sea el A.
set -uo pipefail

DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

# ── Grupo B · agregadores y escaneos (techo de API Gateway: 29 s) ──────────
AGREGADORES=(Admin_Dashboard Admin_Control-center Admin_Jobs Admin_Audit Admin_Balances
  Admin_Recipient-lookup Billing_Summary Reports_Statistics Reports_Series
  Reports_state-report Portal_Bootstrap Agent_Reports Database_Verify)

# ── Grupo C · render de PDF síncrono (CPU pura: más memoria = más barato) ──
RENDER=(Template_Render-pdf Template_Render-engine Cost_Attachment-weight)

# ── Grupo D · workers de SQS: "lambda:memoria:timeout:cola:visibility" ─────
WORKERS=(
  "Email_Prepare-batch-template:1024:300:Email_Prepare-batch-part:1800"
  "Email_Send-batch-template-EM:512:120:Email_Send-batch-template-EM:900"
  "Email_Send-batch-template-EAU:1024:300:Email_Send-batch-raw-EAU:1800"
  "Email_Send-batch-template-EAP:1024:300:Email_Send-batch-raw-EAP:1800"
  "Template_Combination-EAP-PDF:2048:600:Template_Combination-EAP-PDF:3600"
  "Template_Combination:1024:300:Template_Combination-EAP:1800"
  "Sms_Send-batch:512:180:Sms_Send-batch:1080"
  "Wsp_Send-batch:512:180:Wsp_Send-batch:1080"
  "Voice_Send-batch:512:180:Voice_Send-batch:1080"
)

# ── Grupo E/F · crons, authorizers y públicas ─────────────────────────────
OTRAS=(
  "Notifications_Scan:1024:600" "Cascade_Advance:512:300"
  "Cron_DeleteTables:256:300" "SQS_DeleteTables:256:300"
  "Assistant_Ask:512:29" "Assistant_Copilot:512:29"
  "Email_ReceptionStatus:512:60" "Messaging_ReceptionStatus:512:60" "Wsp_ReceptionStatus:512:60"
  "Wallet_Wompi-webhook:256:30"
)
AUTHORIZERS=(Authorizer Authorizer2)   # sin prefijo Api_V1_

# ── Grupo D (bis) · concurrencia RESERVADA: es un TOPE y es GRATIS. Evita que
# una campaña grande se coma la concurrencia de la cuenta y deje el portal sin
# responder (ver PROVISION.md §4.3).
RESERVADA=(
  "Email_Send-batch-template-EM:50" "Email_Send-batch-template-EAU:20"
  "Email_Send-batch-template-EAP:20" "Template_Combination:10"
  "Template_Combination-EAP-PDF:10" "Sms_Send-batch:20"
  "Email_Prepare-batch-template:20"
)

fn() { [[ "$1" == Authorizer* ]] && echo "$1" || echo "Api_V1_$1"; }

aplicar() {
  local nombre mem to
  nombre=$(fn "$1"); mem=$2; to=$3
  if [[ $DRY -eq 1 ]]; then
    printf '  [dry] %-46s %5s MB  %4s s\n' "$nombre" "$mem" "$to"; return
  fi
  if aws lambda update-function-configuration --function-name "$nombre" \
       --memory-size "$mem" --timeout "$to" >/dev/null 2>&1; then
    printf '  ✅ %-46s %5s MB  %4s s\n' "$nombre" "$mem" "$to"
  else
    # No se aborta: una función que aún no existe en AWS no debe frenar al resto.
    printf '  ⚠️  %-46s NO se pudo (¿no existe todavía?)\n' "$nombre"
  fi
}

cola_visibility() {
  local cola=$1 vis=$2 url
  if [[ $DRY -eq 1 ]]; then printf '  [dry] cola %-38s visibility=%s\n' "$cola" "$vis"; return; fi
  url=$(aws sqs get-queue-url --queue-name "$cola" --query QueueUrl --output text 2>/dev/null)
  if [[ -z "$url" || "$url" == "None" ]]; then
    printf '  ⚠️  cola %-38s no existe\n' "$cola"; return
  fi
  aws sqs set-queue-attributes --queue-url "$url" \
      --attributes "VisibilityTimeout=$vis" >/dev/null 2>&1 \
    && printf '  ✅ cola %-38s visibility=%s\n' "$cola" "$vis" \
    || printf '  ⚠️  cola %-38s NO se pudo\n' "$cola"
}

echo "── Grupo B · agregadores (1024 MB / 29 s)"
for l in "${AGREGADORES[@]}"; do aplicar "$l" 1024 29; done

echo "── Grupo C · render de PDF (2048 MB / 29 s)"
for l in "${RENDER[@]}"; do aplicar "$l" 2048 29; done

echo "── Grupo D · workers del pipeline + visibility de sus colas"
for e in "${WORKERS[@]}"; do
  IFS=: read -r l mem to cola vis <<< "$e"
  aplicar "$l" "$mem" "$to"
  cola_visibility "$cola" "$vis"
done

echo "── Grupos E/F · crons, públicas y authorizers"
for e in "${OTRAS[@]}"; do IFS=: read -r l mem to <<< "$e"; aplicar "$l" "$mem" "$to"; done
for l in "${AUTHORIZERS[@]}"; do aplicar "$l" 256 10; done

echo "── Concurrencia reservada (tope; no cuesta nada)"
for e in "${RESERVADA[@]}"; do
  IFS=: read -r l n <<< "$e"; nombre=$(fn "$l")
  if [[ $DRY -eq 1 ]]; then printf '  [dry] %-46s reservada=%s\n' "$nombre" "$n"; continue; fi
  aws lambda put-function-concurrency --function-name "$nombre" \
      --reserved-concurrent-executions "$n" >/dev/null 2>&1 \
    && printf '  ✅ %-46s reservada=%s\n' "$nombre" "$n" \
    || printf '  ⚠️  %-46s NO se pudo\n' "$nombre"
done

cat <<'FIN'

── Grupo A · el resto (~95 lambdas de API ligera)
   Se dejan en el default del CD (256 MB / 60 s), que funciona. Si quieres bajarlas a
   256 MB / 15 s —falla rápido en vez de dejar al usuario esperando por algo ya colgado—:

     for f in $(aws lambda list-functions --query 'Functions[?starts_with(FunctionName,`Api_V1_`)].FunctionName' --output text); do
       aws lambda update-function-configuration --function-name "$f" --timeout 15 >/dev/null
     done

   ⚠️ Ese bucle toca TODAS las Api_V1_*, así que hay que correrlo ANTES que este script
   (si no, pisa los timeouts altos de los workers).
FIN
