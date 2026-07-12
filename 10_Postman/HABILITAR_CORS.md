# Habilitar CORS en las rutas que fallan ("CORS/Red" en el runner)

Los 12 endpoints que salieron `http:0` / "Failed to fetch" **no tienen la lambda rota**: les
falta responder con el header `Access-Control-Allow-Origin`, así que el navegador (que corre el
`test-runner.html` desde `file://`) bloquea la respuesta. Las rutas que ya funcionan sí tienen CORS.

## Rutas a habilitar
`/Security/Refresh-token`, `/Security/Verify-code`, `/Template/Get-template`,
`/Template/Delete-template`, `/Campaign/Update`, `/Blacklist/Delete`, `/Customer/Update`,
`/Report` (state-report), `/Email/Send-batch-template-samples`, `/Email/Send-batch-template`,
`/Email/Send-ondemand-template`, `/Database/Delete`.

> Nota: varias de estas además pueden **no estar desplegadas todavía** (backlog `[J]`). Si al
> habilitar CORS siguen fallando con 403 "Missing Authentication Token", es que **la ruta/method
> no existe** en API Gateway → hay que crearla (recurso + método POST + integración a la lambda +
> authorizer) y luego CORS.

## Opción A — Consola (lo más rápido)
Por cada recurso de la lista:
1. API Gateway → tu API → **Resources** → selecciona el recurso (p. ej. `/Campaign/Update`).
2. **Actions → Enable CORS**.
3. Deja `Access-Control-Allow-Origin: *` (o el origen del portal) y agrega
   `Access-Control-Allow-Headers: Content-Type,Authorization`.
4. **Actions → Deploy API** al stage en uso (`V1`/`Test`).

Esto crea el método `OPTIONS` (preflight) y agrega los headers a las respuestas del método.

## Opción B — CLI (para automatizar; REST API v1)
Para CADA `(RESOURCE_ID, "POST")` hay que: (1) añadir el header CORS a la *method response* y
*integration response* del POST, y (2) crear el método `OPTIONS` con integración MOCK. Esqueleto:

```bash
API_ID=xxxxxxxxxx           # tu id de API Gateway
STAGE=V1                    # o Test
RID=zzzzzzz                 # resourceId del recurso (aws apigateway get-resources)
ORIGIN="'*'"

# 1) Header CORS en la respuesta del POST existente
aws apigateway update-method-response --rest-api-id $API_ID --resource-id $RID \
  --http-method POST --status-code 200 \
  --patch-operations op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value=true
aws apigateway update-integration-response --rest-api-id $API_ID --resource-id $RID \
  --http-method POST --status-code 200 \
  --patch-operations op=add,path=/responseParameters/method.response.header.Access-Control-Allow-Origin,value=$ORIGIN

# 2) Método OPTIONS (preflight) con MOCK
aws apigateway put-method --rest-api-id $API_ID --resource-id $RID \
  --http-method OPTIONS --authorization-type NONE
aws apigateway put-integration --rest-api-id $API_ID --resource-id $RID \
  --http-method OPTIONS --type MOCK \
  --request-templates '{"application/json":"{\"statusCode\":200}"}'
aws apigateway put-method-response --rest-api-id $API_ID --resource-id $RID \
  --http-method OPTIONS --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Origin":true,"method.response.header.Access-Control-Allow-Headers":true,"method.response.header.Access-Control-Allow-Methods":true}'
aws apigateway put-integration-response --rest-api-id $API_ID --resource-id $RID \
  --http-method OPTIONS --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Origin":"'"'"'*'"'"'","method.response.header.Access-Control-Allow-Headers":"'"'"'Content-Type,Authorization'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'POST,OPTIONS'"'"'"}'
done  # (envuélvelo en un for por cada recurso)

# 3) Redeploy
aws apigateway create-deployment --rest-api-id $API_ID --stage-name $STAGE
```

## Producción
En prod, restringe `Access-Control-Allow-Origin` al dominio real del portal (no `*`) y añade solo
los headers/métodos necesarios.

## Otras acciones (no-CORS) de la corrida
- **Create-OTP → 500:** crear la tabla `oneTimePassword` (PK `oneTimePasswordId`) y dar
  `dynamodb:PutItem` a la lambda.
- **MessageTemplate/Create → 200 sin id:** **redeployar** la lambda (el repo ya devuelve 201 + id).
