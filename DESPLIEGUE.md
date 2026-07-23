# DESPLIEGUE.md — Checklist de salida a producción (panel admin + pendientes)

> **Propósito:** lista **accionable y consolidada** de todo lo que falta para que lo
> construido funcione en AWS, más lo que queda pendiente **de mi lado (código)**.
> Complementa a `CLAUDE.md` (estado/contratos) y `README.md` (arquitectura).
>
> Marca `[x]` lo hecho, `[ ]` lo pendiente. `[J]` = tareas de despliegue (Jhon/infra).
> `[C]` = tareas de código (mi lado).
>
> _Región: `us-east-1`. Integración de las rutas de datos: **no-proxy** con envelope._

> **✅ Despliegue e infraestructura COMPLETADOS (2026-07-17):** todas las tareas [J] (tablas, GSIs, lambdas, rutas, IAM, mapping templates, provisión de admins) están desplegadas en AWS. Quedan solo, si acaso, tareas de código [C] (§8).

> **🆕 (jul 2026) Ya NO hace falta "crear la función vacía" antes del CD:** `deploy-lambdas.yml`
> ahora **crea la función si no existe** en AWS — siempre **Python 3.13** (handler
> `lambda_function.lambda_handler`) y con el **rol por convención** `Lambda_DynFull_...`
> (auto-detectado de los `boto3.client/resource` del código; override opcional en
> `04_Backend/lambdas/role-map.json`; si el rol no existe en IAM, el CD también lo crea con
> sus políticas full por servicio). Donde este documento diga "crear la función vacía",
> basta con correr el CD (push o manual). **También asegura los TRIGGERS** declarados en
> `04_Backend/lambdas/trigger-map.json` (pre-llenado con las 9 colas del pipeline): crea la
> **cola SQS** si no existe + el **event source mapping** cola→lambda (y fuerza el token
> `_SQS` en el rol), y opcionalmente tópicos **SNS** (tópico + permiso + suscripción) y
> reglas **EventBridge** (`schedule`). Donde este documento diga "crear la cola + trigger",
> basta con desplegar esa carpeta por el CD. **Siguen siendo manuales:** variables de
> entorno, layers, rutas de API Gateway y apuntar los config sets (SES/EUM) a los tópicos
> SNS. El usuario IAM de CI necesita los permisos extra listados en la cabecera del workflow
> (`lambda:CreateFunction/CreateEventSourceMapping/AddPermission`, `iam:CreateRole/
> AttachRolePolicy/PutRolePolicy/PassRole`, `sqs:CreateQueue`, …) — agregarlos ANTES del
> próximo push que toque lambdas con trigger.

---

## 0. TL;DR — el orden correcto

> **Estado (jul 2026):** ✅ Mapping template de context desplegado (`API_ID`/`AUTHORIZER_ID`/
> `STAGE`/`PREFIX` configuradas + `deploy-api.yml` corrido) → aislamiento multi-tenant activo.
> ✅ `SECRET_KEY` rotada. ✅ SES en producción. ✅ Despliegue del **monedero PREPAGO** completo.
> **✅ Despliegue `[J]` COMPLETO (2026-07-17):** los **GSIs + tablas** de DynamoDB pendientes (§2)
> ya están creados; todas las tareas de infraestructura `[J]` (tablas, GSIs, lambdas, rutas, IAM,
> mapping templates, provisión de admins) están desplegadas en AWS. Quedan solo, si acaso,
> tareas de código `[C]` (§8).

1. **Crear las 3 tablas DynamoDB nuevas** (§2).
2. **Crear las 10 lambdas nuevas vacías** (el CD las actualiza al hacer push) (§3).
3. **Crear sus rutas** en API Gateway, todas **admin-only** + **CORS** (§3, §5).
4. ✅ **Mapping template de rol** en TODAS las rutas no-proxy (§1) — **desplegado**.
5. **Dar los permisos IAM** por lambda (§3, §4).
6. **Redesplegar las 4 lambdas modificadas** (config + auditoría) (§4).
7. **Promover a `admin`** al menos un usuario en la tabla `user` (§6).

---

## 1. ⚠️ BLOQUEANTE — Mapping template de rol (rutas admin no-proxy)

Las rutas admin son **no-proxy**: la lambda **solo recibe lo que el mapping template
inyecta**. Hoy no se está pasando el `role`, por eso el panel da 403. En el
**Integration Request** de cada ruta admin, con `Content-Type: application/json`,
usa este **body mapping template**:

```velocity
{
  "body": $input.json('$'),
  "requestContext": {
    "authorizer": {
      "role": "$context.authorizer.role",
      "user": "$context.authorizer.user",
      "userId": "$context.authorizer.userId",
      "customerId": "$context.authorizer.customerId",
      "customer": "$context.authorizer.customer",
      "nit": "$context.authorizer.nit",
      "tenantRole": "$context.authorizer.tenantRole"
    }
  }
}
```

> **Body como OBJETO JSON crudo** (`$input.json('$')`), sin escapes. Es VTL limpio y
> siempre produce JSON válido. Las lambdas (`_get_payload`) aceptan el body como
> **objeto** (este template) o como **string** (proxy), así que funciona en ambos casos.
> ⚠️ Requiere el código con `_get_payload` actualizado (soporta body dict). Si aún
> corres una versión vieja de las lambdas, **redespliégalas** antes de usar este template.
>
> `role` habilita el acceso; `user`/`userId` identifican al **actor en la auditoría**;
> `customerId`/`customer` sirven al multi-tenant de las read-lambdas; **`nit`** (companyTin) es
> la **llave de las tablas por cliente** (`{tenant_key(nit)}_sendStatus`, …, ver §11). Si el
> `nit` no llega, las read-lambdas de cliente (Statistics/Bootstrap/Blacklist/state-report) no
> encuentran las tablas del tenant. **`deploy-api.yml`/`sync_api.py` ya lo inyectan** — si el
> template está a mano, agrégale la línea `nit`.
>
> **⚠️ `tenantRole` (RBAC de sub-rol) — nuevo, obligatorio (jul 2026):** sin esta línea, los
> gates `Campaign_Approve`/`Reject`, `Schedule_Create` y el **envío REAL** (`Prepare-batch`)
> ahora hacen **fail-CLOSED** (default menor privilegio) → un owner/approver legítimo recibiría
> **403** al aprobar o enviar. Antes su ausencia hacía lo contrario (todos tratados como owner →
> bypass del maker-checker). `sync_api.py` ya la inyecta; si aplicas el template a mano en alguna
> ruta, **incluye `tenantRole`**. Redespliega el template (`deploy-api.yml`) junto con las lambdas.
>
> **No pasar estas rutas a proxy:** las lambdas devuelven el envelope
> `{status, statusCode, description, data}` en el cuerpo (estilo no-proxy). En proxy
> API Gateway esperaría `{statusCode, headers, body}` y daría 502. Quédate en **no-proxy**.
>
> _Nota: la versión anterior de este doc usaba `escapeJavaScript(...).replaceAll(...)`
> para pasar el body como string; era frágil (400 por VTL). Con `_get_payload` aceptando
> objeto, esta forma cruda es la recomendada._

- [x] `[J]` **DESPLEGADO** — las variables `API_ID`/`AUTHORIZER_ID`/`STAGE`/`PREFIX` están
  configuradas y `deploy-api.yml` corrió y aplicó el mapping template de context (rol/tenant)
  a TODAS las rutas no-proxy autenticadas (cliente y admin). El aislamiento multi-tenant ya
  está activo end-to-end.

