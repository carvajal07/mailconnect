# infra/api — API Gateway como código (IaC ligero)

La config de las rutas de API Gateway vive en **`routes.json`** y se aplica
**automáticamente desde GitHub** en cada push (`.github/workflows/deploy-api.yml`).
Motor: **`scripts/sync_api.py`** (Python + boto3), **idempotente** — crea lo que falte
y ajusta lo existente.

## Qué hace por cada ruta de `routes.json`

1. **Crea el árbol de recursos** si falta (p. ej. `/V1`, `/V1/Customer`, `/V1/Customer/List`).
2. **Crea el método** (POST por defecto), con Authorizer (`auth: true`) o público (`auth: false`).
3. **Configura la integración Lambda**: no-proxy con el **mapping template** de rol/tenant
   si `admin: true`; o `AWS_PROXY` si `proxy: true`.
4. **Crea el `OPTIONS`** de preflight con headers CORS (`cors: true`).
5. **Da permiso** a API Gateway para invocar la Lambda.

Al final: **CORS en Gateway Responses** (`DEFAULT_4XX/5XX`, para no enmascarar errores) y
**despliegue** al stage.

## `routes.json`

`prefix` (p. ej. `/V1`) + lista de `routes`. Campos por ruta:

| campo | default | qué hace |
|-------|---------|----------|
| `path` | — | ruta bajo el prefix (`/Customer/List`) |
| `lambda` | — | nombre de la función AWS |
| `method` | `POST` | método HTTP |
| `admin` | `false` | inyecta role/tenant (template) — endpoint solo-admin |
| `auth` | `true` | adjunta el Authorizer (público si `false`) |
| `proxy` | `false` | integración `AWS_PROXY` (la lambda controla la respuesta) |
| `cors` | `true` | crea el `OPTIONS` de preflight |

**Agregar una ruta nueva:** añade una entrada, haz push → se crea y configura sola.

## Disparo

- **Automático:** push a `main` que toque `infra/api/**` o `scripts/sync_api.py`.
- **Manual:** Actions → "Desplegar API (rutas)" → Run workflow (opción `plan_only` para
  previsualizar sin aplicar).
- **Local (preview):** `python scripts/sync_api.py --plan` (no toca AWS).
- **Local (aplicar):** `API_ID=<id> STAGE=V1 AUTHORIZER_ID=<id> python scripts/sync_api.py`.

## Configuración (una sola vez) — Settings → Secrets and variables → Actions

- **Secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (permisos `apigateway:*` +
  `lambda:AddPermission`).
- **Variables:** `API_ID` (obligatoria); `STAGE` (default `V1`); `PREFIX` (sobreescribe el
  de routes.json — para tu setup `/V1`); `AUTHORIZER_ID`; `AWS_REGION` (default us-east-1).

> **Tu estructura:** los recursos en API Gateway son `/V1/Customer/List` (V1 es un recurso),
> y el **stage** es aparte (en dev la URL trae `/Dev/V1/...`, en prod el custom domain mapea
> `/V1/...` sin stage). Por eso `PREFIX=/V1` y `STAGE` = tu stage de prod.

## Alcance — importante

Esto gestiona **solo la capa de API Gateway** (rutas, integración, CORS, authorizer, deploy).
**No** crea el resto de la infraestructura. Para un bootstrap de cuenta nueva "todo con un
comando" faltaría IaC de: tablas DynamoDB, **crear** las funciones Lambda, SES (dominio/
sandbox), SQS + triggers, S3, roles/políticas IAM, el layer de PyJWT y el custom domain +
certificado. Ese es el paso a **Terraform/CDK** (ver `DESPLIEGUE.md`).
