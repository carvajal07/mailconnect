# infra/terraform — Infraestructura completa como código (Terraform)

Declara **toda** la infraestructura de MailConnect: DynamoDB, Lambdas (las ~60,
descubiertas solas), IAM, SQS + triggers, API Gateway (rutas + authorizer + CORS,
desde el **mismo `routes.json`** del IaC ligero), SES y S3.

> **Alcance vs. el IaC ligero (`infra/api`)**
> - `infra/api` (Python + `sync_api.py`) toca **solo API Gateway** sobre una cuenta que
>   **ya existe**. Es lo que corre en cada push y lo que necesitas hoy.
> - `infra/terraform` (esto) es el **bootstrap completo** para reproducir la plataforma
>   en una **cuenta nueva** con un `apply`. Es un proyecto de fondo, más pesado.

---

## ⚠️ Léelo antes de aplicar: cuenta NUEVA vs. cuenta EXISTENTE

Terraform **crea** recursos y **es dueño** de lo que crea (los guarda en su *state*).

- **Cuenta nueva (vacía):** `terraform apply` crea todo. Este es el caso ideal.
- **Tu cuenta actual (todo ya existe):** un `apply` directo **fallaría** ("ya existe")
  o querría **recrear** cosas. Para adoptar recursos existentes hay que **`terraform import`**
  cada uno (tablas, lambdas, API, colas…) al state, y ajustar las claves/nombres para que
  el *plan* quede en cero. Es trabajo cuidadoso y se hace **una vez**. No corras `apply`
  contra tu cuenta de producción sin antes importar y revisar `terraform plan`.

**Recomendación:** valida este módulo primero en una cuenta/sandbox nueva. Para producción,
migra por partes con `import` (empieza por lo de menor riesgo: colas, luego lambdas).

---

## Estructura

| archivo | qué declara |
|---------|-------------|
| `versions.tf` | Terraform + providers + (opcional) backend S3 de estado remoto |
| `variables.tf` | todas las variables (región, API, secretos, dominios…) |
| `locals.tf` | descubrimiento de lambdas, env común, y rutas leídas de `routes.json` |
| `iam.tf` | rol de ejecución de las lambdas + política de la app |
| `dynamodb.tf` | tablas del plano de control (fijas) |
| `sqs.tf` | colas por canal + DLQ + event source mappings |
| `lambda.tf` | empaqueta y crea **todas** las funciones + layer PyJWT |
| `apigateway.tf` | REST API, árbol de recursos, authorizer, integraciones, CORS, deploy |
| `ses.tf` | identidad de dominio + DKIM (opcional) |
| `s3.tf` | bucket de salida (opcional) |
| `outputs.tf` | ids útiles (api_id, authorizer_id, invoke_url…) |

Las **rutas** salen de `../api/routes.json` (la misma fuente que el IaC ligero). Añade una
ruta ahí y tanto Terraform como el workflow la crean. Hoy ese archivo trae las 12 rutas
admin; a medida que agregues el resto del portal, Terraform las cubre también.

## Requisitos previos (una vez)

1. **Layer de PyJWT.** Constrúyelo y apunta `pyjwt_layer_zip`:
   ```bash
   mkdir -p infra/terraform/layers/build/python
   pip install PyJWT -t infra/terraform/layers/build/python
   (cd infra/terraform/layers/build && zip -r ../pyjwt.zip python)
   ```
   Luego en `terraform.tfvars`: `pyjwt_layer_zip = "./layers/pyjwt.zip"`.
2. **Estado remoto (recomendado).** Crea el bucket + tabla de locks y descomenta el
   bloque `backend "s3"` de `versions.tf`:
   ```bash
   aws s3 mb s3://mailconnect-tfstate
   aws dynamodb create-table --table-name mailconnect-tflock \
     --attribute-definitions AttributeName=LockID,AttributeType=S \
     --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST
   ```
3. **Secreto JWT** fuera del archivo:
   ```bash
   export TF_VAR_secret_key="<clave NUEVA de 32+ bytes>"
   ```

## Uso

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars   # ajusta valores
terraform init
terraform plan      # revisa SIEMPRE antes de aplicar
terraform apply
```

Salidas útiles tras el apply: `api_id`, `authorizer_id`, `invoke_url`, `ses_dkim_tokens`.
Si algún día vuelves al IaC ligero, usa `api_id`/`authorizer_id` como Variables del workflow.

## Lo que Terraform NO hace por ti (aún es manual)

- **Sacar SES del sandbox** (es una solicitud a soporte de AWS) y verificar el remitente.
- **Custom domain + certificado ACM** de `api.mailconnect.com.co` (se puede añadir; no está
  para no acoplar el módulo a tu DNS/dominio). Hoy las salidas dan la `invoke_url` del stage.
- **Orígenes de End User Messaging** (números SMS/voz, WABA de WhatsApp, plantillas HSM de Meta):
  son registros/aprobaciones externas; solo se referencian por env (`channel_env`).
- **Tablas por-tenant** (`{customer}_blackList`, `{customer}_unsubscribe`,
  `{customer}_sendStatus_*`): las crean las lambdas en runtime por cliente, no Terraform.

## Notas de precisión

- Las **claves** de las tablas se infirieron del código. Tres están marcadas `# VERIFICAR`
  en `dynamodb.tf` (`document`, `channel`, `oneTimePasswordAudit`): confírmalas contra la
  tabla real antes de un `import`.
- Todas las funciones reciben el **mismo set de env vars** (las que no usan, las ignoran).
  Si quieres env por-función, parametriza `aws_lambda_function.this` con un mapa por nombre.
- Este módulo **no** fue aplicado contra AWS desde aquí (sin acceso de red). Corre
  `terraform validate` y `terraform plan` en tu entorno antes del primer `apply`.