### ¿Hay que ponerlo a mano en cada ruta? No — se despliega desde GitHub

**IaC ligero (implementado):** la config de las rutas vive en **`infra/api/routes.json`** y el
workflow **`.github/workflows/deploy-api.yml`** (motor `scripts/sync_api.py`, Python+boto3) la
aplica en cada push. **Crea recursos/métodos/integración/OPTIONS/permisos que falten** y ajusta
lo existente (idempotente) + CORS de errores + deploy. Ver **`infra/api/README.md`**.
- **Setup 1 vez:** en Settings → Variables define `API_ID` (y `STAGE`/`PREFIX=/V1`/`AUTHORIZER_ID`);
  reusa los secrets AWS del CD de lambdas (el IAM necesita `apigateway:*` + `lambda:AddPermission`).
- **Uso:** editas `routes.json`, haces push, y se aplica solo. Preview: `python scripts/sync_api.py --plan`.
- **Crear rutas nuevas:** agrega una entrada a `routes.json` (path/lambda/flags) → se crea sola.
- **Catálogo COMPLETO (jul 2026):** `routes.json` era **fuente de verdad parcial** — le faltaban 16
  rutas que estaban configuradas **a mano** en la consola (o sin crear). Se **back-fillearon** todas
  para que el catálogo pueda reconstruir la API entera. Nuevas/nunca creadas: `/Assistant/Ask`
  (pública+proxy), `/Assistant/Copilot`, `/Cascade/Dispatch`, `/Cascade/List`, `/Report/State-report`
  (esta última venía con un bug: leía `idProceso` del root del evento, no de `event['body']` que
  anida el mapping template no-proxy → siempre 400; **corregido**). Ya en vivo (configuradas a mano)
  y ahora en el catálogo: las **9 `/Security/*`** (todas públicas salvo `Refresh-token` que va tras el
  Authorizer, y `Acount-activation` = GET/proxy/302) y las **2 `/Email/Send-batch-template[-samples]`**
  (proxy **obligatorio**: la lambda distingue muestras vs real por `event['resource']`).
  ⚠️ **Reconciliación:** el próximo `deploy-api.yml` re-aplicará esas 11 rutas en vivo. Los flags se
  verificaron contra el código, y `sync_api` es idempotente (flags correctos = no-op), pero **corre
  primero `deploy-api.yml` con `plan_only=true`** para revisar el plan antes de aplicar (toca el flujo
  de login/envíos).

**¿Cuenta nueva → un comando → todo? Todavía NO.** Este flujo cubre la **capa de API Gateway**.
Un bootstrap completo de cuenta necesita además IaC de: tablas DynamoDB, **crear** las funciones
Lambda (el CD solo actualiza código), SES (dominio/sandbox), SQS + triggers, S3, roles/políticas
IAM, layer de PyJWT y custom domain + certificado. Ese es el salto a **Terraform/CDK** (abajo).

**Alternativa — Proxy (evita el template):** con integración **Lambda Proxy** el context y el
body llegan solos, pero hay que envolver las respuestas en `{statusCode, headers, body}` (cambio
de código en todas las lambdas). `routes.json` ya soporta `proxy: true` por ruta.

**Evolución — IaC completo (Terraform):** para reproducir una cuenta entera desde cero (todos
los recursos, no solo API Gateway), migrar a Terraform/CDK con estado remoto. Es el paso que da
el "cuenta nueva → apply → todo".

---

## 2. Tablas DynamoDB nuevas

| Tabla | PK | SK | Notas |
|-------|----|----|-------|
| `pricingRate` | `customerId` (S) | `channel` (S) | `customerId='*'` = tarifa global. La usan estimador, Pricing_* y Billing. |
| `platformConfig` | `configKey` (S) | — | `Config_Set` la crea sola si falta, pero mejor provisionarla. |
| `adminAudit` | `auditId` (S) | — | Bitácora de auditoría. Si no existe, el lector devuelve vacío y los escritores no rompen. |
| `messageIndex` | `messageId` (S) | — | Índice `messageId → {customer, processId, uniqueId}` que escribe `Wsp_Send-batch` y lee `Wsp_ReceptionStatus` (los recibos de Meta solo traen el messageId). |
| `campaignCounter` | `customerId` (S) | — | Contador ATÓMICO del consecutivo por cliente (evita consecutivos duplicados en creaciones concurrentes). `Create-campaign` lo siembra desde el valor legado. |

- [x] `[J]` Crear `pricingRate` (PK `customerId` + SK `channel`).
- [x] `[J]` Crear `platformConfig` (PK `configKey`).
- [x] `[J]` Crear `adminAudit` (PK `auditId`).
- [x] `[J]` Crear `messageIndex` (PK `messageId`) — para los estados de entrega de WhatsApp.
- [x] `[J]` Crear `campaignCounter` (PK `customerId`) — consecutivo atómico. Sin ella,
  `Create-campaign` cae al método legado (con su carrera); con ella, no hay duplicados.

### GSIs OBLIGATORIOS (escalabilidad por defecto — sin `USE_GSI`)

> ⚠️ **Cambio (jul 2026):** las list-lambdas **ya no** dependen de `USE_GSI`/`USER_EMAIL_GSI`.
> Consultan **SIEMPRE por Query** al índice (Projection ALL) y **FALLAN si el índice no existe**
> (no caen a Scan). Hay que **crear estos GSIs ANTES** de usar esas rutas. Ya declarados en
> `infra/terraform/dynamodb.tf`.

| Tabla | Índice | Llave del índice | Lo usa (por defecto) |
|-------|--------|------------------|----------------------|
| `campaign` | `customerId-index` | PK `customerId` (S) | `Campaign_List`, `Portal_Bootstrap` |
| `databaseFile` | `customerId-index` | PK `customerId` (S) | `Database_List`, `Portal_Bootstrap` |
| `messageTemplate` | `customerId-index` | PK `customerId` (S) | `MessageTemplate_List`, `Portal_Bootstrap` |
| `user` | `email-index` | PK `email` (S) | `Login` (`_find_user_by_email`) |
| `walletTransaction` | `customerId-createdAt-index` | PK `customerId` + SK `createdAt` (S) | `Balance_Get` (historial) |

- [x] `[J]` Crear los **5 GSIs** de la tabla (Projection ALL, On-Demand). Sin ellos, esas
  lambdas responden **500** (por diseño: la ausencia del índice se detecta, no se degrada a Scan).

> Todas en modo **On-Demand (PAY_PER_REQUEST)** salvo que prefieras capacidad provisionada.

---

## 3. Lambdas nuevas + rutas + permisos

Crear la **función vacía** (mismo nombre de la carpeta) antes del primer `push`, para
que el CD (`deploy-lambdas.yml`) la actualice. Todas las rutas son **POST**, **admin-only**,
integración **no-proxy** + **CORS** + el mapping template de §1.

