#!/usr/bin/env bash
#
# Aplica el mapping template de rol/tenant a TODAS las rutas admin (POST, no-proxy)
# de una sola pasada y despliega la API. Así no hay que editarlas una por una.
#
# Uso:
#   API_ID=xxxxxx STAGE=V1 ./scripts/apply-admin-mapping.sh
#
#   API_ID  = id de la REST API (API Gateway → tu API → arriba, o `aws apigateway get-rest-apis`)
#   STAGE   = nombre del stage a desplegar (por defecto: V1)
#   PREFIX  = prefijo de los resource paths en la API (por defecto: vacío).
#             Si tus recursos en API Gateway son /Customer/List → PREFIX="".
#             Si son /V1/Customer/List → PREFIX="/V1".
#
# Requisitos: AWS CLI v2 configurado con permisos apigateway:* sobre la API.
# Nota: NO adjunta el Authorizer (eso ya lo tienes). Solo pone el template + deploy.

set -euo pipefail

API_ID="${API_ID:?Define API_ID=<rest-api-id>}"
STAGE="${STAGE:-V1}"
PREFIX="${PREFIX:-}"

# Rutas admin (POST) que necesitan el context del Authorizer.
ROUTES=(
  "/Customer/List" "/Customer/Update" "/Customer/Detail" "/User/SetRole"
  "/Pricing/List" "/Pricing/Update" "/Billing/Summary"
  "/Admin/Dashboard" "/Admin/Jobs" "/Admin/Audit"
  "/Config/Get" "/Config/Set"
)

# Mapping template: body como objeto JSON crudo + context del Authorizer.
# Comillas simples: NO se expanden los $ en bash (son de VTL).
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

echo "API_ID=$API_ID  STAGE=$STAGE  PREFIX='$PREFIX'"
echo "Cargando recursos…"
RESOURCES_JSON="$(aws apigateway get-resources --rest-api-id "$API_ID" --limit 500)"

for route in "${ROUTES[@]}"; do
  path="${PREFIX}${route}"
  res_id="$(echo "$RESOURCES_JSON" | python3 -c "import sys,json;
items=json.load(sys.stdin)['items'];
m=[i for i in items if i.get('path')=='$path'];
print(m[0]['id'] if m else '')")"
  if [[ -z "$res_id" ]]; then
    echo "  ⚠️  $path → recurso no encontrado (revisa PREFIX). Saltando."
    continue
  fi
  # Poner el requestTemplate en la integración POST (path JSON-pointer: / => ~1).
  aws apigateway update-integration \
    --rest-api-id "$API_ID" --resource-id "$res_id" --http-method POST \
    --patch-operations \
      "op=replace,path=/requestTemplates/application~1json,value=$TEMPLATE" \
      "op=replace,path=/passthroughBehavior,value=WHEN_NO_TEMPLATES" \
    >/dev/null
  echo "  ✅ $path (resource $res_id)"
done

echo "Desplegando al stage '$STAGE'…"
aws apigateway create-deployment --rest-api-id "$API_ID" --stage-name "$STAGE" \
  --description "Mapping template de rol en rutas admin" >/dev/null
echo "Listo. Prueba con curl una ruta admin."
