#!/usr/bin/env bash
#
# Sincroniza la configuración de API Gateway (REST) desde el repo:
#   1) aplica el mapping template de rol/tenant a las rutas admin (POST, no-proxy),
#   2) pone headers CORS en las respuestas de error (DEFAULT_4XX/5XX) para no
#      enmascarar los errores como CORS,
#   3) (opcional) adjunta el Authorizer a esas rutas,
#   4) despliega la API al stage.
#
# Idempotente: se puede correr las veces que sea. Lo usa el workflow deploy-api.yml
# en cada push, o se puede correr a mano:
#
#   API_ID=xxxxx STAGE=V1 PREFIX="" AUTHORIZER_ID=abr9e7 ./scripts/sync-api.sh
#
# Variables:
#   API_ID         (obligatoria) id de la REST API
#   STAGE          stage a desplegar (default: V1)
#   PREFIX         prefijo de los resource paths (default: ""; usa "/V1" si aplica)
#   AUTHORIZER_ID  (opcional) si se define, adjunta ese authorizer a cada ruta
#   ROUTES_FILE    (default: infra/api/admin-routes.txt)
#   CORS_ORIGIN    (default: *)  origen permitido en las respuestas de error
#
# Requisitos: AWS CLI v2 + python3. Permisos apigateway:* sobre la API.

set -euo pipefail

API_ID="${API_ID:?Define API_ID=<rest-api-id>}"
STAGE="${STAGE:-V1}"
PREFIX="${PREFIX:-}"
AUTHORIZER_ID="${AUTHORIZER_ID:-}"
ROUTES_FILE="${ROUTES_FILE:-infra/api/admin-routes.txt}"
CORS_ORIGIN="${CORS_ORIGIN:-*}"

echo "API_ID=$API_ID  STAGE=$STAGE  PREFIX='$PREFIX'  AUTHORIZER_ID='${AUTHORIZER_ID:-<none>}'"

# --- Mapping template: body como objeto JSON crudo + context del Authorizer -------
# (comillas simples: bash NO expande los $ de VTL)
read -r -d '' TEMPLATE <<'VTL' || true
{
  "body": $input.json('$'),
  "requestContext": {
    "authorizer": {
      "role": "$context.authorizer.role",
      "user": "$context.authorizer.user",
      "userId": "$context.authorizer.userId",
      "customerId": "$context.authorizer.customerId",
      "customer": "$context.authorizer.customer"
    }
  }
}
VTL

# patch-operations como JSON (python escapa el template con comas/comillas/saltos) --
PATCH_JSON="$(TEMPLATE="$TEMPLATE" python3 -c '
import json, os
print(json.dumps([
  {"op": "replace", "path": "/requestTemplates/application~1json", "value": os.environ["TEMPLATE"]},
  {"op": "replace", "path": "/passthroughBehavior", "value": "WHEN_NO_TEMPLATES"},
]))')"

echo "Cargando recursos de la API…"
RESOURCES_JSON="$(aws apigateway get-resources --rest-api-id "$API_ID" --limit 500)"

apply_route() {
  local path="$1"
  local res_id
  res_id="$(RES="$RESOURCES_JSON" P="$path" python3 -c '
import json, os
items = json.loads(os.environ["RES"])["items"]
m = [i for i in items if i.get("path") == os.environ["P"]]
print(m[0]["id"] if m else "")')"
  if [[ -z "$res_id" ]]; then
    echo "  ⚠️  $path → recurso no encontrado (revisa PREFIX). Saltando."
    return
  fi

  # 1) mapping template en la integración POST
  aws apigateway update-integration \
    --rest-api-id "$API_ID" --resource-id "$res_id" --http-method POST \
    --patch-operations "$PATCH_JSON" >/dev/null

  # 2) (opcional) adjuntar el authorizer al método
  if [[ -n "$AUTHORIZER_ID" ]]; then
    aws apigateway update-method \
      --rest-api-id "$API_ID" --resource-id "$res_id" --http-method POST \
      --patch-operations \
        op=replace,path=/authorizationType,value=CUSTOM \
        op=replace,path=/authorizerId,value="$AUTHORIZER_ID" >/dev/null || \
      echo "     (no se pudo adjuntar authorizer a $path; revísalo a mano)"
  fi
  echo "  ✅ $path (resource $res_id)"
}

echo "Aplicando mapping template a las rutas admin…"
while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs || true)"
  [[ -z "$line" ]] && continue
  apply_route "${PREFIX}${line}"
done < "$ROUTES_FILE"

# --- 3) CORS en respuestas de error (para no enmascarar 4xx/5xx como CORS) ---------
echo "Configurando CORS en Gateway Responses (DEFAULT_4XX/5XX)…"
RP_JSON="$(ORIGIN="$CORS_ORIGIN" python3 -c '
import json, os
q = chr(39)  # comilla simple (API Gateway exige el valor estático entre comillas simples)
o = os.environ["ORIGIN"]
print(json.dumps({
  "gatewayresponse.header.Access-Control-Allow-Origin":  q + o + q,
  "gatewayresponse.header.Access-Control-Allow-Headers": q + "Content-Type,Authorization" + q,
  "gatewayresponse.header.Access-Control-Allow-Methods": q + "POST,OPTIONS" + q,
}))')"
for RT in DEFAULT_4XX DEFAULT_5XX; do
  aws apigateway put-gateway-response --rest-api-id "$API_ID" \
    --response-type "$RT" --response-parameters "$RP_JSON" >/dev/null || \
    echo "  (no se pudo fijar CORS en $RT)"
  echo "  ✅ $RT"
done

# --- 4) Desplegar ------------------------------------------------------------------
echo "Desplegando al stage '$STAGE'…"
aws apigateway create-deployment --rest-api-id "$API_ID" --stage-name "$STAGE" \
  --description "sync-api: mapping template + CORS (${GITHUB_SHA:-manual})" >/dev/null
echo "Listo ✅"