| Lambda | Ruta | Permisos IAM (DynamoDB salvo nota) |
|--------|------|-----------------------------------|
| `Api_V1_Pricing_List` | `/Pricing/List` | `GetItem` sobre `pricingRate` |
| `Api_V1_Pricing_Update` | `/Pricing/Update` | `UpdateItem`/`GetItem` sobre `pricingRate`; `GetItem` sobre `customer` (nombre de empresa en la auditoría); `PutItem` sobre `adminAudit` |
| `Api_V1_Customer_Detail` | `/Customer/Detail` | `Scan` sobre `customer`, `user`, `userData` |
| `Api_V1_Customer_Delete` **🆕 (nuevo, post-2026-07-17)** | `/Customer/Delete` | `GetItem`/`DeleteItem` sobre `customer`; `Scan`/`DeleteItem` sobre `user`/`userData`; `PutItem` sobre `adminAudit`. Mapping template debe pasar `role` **y `customerId`** (guard de propia empresa) |
| `Api_V1_User_SetRole` | `/User/SetRole` | `GetItem`/`UpdateItem`/`Scan` sobre `user`; `PutItem` sobre `adminAudit` |
| `Api_V1_Billing_Summary` | `/Billing/Summary` | `Scan` sobre `customer`/`campaign`/`process`; `Query` sobre `*_sendStatus`; `GetItem` sobre `pricingRate` |
| `Api_V1_Admin_Dashboard` | `/Admin/Dashboard` | `Scan` sobre `customer`/`campaign`/`process`; `Query` sobre `*_sendStatus` |
| `Api_V1_Admin_Jobs` | `/Admin/Jobs` | `Scan` sobre `process`/`campaign`; `Query` sobre `*_sendStatus` (+ `GetItem` sobre `*_sendSummary` si `SEND_SUMMARY_READ`) |
| `Api_V1_Config_Get` | `/Config/Get` | `Scan` sobre `platformConfig` |
| `Api_V1_Config_Set` | `/Config/Set` | `PutItem`/`CreateTable`/`DescribeTable` sobre `platformConfig`; `PutItem` sobre `adminAudit` |
| `Api_V1_Admin_Audit` | `/Admin/Audit` | `Scan` sobre `adminAudit` |
| `Api_V1_Admin_Campaigns` | `/Admin/Campaigns` | `Scan` sobre `campaign`/`customer` |
| `Api_V1_Admin_Requeue` | `/Admin/Requeue` | `GetItem` sobre `process`; **`sqs:SendMessage`** sobre `Email_Prepare-batch-part`; `PutItem` sobre `adminAudit` |

### 3b. Programar envíos **🆕 (nuevo, post-2026-07-17)** — HORA EXACTA (EventBridge Scheduler one-shot)

> Disparo por **hora exacta**: `Schedule/Create` crea un **EventBridge Scheduler** de una sola vez
> por campaña (`at(...)`) cuyo target es `Api_V1_Schedule_Fire`. El schedule se autoelimina al
> dispararse. Requiere **un rol IAM que EventBridge Scheduler asuma** para invocar el Fire.

- [ ] `[J]` Tabla **`scheduledSend`** (PK `scheduleId` + GSI `customerId-index`, On-Demand) — la crea `Schedule/Create` on-demand, o créala a mano.
- [ ] `[J]` **Rol IAM `MailConnectSchedulerInvokeRole`** (nuevo): trust policy con principal `scheduler.amazonaws.com`; permiso `lambda:InvokeFunction` sobre `Api_V1_Schedule_Fire`. Su ARN va en la env `SCHEDULER_ROLE_ARN` de `Schedule_Create`.
- [ ] `[J]` `Api_V1_Schedule_Create` → ruta **`/Schedule/Create`** (client, authorizer + CORS + mapping template con `customerId`/`customer`/`nit`/`userId`/`tenantRole`). IAM: `Put/DescribeTable/CreateTable` sobre `scheduledSend`; `GetItem` sobre `campaign`; **`scheduler:CreateSchedule`** + **`iam:PassRole`** (sobre `MailConnectSchedulerInvokeRole`). Env: `SCHEDULER_FIRE_LAMBDA_ARN` (ARN de `Api_V1_Schedule_Fire`), `SCHEDULER_ROLE_ARN`, `SCHEDULER_GROUP` (opc, default `default`).
- [ ] `[J]` `Api_V1_Schedule_Fire` **(sin ruta de API)** — target del schedule. IAM: `GetItem`/`UpdateItem` sobre `scheduledSend`; `GetItem` sobre `campaign`; **`lambda:InvokeFunction`** sobre `Api_V1_Email_Prepare-batch-template`. Env `PREPARE_BATCH_FUNCTION` (si el nombre AWS difiere). No lleva trigger propio: lo invoca EventBridge Scheduler.
- [ ] `[J]` `Api_V1_Schedule_List` → ruta **`/Schedule/List`** (client). IAM: `Query` sobre `scheduledSend` (GSI).
- [ ] `[J]` `Api_V1_Schedule_Cancel` → ruta **`/Schedule/Cancel`** (client). IAM: `GetItem`/`UpdateItem` sobre `scheduledSend`; **`scheduler:DeleteSchedule`**. Env `SCHEDULER_GROUP` (opc).
- [ ] `[J]` (OPCIONAL) `Api_V1_Schedule_Dispatch` **(sin ruta)** — barrido de respaldo; conéctalo a una regla EventBridge de baja frecuencia (`rate(15 minutes)`) SOLO si quieres red de seguridad ante one-shots que no dispararon. IAM: `Scan`/`UpdateItem` sobre `scheduledSend`; `GetItem` sobre `campaign`; `lambda:InvokeFunction` sobre `Api_V1_Email_Prepare-batch-template`. Si confías en el one-shot, no lo despliegues.

### 3c. Plantillas PDF — generador + envío EAP-PDF **🆕 (nuevo, post-2026-07-17)**

> El editor de Plantillas PDF (HTML tipo Word) ya "habla" con el backend que **renderiza el PDF**.
> Dos lambdas comparten el mismo render `html_to_pdf` (xhtml2pdf); el código del render está
> **copiado** en ambas (convención del repo: sin imports compartidos entre lambdas).
> **Requisito común:** ambas necesitan un **Lambda layer con `xhtml2pdf` (+ reportlab, Pillow)**
> construido para el runtime de la función (igual que el layer de PyJWT en los Authorizers). Sin el
> layer, la lambda responde 500 "Falta la librería de render de PDF" (diagnosticable, no rompe).

- [ ] `[J]` **Layer PDF**: `xhtml2pdf==0.2.16` (+ `reportlab`, `Pillow`) empaquetado como layer para el
  runtime de las dos funciones. Alternativa: descomentar el `requirements.txt` de cada carpeta para
  bundlear en el zip — pero el Python de CI (deploy-lambdas) debe coincidir con el runtime (reportlab/
  Pillow traen wheels por versión de CPython).
- [ ] `[J]` `Api_V1_Template_Render-pdf` → ruta **`/Template/Render-pdf`** (client, authorizer + CORS +
  mapping template con `customerId`/`customer`/`nit`). Ya está en `infra/api/routes.json` → `deploy-api.yml`
  la crea. Crea la **función vacía** antes del primer CD. IAM: `GetItem` sobre `messageTemplate`;
  (si se usa `store=true`) S3 `PutObject`/`CreateBucket`/`HeadBucket` sobre el bucket del cliente.
  Es el endpoint del botón "Vista previa PDF" del editor.
- [ ] `[J]` `Api_V1_Template_Combination-EAP-PDF` **(sin ruta de API — trigger SQS)** — crea la función
  vacía + la **cola `Template_Combination-EAP-PDF`** (el nombre que ya usa Prepare-batch en `URL_SQS_EAP_PDF`)
  + el **trigger** cola→lambda. IAM: DynamoDB `Scan document`, `Scan`/`PutItem` sobre `{tenant}_processDetail`;
  S3 `GetObject` (plantilla) + `PutObject` (`attachment/{campaña}/{nombre}.pdf`) sobre el bucket del cliente;
  **`sqs:SendMessage`** a `Email_Send-batch-raw-EAP`. Env `URL_SQS_EAP` (opc; default apunta a esa cola).
- [ ] `[J]` **Redesplegar `Api_V1_Email_Send-batch-template-EAP`**: ahora usa `.pdf` (subtype
  `application/pdf`) cuando el mensaje trae `documentFormat=PDF`. La ruta DOCX no cambia — no requiere
  permisos nuevos.
- [ ] `[J]` **Adjuntos personalizados PRIVADOS** (seguridad): los combinadores DOCX/PDF ahora escriben
  el adjunto por destinatario en `personalized/{campaignId}/…` (privado) en vez de `attachment/` (público),
  y `Send-EAP` lee de ahí. **Redesplegar los 4**: `Template_Combination`, `Template_Combination-EAP-PDF`,
  `Send-batch-template-EAP`, `Security_Register` (se hace solo al push). **Sin IAM ni política nuevos**:
  la política pública solo cubre `attachment/*` y `resources/*`, así que `personalized/*` queda privado
  también en los **buckets existentes** (no hay migración). `Register` agrega el marcador `personalized/`
  solo a buckets nuevos (cosmético). Nota: un envío EAP en vuelo justo durante el redeploy podría no hallar
  el adjunto (combinador viejo→attachment, send nuevo→personalized); reintentar/reenviar lo resuelve.
- [x] `[C]` **Form de crear campaña** — hecho: `CampanasSection` con EAP + "Tipo de documento = PDF"
  muestra un selector de plantillas PDF (del backend + borradores locales), sube su HTML a S3
  (`attachment/`) y crea la campaña con `documentFormat=PDF` + ese adjunto. El combinador EAP-PDF lo consume.
- [x] `[C]` **Plantillas PDF persistidas** — hecho: `Api_V1_MessageTemplate_Create` acepta `channel=PDF`
  (guarda `html`); `List` las devuelve. El editor guarda/carga desde el backend (`messageTemplate`), así
  se comparten entre equipos. **No requiere infra nueva** (la tabla `messageTemplate` ya existe); las
  lambdas `MessageTemplate_Create/List` se redepliegan solas al hacer push (deploy-lambdas). El editor
  además espeja en localStorage como respaldo/offline.

### 3d. Cascada omnicanal — "entrega garantizada al menor costo" **🆕 (nuevo)**

> Orquestación por contacto: intenta el canal preferido/más barato y escala (correo→WhatsApp→SMS→voz)
> hasta confirmar entrega/lectura. Reutiliza los workers de envío, `sendStatus`/recibos, monedero y
> tarifas ya desplegados — solo agrega la capa de reglas. **El motor lo mueve un cron.**

- [ ] `[J]` Tablas **`cascadeRun`** (PK `cascadeRunId` + GSI `customerId-index`) y **`cascadeContact`**
  (PK `cascadeContactId` + GSI `cascadeRunId-index`), On-Demand — las crea `Cascade_Create` on-demand, o
  créalas a mano.
- [ ] `[J]` Crear las **6 funciones vacías** antes del primer CD: `Api_V1_Cascade_Create`, `_Start`,
  `_Status`, `_List`, `_Cancel`, `_Tick`.
- [ ] `[J]` **Regla EventBridge `rate(5 minutes)` → `Api_V1_Cascade_Tick`** (el motor). Es lo que hace
  avanzar los envíos/escalamientos. `Cascade_Start` además invoca el Tick una vez para arranque inmediato
  (`lambda:InvokeFunction` sobre `Api_V1_Cascade_Tick`; env `CASCADE_TICK_FUNCTION` si el nombre AWS difiere).
- [ ] `[J]` Rutas `/Cascade/{Create,Start,Status,List,Cancel}` (client, authorizer + CORS + mapping de
  `customerId`/`customer`/`nit`). Ya están en `infra/api/routes.json` → `deploy-api.yml` las crea. El `Tick`
  **no** lleva ruta.
- [ ] `[J]` IAM del `Tick` (el que más permisos necesita): DynamoDB `Query`/`UpdateItem`/`Scan` sobre
  `cascadeRun`/`cascadeContact`; `UpdateItem` sobre `customerBalance` + `PutItem` sobre `walletTransaction`
  (débito/reembolso); `GetItem` sobre `pricingRate`; `Query`/`GetItem` sobre `{tenant}_sendStatus`,
  `{tenant}_sendDetail`, `{tenant}_blackList`, `{tenant}_unsubscribe` (patrón `*_sendStatus`, etc.);
  `CreateTable/DescribeTable` sobre `{tenant}_*` (los crea si faltan); **`sqs:SendMessage`** a las 4 colas
  de envío (`Email_Send-batch-template-EM`, `Sms_Send-batch`, `Wsp_Send-batch`, `Voice_Send-batch`).
  `Cascade_Create` además: `GetItem databaseFile`, S3 `GetObject` (la base CSV), `Put/BatchWrite` sobre
  `cascadeContact`/`cascadeRun`. `Status`/`List`/`Cancel`: `Query`/`GetItem`/`UpdateItem` sobre las 2 tablas.
- [ ] `[J]` Los envíos de la cascada escriben en las tablas por tenant que ya usan los workers
  (`{tenant}_sendStatus`, y para correo `{tenant}_processDetail`/`_sendDetail`); el `Tick` las crea si no
  existen, pero si un tenant nunca ha enviado, el primer arranque puede tardar un tick en quedar `ACTIVE`.

### 3e. SEGURIDAD: registro por NIT + equipo del cliente **🆕 (nuevo)**

> **Bug crítico corregido:** `Register` reutilizaba el `customerId` si el NIT ya existía → cualquiera que
> supiera el NIT (semi-público) se registraba y quedaba dentro del tenant de otra empresa como owner.

- [ ] `[J]` **Redesplegar `Api_V1_Security_Register`**: ahora **rechaza (409)** el registro bajo un NIT ya
  existente. Sin permisos nuevos. (Es el fix crítico — priorizar.)
- [ ] `[J]` Desplegar `Api_V1_User_Create`, `Api_V1_User_List`, `Api_V1_User_Delete` (crear vacías) + rutas
  `/User/{Create,List,Delete}` (authorizer + CORS + **mapping template con `customerId`/`nit`/`userId`/
  `tenantRole`** — el owner-check usa `tenantRole`). **NO son admin** (las usa el owner del tenant). IAM:
  `Scan/GetItem/PutItem/DeleteItem` sobre `user` y `userData`; `PutItem` sobre `adminAudit`. Env
  `MAX_TEAM_USERS` (default 2).
- [ ] `[C]` **Front (hecho):** tab **Usuarios** (`UsuariosSection`, owner) + `usersService`; `RegisterPage`
  muestra el 409 del backend (NIT o correo). El usuario nuevo define su clave con "¿Olvidaste tu
  contraseña?" (el front dispara `forgot-password` tras crearlo).

- [x] `[J]` Crear las 12 funciones vacías + sus rutas + permisos de la tabla.
- [x] `[J]` Confirmar que el **Authorizer** está asignado a las 12 rutas.
- [x] `[J]` `Api_V1_Admin_Requeue` reencola las partes pendientes de un envío atascado
  (botón "Reintentar" en Trabajos). Necesita `sqs:SendMessage` sobre la cola
  `Email_Prepare-batch-part` y la env `URL_SQS_PREPARE_PART` (misma URL que usa Prepare-batch).
  Solo funciona con procesos creados **después** de desplegar el Prepare-batch que guarda
  `resumeCtx` (los anteriores devuelven 409 "sin contexto de reanudación").
- [x] `[J]` `Api_V1_Admin_Campaigns` es la vista **admin** de campañas de todos los clientes
  (columna de empresa + filtros en el panel). La ruta `/Admin/Campaigns` ya está en
  `infra/api/routes.json`, así que el workflow `deploy-api.yml` la crea sola.

> `*_sendStatus` = permiso sobre el patrón `arn:aws:dynamodb:...:table/*_sendStatus`
> (una tabla por cliente, `{customer}_sendStatus`). Igual `*_sendSummary`.
> **Billing_Summary y Admin_Jobs** ahora usan el resumen pre-agregado `{customer}_sendSummary`
> (GetItem O(1) por proceso) cuando `SEND_SUMMARY_READ=true`; si no, siguen por `Query`
> sobre `*_sendStatus` (comportamiento actual). Billing además cambió de **1+2·C** scans
> completos (uno de `campaign` + uno de `process` **por cliente**) a **3 scans totales**
> (uno de cada tabla), lo que elimina el timeout con muchos clientes.

---

## 4. Lambdas EXISTENTES modificadas (redesplegar + permisos extra)

Estas ya existían; en esta tanda se les agregó lógica. Hay que **redesplegarlas** y
darles un permiso extra. Todo es **best-effort con fallback**: si falta el permiso o la
tabla, siguen funcionando como antes (sin auditar / con la env var).

| Lambda | Cambio | Permiso extra |
|--------|--------|---------------|
| `Api_V1_Customer_Update` | Auditoría `customer.realSend` **descriptiva** (empresa + antes→después) | `PutItem` sobre `adminAudit` |
| `Api_V1_Security_Register` | Lee `SENDER_EMAIL`/`ACTIVATION_URL` de `platformConfig` | `GetItem` sobre `platformConfig` |
| `Api_V1_Security_Create-otp` | Lee `SENDER_EMAIL`/`OTP_EXPIRATION_MIN` de `platformConfig` | `GetItem` sobre `platformConfig` |
| `Api_V1_Security_Recovery-password` | Lee `SENDER_EMAIL`/`OTP_EXPIRATION_MIN` de `platformConfig` | `GetItem` sobre `platformConfig` |
| `Api_V1_Security_Login` | Auditoría de **seguridad** (`security.login` intentos/fallos + `security.token`) | `PutItem` sobre `adminAudit` |
| `Api_V1_Campaign_Create-campaign` | Auditoría `campaign.create`; **consecutivo atómico** (contador por cliente) | `PutItem` sobre `adminAudit`; `PutItem`/`UpdateItem` sobre `campaignCounter` |
| `Api_V1_Template_Create-template` | Auditoría `template.create` (además del `templateAudit` existente) | `PutItem` sobre `adminAudit` |
| `Api_V1_MessageTemplate_Create` | Auditoría `messageTemplate.create`/`.update` | `PutItem` sobre `adminAudit` |
| `Api_V1_Email_Prepare-batch-template` | Auditoría `send.samples`/`send.real`; guarda `resumeCtx` para reintentar; scans de `customer` por PK → GetItem | `PutItem` sobre `adminAudit`; `UpdateItem` sobre `process` (resumeCtx) |
| `Api_V1_Email_Send-batch-template-EAP` | Rellena `{{unsubscribeUrl}}` + headers List-Unsubscribe | env **`SECRET_KEY`** y `UNSUBSCRIBE_URL` |
| `Api_V1_Security_Login` | email → **Query al GSI `email-index`** (por defecto, sin fallback) | **crear el GSI `email-index` en `user`** (obligatorio) |
| `Api_V1_Cost_Estimate` | Toma el `customerId` del Authorizer, no del body | — (sin permisos nuevos) |
| `Api_V1_Portal_Bootstrap` | Campañas/bases/plantillas por **Query al GSI `customerId-index`** (por defecto) | **crear los GSIs `customerId-index`** en `campaign`/`databaseFile`/`messageTemplate` |
| `Api_V1_Campaign_List` / `Database_List` / `MessageTemplate_List` | Listan por **Query al GSI `customerId-index`** (por defecto, sin fallback a Scan) | **crear el GSI `customerId-index`** en la tabla respectiva |
| `Api_V1_Wsp_Send-batch` | Indexa `messageId → {customer, proceso}` para los recibos de Meta | `PutItem`/`BatchWriteItem` sobre `messageIndex` |
| `Api_V1_Billing_Summary` | **3 scans totales** (no 1+2·C) + `sendSummary` O(1) opcional | `GetItem` sobre `*_sendSummary` (si `SEND_SUMMARY_READ`) |

### Lambda nueva disparada por SNS (no es ruta de API Gateway)

- **`Api_V1_Wsp_ReceptionStatus`** (crear la función vacía): procesa los recibos de entrega/
  lectura de WhatsApp que **Meta** publica en la **SNS de End User Messaging Social**. Como el
  recibo solo trae el `messageId`, ubica el cliente/proceso en `messageIndex` y escribe el
  estado en `{customer}_sendStatus`.
  - [x] `[J]` Suscribir esta lambda a la **SNS de WhatsApp** (End User Messaging Social → event
    destination). Permisos: `GetItem` sobre `messageIndex`; `PutItem` sobre `*_sendStatus`;
    (si `SEND_SUMMARY_ENABLED`) `UpdateItem` sobre `*_sendState`/`*_sendSummary`.
  - [x] `[J]` Env `WSP_MESSAGE_INDEX` en `Wsp_Send-batch` y `Wsp_ReceptionStatus` solo si la
    tabla no se llama `messageIndex`.

> `Api_V1_User_SetRole`, `Api_V1_Pricing_Update` y `Api_V1_Config_Set` también escriben
> auditoría (ahora más **descriptiva**: antes→después), pero ya están en §3 (son nuevas)
> con su permiso `PutItem` sobre `adminAudit`.
>
> Toda la auditoría es **best-effort**: sin el permiso `PutItem` sobre `adminAudit` la
> operación sigue funcionando, solo no deja rastro. Igual el `GetItem` sobre `*_sendSummary`:
> sin él (o con `SEND_SUMMARY_READ` apagado) se cae al `Query` de `*_sendStatus`.

- [x] `[J]` Redesplegar las lambdas modificadas y darles el permiso extra (`adminAudit`/`*_sendSummary`).

---

## 5. CORS (recordatorio)

- No-proxy: habilitar **CORS** en la ruta agrega el `OPTIONS` de preflight y los headers
  de respuesta; con eso basta para las rutas admin nuevas.
- Proxy: si alguna ruta se pasa a proxy, la **lambda debe emitir** el header
  `Access-Control-Allow-Origin` en su respuesta (el "Enable CORS" solo añade el OPTIONS).

- [x] `[J]` Habilitar CORS en las 12 rutas nuevas.

---

## 5c. IP del usuario en el login (aparece "unknown")

La lambda `Api_V1_Security_Login` es **no-proxy**, así que API Gateway **no** le pasa
`requestContext.identity.sourceIp` salvo que el **mapping template del login lo inyecte**.
Por eso hoy la IP queda en `unknown` (en la sesión y en la auditoría de seguridad). El
código ya sabe leerla si llega por el body (`ip`) o por `X-Forwarded-For`; falta el mapping.

- [x] `[J]` En el mapping template de la ruta de **login** (`application/json`), agregar la
  IP al body. Ejemplo (ajusta a tu template actual):
  ```vtl
  #set($b = $input.path('$'))
  {
    "user": "$util.escapeJavaScript($b.user)",
    "password": "$util.escapeJavaScript($b.password)",
    "ip": "$context.identity.sourceIp"
  }
  ```
  (Alternativa: pasar la ruta a **proxy**, donde `requestContext.identity.sourceIp` ya viene.)

---

## 6. Datos / provisión

- [x] `[J]` **Promover a `admin`** al menos un usuario: en la tabla `user`, poner
  `role = "admin"` en el ítem del usuario. (Después ya se hace desde la ficha de cliente).
- [ ] `[J]` (Opcional) Cargar la tarifa **global** en `pricingRate` (`customerId='*'`) por
  canal, o dejar que apliquen los `DEFAULT_RATES` embebidos hasta calibrar.
- [ ] `[J]` **Calibrar tarifas** con costos reales (SES/SNS/Meta/AWS EUM) — hoy son indicativas.

---

## 7. Checklist rápido de verificación (post-deploy)

- [ ] Entrar a `/admin` con un usuario `admin` → cargan los tabs sin 403.
- [ ] **Tarifas:** editar la tarifa global de un canal y guardar → recargar y persiste.
- [ ] **Clientes → Ficha:** abrir un cliente, ver sus usuarios, promover/degradar admin.
- [ ] **Facturación / Panel / Trabajos:** cargan datos (o vacío correcto si no hay envíos).
- [ ] **Configuración:** cambiar `OTP_EXPIRATION_MIN` → pedir un OTP → vigencia nueva aplica.
- [ ] **Auditoría:** cada acción anterior aparece en la bitácora con el actor correcto.

---

## 7b. Troubleshooting: "CORS error" + el Authorizer no deja logs

> **El "No 'Access-Control-Allow-Origin' header" suele ser un disfraz.** Si el
> Authorizer **deniega o crashea**, API Gateway responde 401/403/500 **sin** headers
> CORS y el navegador lo reporta como CORS aunque el problema real sea la autorización.

**1. Ver el error REAL con curl (ignora CORS):**
```bash
curl -i -X POST 'https://api.mailconnect.com.co/V1/Customer/List' \
  -H 'Authorization: Bearer <TU_JWT>' -H 'Content-Type: application/json' -d '{}'
```
- 401 → el Authorizer denegó o reventó · 500 → el Authorizer **crasheó al iniciar**
  (falta layer PyJWT o env `SECRET_KEY`) · 403 "Acceso restringido" → corrió pero no
  mandó `role` (falta el mapping template §1) · 200 → ya funciona.

**1b. "AuthorizerConfigurationException / Invalid permissions on Lambda function":**
Si el test del Authorizer (o CloudWatch de API Gateway) muestra
`Execution failed due to configuration error: Invalid permissions on Lambda function`,
**API Gateway no tiene permiso para invocar la función Authorizer** (falta su
*resource-based policy*). Por eso "no deja logs": nunca se ejecuta. Arreglo (ajusta
apiId/authorizerId/cuenta a los tuyos, salen en el log del test):
```bash
aws lambda add-permission --function-name Authorizer \
  --statement-id apigw-invoke-authorizer --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:<ACCOUNT>:<API_ID>/authorizers/<AUTHORIZER_ID>"
```
Por consola: API Gateway → Authorizers → editar → re-seleccionar la función Lambda →
aceptar el popup *"grant API Gateway permission to invoke"* → **Deploy**. Repetir para
`Authorizer2` si se usa. Es **distinto** del execution role (logs).

**2. El Authorizer "no deja log / no se ejecuta":**
- **Caché:** API Gateway cachea el resultado por token (TTL 300s) → no re-ejecuta → sin
  logs nuevos. Para depurar: Authorizers → **Authorization Caching TTL = 0** → Deploy.
- **Permisos de logs:** la función `Authorizer` necesita `AWSLambdaBasicExecutionRole`
  (`logs:*`). Sin eso nunca escribe en CloudWatch.
- **Crash al iniciar (lo más común):** sin el **layer de PyJWT** o la env **`SECRET_KEY`**
  revienta en `import jwt` → 500 sin CORS. Probar con Lambda → `Authorizer` → **Test**.

**3. Que los errores dejen de enmascararse como CORS:**
- API Gateway → **Gateway Responses** → `DEFAULT_4XX`, `DEFAULT_5XX` (y `UNAUTHORIZED`,
  `ACCESS_DENIED`) → agregar headers: `Access-Control-Allow-Origin='*'`,
  `Access-Control-Allow-Headers='Content-Type,Authorization'`,
  `Access-Control-Allow-Methods='POST,OPTIONS'` → **Deploy**.

**4. Confirmar el preflight OPTIONS:**
```bash
curl -i -X OPTIONS 'https://api.mailconnect.com.co/V1/Customer/List' \
  -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type,authorization'
```
Debe volver 200 con `Access-Control-Allow-*` (incluyendo `Authorization`). Es **custom
domain** (`api.mailconnect.com.co/V1`): el CORS va en la API/stage detrás del dominio + **Deploy**.

- [x] `[J]` Confirmar layer PyJWT + env `SECRET_KEY` en `Authorizer`/`Authorizer2`.
- [x] `[J]` CORS en Gateway Responses `DEFAULT_4XX`/`DEFAULT_5XX`.
- [x] `[J]` Verificar preflight OPTIONS por curl en las rutas admin.

## 8. Pendiente de MI lado (código) `[C]`

Lo que queda por hacer en el repo (no es despliegue):

- [x] **`verify-code` eliminado (jul 2026):** era un stub sin uso (el flujo real usa
  create-otp/validate-otp + activación por enlace). Se borró la lambda y sus referencias
  en el front (`authService.verifyCode`, `AUTH_ENDPOINTS.VERIFY_CODE`) y en `deploy-map`.
- [x] **Fase 5 (scans→queries) — GSI POR DEFECTO (jul 2026):** las list-lambdas
  (`Campaign_List`, `Database_List`, `MessageTemplate_List`, `Portal_Bootstrap`) y `Login`
  consultan **SIEMPRE por Query** al GSI (`customerId-index` / `email-index`) — se quitó el
  gate `USE_GSI`/`USER_EMAIL_GSI` y el fallback a Scan. Si el índice no existe, la lambda
  **falla** (por diseño). Scans de `customer` por PK → GetItem; `Create-otp` por userId;
  **consecutivo atómico de campañas** con `campaignCounter`.
  **Falta (`[J]`):** crear los **5 GSIs** (§2) + tabla `campaignCounter`. (El consecutivo de
  PLANTILLAS `Template_Create-template` tiene la misma carrera; se puede migrar igual si hace falta.)
- [x] **Pre-agregación POR DEFECTO (jul 2026):** `Admin_Dashboard`/`Billing_Summary`/
  `Reports_Statistics`/`Portal_Bootstrap` leen el resumen `{customer}_sendSummary` O(1) por
  proceso (fallback al scan de ESE proceso); los `ReceptionStatus` (Email/SMS-Voz/WhatsApp) lo
  mantienen SIEMPRE (sin `SEND_SUMMARY_*`). Prepare-batch crea `{customer}_sendSummary`/`_sendState`.
  Ver `PLAN_PREAGREGACION.md`. **Falta (`[J]`):** IAM `UpdateItem` sobre `*_sendSummary`/`*_sendState`
  (cubierto por la política amplia); backfill de procesos VIEJOS (opcional; mientras, se leen por scan).
- [x] **`sendDetail` unificado (jul 2026):** una tabla por cliente `{customer}_sendDetail`
  (PK `processId` + SK `sendDetailId`), no una por proceso. Escritores (EM/EAU/Prepare-batch) y
  lectores (state-report/Agent_Reports por Query) alineados. La crea `ensure_detail_table`.
- [ ] **CI — build del frontend:** agregar `npm ci && npm run build` al workflow para
  atrapar regresiones de TypeScript en cada PR.
- [x] **WhatsApp — ReceptionStatus (hecho jul 2026):** `Api_V1_Wsp_ReceptionStatus` procesa los
  recibos de Meta (SNS de socialmessaging); `Wsp_Send-batch` indexa `messageId → cliente/proceso`
  en `messageIndex` para poder ubicarlos. Estados WhatsApp: enviado/entregado/leído/fallido.
- [x] **EAP — desuscripción (hecho jul 2026):** `Send-batch-template-EAP` ya rellena
  `{{unsubscribeUrl}}` por destinatario (token HMAC) + headers List-Unsubscribe.
- [x] **Trabajos — reencolar (hecho jul 2026):** `Api_V1_Admin_Requeue` reencola las partes
  pendientes de un proceso atascado (idempotente); botón "Reintentar" en el tab Trabajos.
- [x] **`Cost_Estimate` — tenant del token (hecho jul 2026):** toma el `customerId` del
  Authorizer, no del body.
- [x] **Auditoría ampliada (hecho jul 2026):** seguridad (login/token), creación de campañas y
  plantillas, envíos (muestras/real); objetivos legibles (nombre/correo, no ids); tarifas con
  solo el campo cambiado.
- [x] **Timeouts admin (hecho jul 2026):** `Billing_Summary` (3 scans, no 1+2·C) y `Admin_Jobs`
  (conteo O(1) por `sendSummary`); + `ErrorBoundary` global y render defensivo en el panel.

## 9. Pendiente de seguridad (compartido) `[J]`/`[C]`

- [x] `[J]` **`SECRET_KEY` ROTADA** (32+ bytes) — se cambió el valor; la clave vieja del
  historial git ya no está en uso.
- [x] `[J]` Hacer el repo **privado** (o limpiar el historial con BFG/filter-repo).
- [ ] `[C]`/`[J]` Mover `SECRET_KEY` a **AWS Secrets Manager** (hoy es env var; ya rotada).
- [x] `[J]` **SES en PRODUCCIÓN** — fuera del sandbox, remitente/dominio verificados.

---

## 10. Cobro PREPAGO / monedero (jul 2026) — ✅ DESPLEGADO

> **Estado:** despliegue **completo** — tablas (`customerBalance`, `walletTransaction` + GSI
> `customerId-createdAt-index`), las 9 lambdas del monedero + sus rutas, env vars Wompi y el
> **webhook registrado** en Wompi. Los checklists de abajo quedan como **referencia** de lo
> aplicado. Pendiente `[J]` de calibración: ajustar las **tarifas** reales (hoy indicativas).
>
> Saldo por cliente en **COP**. El envío REAL **debita el saldo ANTES de trocear** con
> **bloqueo DURO** (sin cupo negativo). Todo movimiento de dinero deja un registro en el
> **ledger auditable** `walletTransaction`. Recarga **manual** (comprobante + aprobación) y
> **Wompi** (widget + webhook). El costo del débito usa la **misma fórmula/tarifas** que
> `Api_V1_Cost_Estimate`.

### 10.1 Tablas DynamoDB nuevas (On-Demand)
- [x] `[J]` `customerBalance` (PK `customerId` S) — saldo actual en COP.
- [x] `[J]` `walletTransaction` (PK `txId` S) **+ GSI `customerId-createdAt-index`** (PK
  `customerId` S + SK `createdAt` S, Projection ALL) — ledger de movimientos (recargas manuales/
  Wompi, débitos/reembolsos de envío, ajustes). En Wompi/manual, `txId` de la recarga **= la
  `reference`** (idempotencia del webhook/aprobación). El GSI sirve el historial del cliente
  (`Balance_Get` hace Query por el índice; si falta, cae a Scan+Filter → se puede desplegar el
  código antes que el índice). Ya declarado en `infra/terraform/dynamodb.tf`.

### 10.2 Lambdas nuevas + rutas + permisos
Crear la **función vacía** (mismo nombre de carpeta) antes del primer push (la actualiza el CD).

| Lambda | Ruta | Admin | Permisos IAM |
|--------|------|-------|--------------|
| `Api_V1_Balance_Get` | `/Balance/Get` | no (cliente) | `GetItem` sobre `customerBalance`; `Query`(GSI)/`Scan` sobre `walletTransaction` |
| `Api_V1_Balance_Topup-manual-request` | `/Balance/Topup-manual-request` | no (cliente) | `GetItem` sobre `customer`; `PutItem` sobre `walletTransaction`. El comprobante se sube con `get-urlS3` (documentType=document) al bucket `{prefix}-{nit}-document` |
| `Api_V1_Balance_Topup-manual` | `/Balance/Topup-manual` | **sí** | `UpdateItem` sobre `customerBalance`; `PutItem` sobre `walletTransaction`/`adminAudit` (**ajuste directo**, tipo `adjustment`) |
| `Api_V1_Admin_Topups` | `/Admin/Topups` | **sí** | `Scan` sobre `walletTransaction`/`customer`; **`s3:GetObject`** (URL prefirmada del comprobante) |
| `Api_V1_Admin_Topup-approve` | `/Admin/Topup-approve` | **sí** | `GetItem`/`UpdateItem` sobre `walletTransaction`; `UpdateItem` sobre `customerBalance`; **`dynamodb:TransactWriteItems`**; `PutItem` sobre `adminAudit` |
| `Api_V1_Admin_Topup-reject` | `/Admin/Topup-reject` | **sí** | `GetItem`/`UpdateItem` sobre `walletTransaction`; `PutItem` sobre `adminAudit` |
| `Api_V1_Admin_Balances` | `/Admin/Balances` | **sí** | `Scan` sobre `customer`/`customerBalance`/`walletTransaction` |

- [x] `[J]` Crear las 7 funciones vacías + sus rutas (ya están en `infra/api/routes.json`,
  el workflow `deploy-api.yml` las crea) + permisos. `/Balance/Get` y `/Balance/Topup-manual-request`
  son **de cliente** (tenant del token); el resto son **admin** (mapping template de `role`).
- [x] `[J]` Confirmar el **Authorizer** en las 7 rutas.
- [x] `[J]` `s3:GetObject` para `Admin_Topups` (ver comprobante) y `dynamodb:TransactWriteItems`
  para `Admin_Topup-approve` (ya cubiertos por la política amplia de `infra/terraform/iam.tf`).

> **Recarga manual = comprobante + aprobación:** el cliente sube el comprobante y crea la
> solicitud (`Topup-manual-request`, `status='pending'`, NO toca el saldo); el admin la revisa
> (`Admin_Topups`) y **aprueba** (`Admin_Topup-approve`: `pending→approved` + acredita en un
> `TransactWriteItems`) o **rechaza** (`Admin_Topup-reject`: `pending→declined` + motivo). El
> `Topup-manual` queda como **ajuste directo** del admin (correcciones/cortesías).

### 10.3 Lambda EXISTENTE modificada (débito) — redesplegar
- [x] `[J]` `Api_V1_Email_Prepare-batch-template`: en el **envío real** debita el saldo
  (orden gate manual → lock → **reserva de saldo** → troceo; 402 si no alcanza; reembolso si
  el troceo falla). El débito es `debit_send`, el reembolso `refund_send`, y el proceso guarda
  `chargedAmount`. Permisos extra: `UpdateItem` sobre `customerBalance`, `PutItem` sobre
  `walletTransaction`, `GetItem` sobre `pricingRate`. **Fail-open de rollout:** si la tabla
  `customerBalance` **aún no existe**, NO cobra (los envíos siguen); una vez creada, el
  bloqueo por saldo es **DURO**. Por eso: **crear `customerBalance` ANTES** de considerar el
  cobro activo.

### 10.4 Verificación post-deploy
- [x] `[J]` Cliente registra una recarga por transferencia (sube comprobante) → aparece en
  `/Admin/Topups` como **pendiente** (saldo sin cambios).
- [x] `[J]` Admin **aprueba** → el saldo sube y la tx queda `approved`; **rechaza** → `declined`
  con motivo, saldo sin cambios. Aprobar/rechazar dos veces es idempotente.
- [x] `[J]` Admin hace un **ajuste directo** (`/Balance/Topup-manual`) → crédito inmediato (`adjustment`).
- [x] `[J]` Cliente ve su saldo/movimientos y el estado de sus solicitudes en el portal (`/Balance/Get`).
- [x] `[J]` Envío real con saldo suficiente → descuenta el costo y aparece en el ledger.
- [x] `[J]` Envío real con saldo insuficiente → **402** y la campaña sigue en `Pendiente`.

### 10.5 Recarga WOMPI (Fase 2)
Recarga en línea autoservicio con el Widget/Checkout de Wompi. **El saldo SOLO se acredita
en el webhook firmado por Wompi**, nunca desde el redirect del navegador.

**Lambdas + rutas + permisos:**

| Lambda | Ruta | Auth/Proxy | Permisos IAM |
|--------|------|-----------|--------------|
| `Api_V1_Balance_Topup-init` | `/Balance/Topup-init` | cliente (authorizer) | `PutItem` sobre `walletTransaction` |
| `Api_V1_Wallet_Wompi-webhook` | `/Wallet/Wompi-webhook` | **PÚBLICA (proxy, SIN authorizer, sin CORS)** | `GetItem`/`UpdateItem` sobre `walletTransaction`; `UpdateItem` sobre `customerBalance`; `dynamodb:TransactWriteItems` sobre ambas |

- [x] `[J]` Crear las 2 funciones vacías + rutas (ya en `infra/api/routes.json`; el webhook va
  `auth:false, proxy:true, cors:false`). **El webhook NO lleva Authorizer** (Wompi no manda JWT;
  la autenticidad la da la **firma del evento**). Como es **proxy**, la lambda ya devuelve
  `{statusCode, headers, body}`.
- [x] `[J]` **Registrar la URL del webhook en el panel de Wompi** (Eventos): apuntar a
  `https://api.mailconnect.com.co/V1/Wallet/Wompi-webhook`.
- [x] `[J]` Permiso `dynamodb:TransactWriteItems` para el webhook (acreditación atómica
  transición+saldo). Sin él la acreditación falla (aunque la firma sea válida).

**Env vars (llaves Wompi — pendiente a Secrets Manager):**
- [x] `[J]` `WOMPI_PUBLIC_KEY` (Topup-init la devuelve al front para el widget).
- [x] `[J]` `WOMPI_INTEGRITY_SECRET` (Topup-init firma la integridad del pago).
- [x] `[J]` `WOMPI_EVENTS_SECRET` (webhook verifica la firma del evento).
- [x] `[J]` `WOMPI_PRIVATE_KEY` (reservada para llamadas server-to-server; hoy no se usa).
- [x] `[J]` `WOMPI_REDIRECT_URL` (opcional; a dónde vuelve el navegador tras pagar).
- [x] `[J]` `WOMPI_CURRENCY` (default `COP`), `MIN_TOPUP` (default `20000`).
  > En Terraform, pásalas por el mapa **`wompi_env`** (`TF_VAR_wompi_env`), que se mergea en el
  > env común de las lambdas. NO commitear las llaves.

**Verificación (Fase 2):**
- [x] `[J]` Recarga de prueba en sandbox: `Topup-init` → widget → pago aprobado → el webhook
  acredita y el saldo sube. Reintento del webhook (mismo evento) → **no doble-acredita**.
- [x] `[J]` Firma inválida al webhook → **401**, sin acreditar. Pago declinado → sin acreditar.

---

## 11. Estandarización del naming por cliente: NIT (`tenant_key`) (jul 2026)

> **Qué cambió:** las **tablas por cliente** pasan de nombre de empresa a **NIT saneado**
> (`tenant_key(companyTin)`), igual que ya hacían los **buckets** S3. Una sola llave para
> tablas y buckets. Detalle y flujo completo en `CLAUDE.md` §3 ("Estandarización del naming").

Tablas afectadas (prefijo `{nombreEmpresa}_` → `{tenant_key(nit)}_`):
`_sendStatus`, `_sendDetail`, `_sendSummary`, `_sendState`, `_blackList`, `_unsubscribe`,
`_processDetail`. (El nombre de la **plantilla SES** NO cambia — otro namespace.)

- [x] `[C]` Código: `tenant_key(nit)` en todas las lambdas que nombran tablas por cliente;
  `nit` en el JWT (`Login`) + context (`Authorizer`/`Authorizer2`) + mapping template
  (`sync_api.py`/`routes.json`) + `Refresh-token`; `nit` propagado por SES tag / EUM Context /
  `messageIndex` / token de desuscripción; `process.companyTin` guardado por Prepare-batch.
  244 pruebas en verde.
- [x] `[J]` **Redesplegar el mapping template** (`deploy-api.yml`) para que inyecte
  `$context.authorizer.nit` en las rutas no-proxy (ya está en `sync_api.py`). Sin esto, las
  read-lambdas de cliente no encuentran las tablas del tenant tras el cambio.
- [x] `[J]` **Redesplegar TODAS las lambdas** del pipeline (Prepare-batch, Send-EM/EAU/EAP/
  SMS/WSP/Voz, ReceptionStatus Email/Messaging/Wsp, Unsubscribe, Combination, y las read/admin
  Statistics/Bootstrap/Blacklist/Dashboard/Jobs/Billing/state-report/Agent_Reports) + Login/
  Authorizers/Refresh-token. Deben ir **juntas** (writers y readers usan la misma llave).
- [x] `[J]` **Migración de datos** (dev/no productivo → basta recrear): las tablas viejas
  `{nombreEmpresa}_*` quedan huérfanas. Opciones: (a) en dev, volver a enviar (Prepare-batch
  crea las tablas nuevas); (b) en un entorno con datos, copiar los ítems de `{nombre}_X` a
  `{tenant_key(nit)}_X` por cliente antes del corte. **Permiso IAM:** `CreateTable`/`DescribeTable`
  sobre `*_sendStatus`/`_sendDetail`/… ya existía (mismo patrón, solo cambia el prefijo).
- [x] `[J]` Requisito: **todos los clientes deben tener `companyTin`** (Prepare-batch ahora
  falla `require_tenant` si falta, para no colisionar tenants). Verificar la tabla `customer`.
