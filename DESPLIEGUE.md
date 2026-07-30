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
  ⚠️ **Ago 2026:** el combinador ahora renderiza también las plantillas del **Estudio/Diseñador** (JSON de
  lienzo) con el **motor `pdf_engine` vendorizado** → su **layer debe sumar** `reportlab`, `Pillow`, `qrcode`,
  `python-barcode`, `beautifulsoup4`, `lxml` (además de `xhtml2pdf`); el paquete incluye `pdf_engine/`,
  `sketch_translator.py` y `fonts/` (el CD sube la carpeta completa).
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
> El front tiene un editor **visual (ReactFlow)** y uno de **campos** (toggle Básico/Flujo).

- [ ] `[J]` Tablas **`cascadeRun`** (PK `cascadeRunId` + GSI `customerId-index`) y **`cascadeContact`**
  (PK `cascadeContactId` + GSI `cascadeRunId-index`), On-Demand — las crea `Cascade_Dispatch` on-demand, o
  créalas a mano.
- [ ] `[J]` Crear las **3 funciones vacías** antes del primer CD: `Api_V1_Cascade_Dispatch`,
  `Api_V1_Cascade_Advance`, `Api_V1_Cascade_List`.
- [ ] `[J]` **Regla EventBridge `rate(10 minutes)` → `Api_V1_Cascade_Advance`** (el motor). Es lo que hace
  avanzar los envíos/escalamientos por contacto vencido. `Advance` también acepta `POST /Cascade/Advance`
  manual para pruebas, pero **no** necesita ruta pública.
- [ ] `[J]` Rutas `/Cascade/{Dispatch,List}` (client, authorizer + CORS + mapping de
  `customerId`/`customer`/`nit`). Ya están en `infra/api/routes.json` → `deploy-api.yml` las crea. El
  `Advance` **no** lleva ruta.
- [ ] `[J]` IAM del `Advance` (el que más permisos necesita): DynamoDB `Query`/`UpdateItem`/`Scan` sobre
  `cascadeRun`/`cascadeContact`; `UpdateItem` sobre `customerBalance` + `PutItem` sobre `walletTransaction`
  (débito/reembolso); `GetItem` sobre `pricingRate`; `Query`/`GetItem` sobre `{tenant}_sendStatus`,
  `{tenant}_sendDetail` (patrón `*_sendStatus`, etc.); **`sqs:SendMessage`** a las 4 colas
  de envío (`Email_Send-batch-template-EM`, `Sms_Send-batch`, `Wsp_Send-batch`, `Voice_Send-batch`).
  `Cascade_Dispatch` además: `GetItem databaseFile`, S3 `GetObject` (la base CSV), `Put/BatchWrite` sobre
  `cascadeContact`/`cascadeRun`, `UpdateItem customerBalance` + `PutItem walletTransaction` (débito del paso
  0), `SendMessage` a la cola del canal 0. `Cascade_List`: `Query` sobre `cascadeRun` (GSI `customerId-index`).
  Envs opcionales: `URL_SQS_EM`/`URL_SQS_SMS`/`URL_SQS_WSP`/`URL_SQS_VOICE` (colas por canal, con default
  embebido), `GSI_CASCADE_CUSTOMER_INDEX`/`GSI_CASCADE_RUN_INDEX`.
- [ ] `[J]` Los envíos de la cascada escriben en las tablas por tenant que ya usan los workers
  (`{tenant}_sendStatus`, y para correo `{tenant}_processDetail`/`_sendDetail`). Los `Send-*` deben
  persistir el `uniqueId` (= `cascadeContactId`) y `processId` (= `csc-{contactId}-{step}`) que la cascada
  envía en el mensaje, para que `Advance` lea el resultado por contacto.

### 3e. SEGURIDAD: registro por NIT + equipo del cliente **🆕 (nuevo)**

> **Bug crítico corregido:** `Register` reutilizaba el `customerId` si el NIT ya existía → cualquiera que
> supiera el NIT (semi-público) se registraba y quedaba dentro del tenant de otra empresa como owner.

- [x] `[J]` **Redesplegar `Api_V1_Security_Register`** ✅ (desplegado ago 2026): **rechaza (409)** el
  registro bajo un NIT ya existente. Sin permisos nuevos.
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
  (Ver la sección de pre-agregación en `CLAUDE.md`.) **Falta (`[J]`):** IAM `UpdateItem` sobre `*_sendSummary`/`*_sendState`
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

---

## 12. Auditoría ampliada + peso real del adjunto (ago 2026)

### 12a. Bitácora: `dynamodb:PutItem adminAudit` en 23 lambdas más

La revisión de cobertura de auditoría (ver `CLAUDE.md` → "Auditoría: cierre de los huecos
de registro") llevó de **28 a 51** las lambdas que escriben en `adminAudit`. Las 23 nuevas
necesitan el permiso en su rol:

`Api_V1_Security_{Totp,Change-password,Register,Recovery-password,Logout,Acount-activation}` ·
`Api_V1_Domain_{Add,Delete}` · `Api_V1_Blacklist_{Add,Delete}` ·
`Api_V1_Wallet_Wompi-webhook` · `Api_V1_Balance_{Topup-init,Topup-manual-request}` ·
`Api_V1_Schedule_{Create,Cancel}` · `Api_V1_Cascade_Dispatch` · `Api_V1_Campaign_Update` ·
`Api_V1_MessageTemplate_Delete` · `Api_V1_Template_Delete-template` ·
`Api_V1_Admin_Templates` · `Api_V1_Database_{Register-file,Delete}` ·
`Api_V1_Notifications_Prefs`

- [ ] `[J]` **IAM `dynamodb:PutItem` sobre `adminAudit`** en esas 23 lambdas. La mayoría ya
  tiene un rol `Lambda_DynFull*` (DynamoDB full) → **no hay que hacer nada**; verificar solo
  las que tengan un rol restringido.
- [ ] `[J]` **`Api_V1_Admin_Templates` ahora usa DynamoDB** (antes solo SES): su rol debe
  incluir DynamoDB. Si el CD le asignó `Lambda_SES`, pasa a necesitar `Lambda_DynFull_SES`.
- ℹ️ La escritura es **best-effort**: sin el permiso la operación del cliente NO falla, pero
  el evento no queda registrado (se ve en los logs como "No se pudo registrar auditoría").

### 12b. `Api_V1_Cost_Attachment-weight` (peso real del adjunto)

Lambda NUEVA (el CD la crea) + ruta `/Cost/Attachment-weight` **ya en `routes.json`**
(authorizer + CORS + mapping template con `customerId`/`customer`/`nit`).

- [ ] `[J]` **Rol**: el CD lo auto-detecta como `Lambda_DynFull_S3_Invoke` (usa
  `boto3.resource('dynamodb')` + `boto3.client('s3')` + `boto3.client('lambda')`).
- [ ] `[J]` **IAM**: `dynamodb:GetItem` sobre `campaign` + `Scan` sobre `document`;
  `s3:GetObject`/`s3:HeadObject` sobre los buckets de cliente; y **`lambda:InvokeFunction`**
  sobre `Api_V1_Template_Render-engine` y `Api_V1_Template_Render-pdf`.
- ℹ️ **NO necesita el layer de reportlab/xhtml2pdf**: no renderiza, delega en esas dos
  lambdas (que ya lo tienen). Si a alguna le falta el layer, la medición de EAP-PDF
  responde 502 con el aviso — no devuelve un peso inventado.
- [ ] `[J]` (opcional) Envs `ATTACHMENT_WEIGHT_MARGIN` (default `0.20` = +20%),
  `ATTACHMENT_WEIGHT_SAMPLES` / `_MAX_SAMPLES` (default `10`).

---

## 13. Interruptor global del IVA (ago 2026)

Ajuste de plataforma **`TAX_ENABLED`** (Configuración → **"Cobrar IVA"**). Al apagarlo,
toda la plataforma cotiza y cobra **sin IVA** (tarifa neta) — para cuando MailConnect aún
no es responsable de IVA.

- **No hay nada que crear:** la clave vive en la tabla `platformConfig` (ya existe) y la
  escribe `Config/Set` la primera vez que se usa el switch.
- [ ] `[J]` **IAM `dynamodb:GetItem` sobre `platformConfig`** en las 6 lambdas que
  calculan dinero: `Api_V1_Cost_Estimate`, `Api_V1_Email_Prepare-batch-template`,
  `Api_V1_Billing_Summary`, `Api_V1_Pricing_List`, `Api_V1_Cascade_Dispatch`,
  `Api_V1_Cascade_Advance`. Las que ya tienen un rol `Lambda_DynFull*` **no necesitan
  nada**; verificar solo las de rol restringido.
- ℹ️ **Sin el permiso NO rompen**: `tax_enabled()` es fail-open → devuelve `True` y se
  sigue cobrando IVA. El síntoma sería "apagué el switch y me sigue cobrando IVA": ahí
  hay que revisar este permiso.
- ⚠️ **Las 6 tienen que quedar desplegadas juntas.** Si el estimador (`Cost_Estimate`)
  leyera el interruptor y el débito (`Prepare-batch`) no, el cliente vería un precio y se
  le cobraría otro, y el gate de saldo decidiría con la cifra equivocada. El CD despliega
  solo las lambdas cambiadas en el push, así que verificar que el workflow las cubra todas.
- ✅ Después de desplegar: entrar a **Configuración**, apagar **"Cobrar IVA"** y confirmar
  en **Muestras → Costo estimado** que el desglose ya no trae la línea de IVA.

---

## 14. Constructor de correos profesional (ago 2026)

### 14a. `Api_V1_Email_Send-test` — "Enviarme una prueba"

Lambda NUEVA (el CD la crea) + ruta `/Email/Send-test` **ya en `routes.json`**.

- [ ] `[J]` **IAM**: `ses:SendEmail`; `dynamodb:Scan` sobre `user` (para resolver los
  correos permitidos); `UpdateItem`/`CreateTable`/`DescribeTable` sobre `assistantRateLimit`
  (tope diario, reusa la tabla del limitador del asistente); `PutItem` sobre `adminAudit`.
- [ ] `[J]` **Env**: `SENDER_EMAIL` (remitente verificado en SES) y, opcional,
  `TEST_SEND_DAILY_LIMIT` (default 20).
- ℹ️ **Seguridad**: el destinatario está restringido a un correo de un usuario ACTIVO del
  mismo tenant. Es deliberado — sin ese gate, un endpoint que envía HTML arbitrario a una
  dirección arbitraria es un relay de spam con la reputación de envío de la plataforma,
  que es compartida entre todos los clientes.

### 14a-bis. `Api_V1_Template_Create-template` devuelve el nombre final en SES

- [ ] `[J]` **Redesplegar** la lambda (el CD lo hace solo al hacer push). Ahora la respuesta
  incluye `data.templateName` con el nombre FINAL `{cliente}_{consecutivo}_{nombre}`.
- ℹ️ **Sin cambios de infra ni de IAM.** Sin el redespliegue el constructor sigue
  funcionando: al publicar cae al nombre que escribió el usuario, así que el emparejamiento
  entre la plantilla de SES y su diseño editable puede quedar impreciso hasta desplegar.

### 14b. Canal `HTML` en `messageTemplate` (biblioteca de diseños + versionado)

- **Nada que crear**: misma tabla `messageTemplate` y misma ruta `/MessageTemplate/Create`.
  Solo se amplió el catálogo de canales y se agregaron los campos `designJson` y
  `designHistory` (versiones anteriores del diseño).
- [ ] `[J]` **Envs OPCIONALES** de `Api_V1_MessageTemplate_Create`:
  `DESIGN_MAX_VERSIONS` (default 10, cuántas versiones se conservan) y
  `DESIGN_HISTORY_BUDGET` (default 327680 bytes = 320 KB, tope de tamaño del diseño
  vigente + su historial). El segundo existe porque un ítem de DynamoDB no puede pasar de
  **400 KB**: sin él, 10 versiones de un diseño grande harían fallar el `put_item` y el
  usuario perdería el guardado por culpa del historial. Con los defaults no hay nada que
  configurar.

### 14c. Verificación recomendada tras desplegar

1. Abrir **Plantillas HTML**, escribir un texto y ponerle **negrita + un enlace**.
2. **Revisar** → debe listar los problemas (o decir que todo está en orden).
3. **Enviarme una prueba** → llega el correo; comprobar el formato en el móvil y, si se
   puede, con el modo oscuro del cliente activado.
4. ⚠️ **Validar el valor por defecto de las variables en un envío REAL**: el token
   `{{#if campo}}…{{else}}…{{/if}}` lo resuelve el motor de plantillas de **SES** (el canal
   EM delega la sustitución a SES). Si SES no lo interpretara en tu cuenta, el correo
   mostraría el token en crudo — se detecta con una sola muestra.

---

## 15. Biblioteca de imágenes del constructor (ago 2026)

- [ ] `[J]` **`Api_V1_Resources_List`** + ruta `/Resources/List` **ya en `routes.json`**
  (authorizer + CORS + mapping template con `customerId`/`customer`/`nit`). El CD crea la
  lambda; su rol de convención sale como `Lambda_S3`.
- [ ] `[J]` **IAM `s3:ListBucket`** sobre los buckets de cliente (`arn:aws:s3:::mailconnect-*`).
  Ojo: `ListBucket` es permiso de BUCKET, no de objeto — si la política solo tiene
  `arn:aws:s3:::mailconnect-*/*`, hay que agregar también el ARN sin `/*`.
- ℹ️ Sin la lambda desplegada el constructor sigue funcionando: el botón "Mis imágenes"
  muestra el error y la subida directa nunca dejó de estar disponible.
- ℹ️ La lambda solo lista los prefijos **públicos** (`resources/`, `attachment/`). `database/`
  y `document/` quedan fuera por diseño: son bases de contactos y comprobantes.

---

## 16. Centro de notificaciones del portal (ago 2026)

La campanita del portal (avisos in-app abajo a la derecha + panel con contador). Es la
pata que faltaba del **Bloque H**: aquello ya avisaba por CORREO al owner (saldo bajo,
reputación, resumen diario) pero **nada** aparecía dentro de la aplicación, y "tienes una
campaña por aprobar" no existía en ningún canal.

- [ ] `[J]` **Tabla `notification`** (PK `notificationId`) + **GSI `userId-createdAt-index`**
  (HASH `userId`, RANGE `createdAt`, proyección `ALL`) + **TTL sobre `expiresAt`**.
  **La crea `Api_V1_Notifications_List` on-demand** (mismo patrón que `assistantRateLimit`),
  así que no hay paso manual — pero si se prefiere crearla por consola/Terraform, ese es el
  esquema exacto. On-demand (`PAY_PER_REQUEST`).
- [ ] `[J]` **Lambda `Api_V1_Notifications_List`** (el CD la crea; rol de convención
  `Lambda_DynFull`) + ruta **`/Notifications/List`** ya en `routes.json` (authorizer + CORS
  + mapping template). ⚠️ El mapping template DEBE inyectar **`userId`**: el destinatario de
  una notificación es un USUARIO, no un tenant. Sin `userId` en el context la lambda
  responde **403** y la campanita queda vacía (falla segura: nunca muestra las de otro).
- [ ] `[J]` **IAM de la lambda**: `dynamodb:Query` sobre `notification` **y su índice**
  (`arn:…:table/notification/index/*` — el ARN del índice es aparte del de la tabla),
  `UpdateItem`, más `CreateTable`/`DescribeTable`/`UpdateTimeToLive` para la creación
  on-demand.
- [ ] `[J]` **IAM de las 4 lambdas que DISPARAN avisos**: `dynamodb:PutItem` sobre
  `notification` + `Scan` sobre `user` en
  `Api_V1_Campaign_{Request-approval,Approve,Reject}` y
  `Api_V1_Email_Prepare-batch-template`. Las que ya tienen `Lambda_DynFull*` no necesitan
  nada. ℹ️ La escritura es **best-effort**: sin el permiso (o sin la tabla) la aprobación y
  el envío **siguen funcionando**, solo que no se notifica.
- [ ] `[J]` (opcional) Envs `NOTIFY_TTL_DAYS` (default `60`, cuánto vive un aviso) y
  `NOTIFICATIONS_LIMIT` (default `30`, cuántos trae el panel; tope duro 100).

### Verificación post-deploy

1. Con un usuario **operator**, pedir aprobación de una campaña con muestras enviadas.
2. Entrar con el **owner**: la campanita debe traer el contador en 1 y el aviso
   "Campaña por aprobar"; al hacer clic debe llevar al tab de aprobaciones.
3. Aprobarla → el **operator** recibe "Campaña aprobada". Rechazarla en otra campaña →
   el aviso llega con el **motivo dentro del texto**.
4. El operator que la solicitó **no** debe recibirse a sí mismo el aviso de "por aprobar",
   y nadie de otra empresa debe ver nada.

ℹ️ **Sin desplegar nada de esto el portal no se rompe**: `notificationsInbox.list` falla y
el centro simplemente se queda en cero (no hay pantalla de error).

⚠️ **Sigue pendiente lo del Bloque H** (avisos por CORREO): `Api_V1_Notifications_{Prefs,Scan}`,
`Api_V1_Email_Preferences` y la regla EventBridge del Scan. El centro in-app es independiente
—no los necesita— pero el aviso de **saldo bajo** solo llega a la campanita si
`Prepare-batch` está redesplegado con este cambio.

---

## 17. Tarifas de SMS y Voz a costo+25% (ago 2026)

Las tarifas de SMS y Voz vendían **por debajo del costo de AWS en TODOS los tramos**. Se
recalibraron contra el costo real (ver `CLAUDE.md` → "Tarifas SMS/Voz a costo+25%").

| Canal | Costo AWS (TRM 3.206) | Antes | Ahora |
|---|---|---|---|
| SMS | ≈163 COP/**segmento** | 55 → 10 | **205 → 180** |
| Voz | ≈305 COP/**minuto** | 150 → 48 | **380 → 335** |

- [ ] `[J]` **Redesplegar las 6 lambdas que tienen las tarifas COPIADAS, juntas**:
  `Api_V1_Cost_Estimate` · `Api_V1_Email_Prepare-batch-template` · `Api_V1_Billing_Summary` ·
  `Api_V1_Pricing_List` · `Api_V1_Cascade_Dispatch` · `Api_V1_Cascade_Advance`.
  ⚠️ Si una queda con las tarifas viejas, **el cliente ve un precio y se le cobra otro** (el
  front compara el estimado contra el saldo antes de enviar). Una prueba de la suite verifica
  que las 6 coincidan, pero eso es en el repo — en AWS hay que desplegarlas.
- [ ] `[J]` **Revisar los overrides de `pricingRate`**: un valor PLANO por cliente (o global
  con `customerId='*'`) **gana sobre el tramo**. Si alguno quedó en 55 COP/SMS, ese cliente
  sigue comprando bajo costo. Se ven en el panel admin → **Tarifas**.
- ℹ️ **Sin cambios de infra, tablas ni IAM.**
- ℹ️ **WhatsApp NO se tocó**: falta el dato de costo verificado (Meta cobra por conversación/
  mensaje y varía por país). Sigue en 130 → 65 COP; pendiente comercial.

### Verificación post-deploy

1. Portal → **Muestras** con una campaña de **SMS**: la tarjeta de costo debe mostrar el
   precio nuevo y los **segmentos calculados del texto** (ya no es un campo para escribir a
   ojo). Con una emoji en el mensaje, los segmentos deben subir.
2. Un SMS de más de 160 caracteres debe estimarse a **2 segmentos** y **debitar lo mismo**
   que dice el estimado (antes se estimaba 2 y se cobraba 1).
3. Panel admin → **Tarifas** → confirmar que la tabla de tramos de SMS/Voz muestra los
   valores nuevos y que ningún cliente tiene un override por debajo.

⚠️ **La landing ya no publica precios** (los que tenía no coincidían con el backend: decía
$19 por correo a 10.000 y el sistema cobra $25). Si se vuelve a publicar una tabla, tomarla
de `VOLUME_TIERS`, no de la calculadora comercial.

---

## 18. SEO y activos públicos de la landing (ago 2026)

Todo lo de esta sección son **archivos estáticos del front**: entran solos con el build,
no hay nada que crear en AWS. Lo `[J]` es de dominio/hosting.

- [ ] `[J]` **Servir el sitio en `https://www.mailconnect.com.co/`** — el `canonical`,
  `og:url` y `og:image` apuntan ahí con URL ABSOLUTA (los scrapers no resuelven relativas).
  Si el dominio productivo termina siendo **sin `www`**, hay que cambiar esas tres URLs en
  `index.html` y en `sitemap.xml`, o dejar una redirección 301 de uno a otro. Publicar las
  dos versiones sin canonical las hace competir entre sí en Google.
- [ ] `[J]` **Redirección de apex a www (o al revés)** y HTTPS forzado.
- [ ] `[J]` **Rewrite de SPA en el host**: todas las rutas deben servir `index.html`
  (`/legal/*` ya se enlaza desde el footer y desde el sitemap). Sin eso, entrar directo a
  `/legal/terminos` devuelve 404 y Google indexa el error.
- [ ] `[J]` (opcional, cuando el dominio esté en producción) **Google Search Console**:
  verificar la propiedad y enviar `https://www.mailconnect.com.co/sitemap.xml`.
- ℹ️ **Vista previa al compartir:** los scrapers (WhatsApp, LinkedIn, Slack) **cachean** la
  primera respuesta. Si se cambia `og-image.png`, hay que forzar el refresco con el
  depurador de cada plataforma o cambiarle el nombre al archivo.

### Archivos que agrega el build

`favicon.ico` (16/32/48) · `favicon-32x32.png` · `favicon-16x16.png` ·
`apple-touch-icon.png` (180) · `icon-512.png` · `og-image.png` (1200×630) ·
`site.webmanifest` · `robots.txt` · `sitemap.xml`

⚠️ `robots.txt` bloquea `/panel`, `/admin`, `/login`, `/register` y `/reset-password`: son
páginas con sesión, no hay nada que indexar y listarlas solo le da pistas a quien escanea.

⚠️ **Precios en la landing:** la tabla sale de `src/pages/landing/precios.ts`, que es espejo
de `VOLUME_TIERS`. `precios.test.ts` compara contra el `lambda_function.py` real y falla si
divergen — no editar la tabla a mano sin cambiar también las 6 lambdas (ver §17).

---

## 19. Panel SPF/DKIM/DMARC en Dominios (ago 2026)

`Api_V1_Domain_List` agrega el estado real de autenticación por dominio. Es aditivo —
no cambia el contrato existente, solo suma la clave `deliverability`.

- [ ] `[J]` **Sin cambios de IAM.** `ses:GetIdentityDkimAttributes` (para DKIM) ya estaba
  en la lista de permisos de las lambdas de dominio (ver §14 en el histórico de
  `CLAUDE.md`/routes admin). Verificar que el rol de `Api_V1_Domain_List` lo tenga; si es
  `Lambda_SES*` genérico, ya lo cubre.
- [ ] `[J]` (opcional) **Layer de `dnspython`** para que SPF/DMARC se puedan consultar de
  verdad (mismo layer opcional que usa `Api_V1_Database_Verify` para el chequeo MX). **Sin
  el layer no rompe nada**: SPF y DMARC quedan en `unknown` (se ven en gris igual, con el
  tooltip "no se pudo consultar" en vez de "no publicado"); DKIM sigue funcionando porque
  viene de la API de SES, no de DNS.
- [ ] `[J]` (opcional) Env `DELIVERABILITY_MAX_DOMAINS` (default `20`).

### Verificación post-deploy

1. Con un dominio ya verificado (DKIM firmando), abrir su detalle: el chip **DKIM** debe
   salir **verde**.
2. Publicar el TXT `v=spf1 include:amazonses.com ~all` en un dominio de prueba y, tras
   unos minutos de propagación, pulsar **Actualizar estado**: el chip **SPF** debe pasar a
   verde y el bloque de "registro recomendado" para SPF debe desaparecer.
3. Sin el layer de dnspython desplegado: SPF y DMARC deben verse en gris con el tooltip de
   "no se pudo consultar" (no deben salir en verde por accidente, ni deben tumbar el resto
   del listado).

⚠️ **SPF y DMARC no son obligatorios para que el envío funcione** — el remitente usa Easy
DKIM sin un dominio MAIL FROM propio, así que DMARC ya se alinea por DKIM. Si en el futuro
se agrega un MAIL FROM personalizado por cliente, ahí sí SPF pasa a ser necesario para la
alineación y este panel dejaría de ser "recomendado" para ser parte del flujo obligatorio.

---

## 20. Registro numérico, botón en Outlook y textos de relleno (ago 2026)

Tanda de ajustes puntuales. **Casi todo es frontend** (entra con el build, sin nada que
desplegar en AWS); lo único de backend es un cambio de TEXTO en el 429 de Login.

- [ ] `[J]` **Redesplegar `Api_V1_Security_Login`.** Único cambio: el mensaje del bloqueo
  **escalado** (cuando la cuenta ya se había bloqueado antes) ahora explica por qué el
  bloqueo fue inmediato y remite a "¿Olvidaste tu contraseña?". **Sin cambios de IAM, de
  env, de tabla ni de contrato** — el `statusCode` sigue siendo 429 y el front ya muestra
  la `description` que venga del backend. Si no se redespliega, el bloqueo sigue
  funcionando exactamente igual con el mensaje corto de antes.
- **Sin cambios de infra en el resto:** el constructor HTML, el registro y el chequeo
  previo son 100% cliente. Entran con el próximo build del frontend.

### Verificación post-deploy

1. **Registro:** en el campo Teléfono escribir `abc300-123.456` → debe quedar
   `300123456`. Pegar 25 dígitos → debe cortar en **15**. Mismo comportamiento en NIT.
2. **Bloqueo escalado (Login):** fallar 3 veces (bloqueo de 5 min), esperar a que venza y
   fallar **una** vez → el 429 debe traer *"Como ya se había bloqueado antes…"*. En una
   cuenta **nueva**, el segundo fallo debe seguir avisando *"te queda 1 intento"* (el aviso
   de siempre; ese caso no cambió).
3. **Botón en Outlook** — es el punto que **exige un cliente real**, no una vista previa de
   navegador: enviarse una prueba desde el editor y abrirla en **Outlook de escritorio**
   (el de Windows con motor Word; Outlook web y la app nueva usan otro motor y no
   reproducen el defecto). El botón debe salir **redondeado**, con su alto y su ancho, y
   **una sola vez** — si se ve duplicado, el condicional `[if !mso]` no está llegando
   intacto (algún paso intermedio reescribió los comentarios del HTML).
4. **Alineación del botón:** poner "Derecha" en el panel → el botón debe irse a la derecha
   tanto en la vista previa como en el correo recibido (antes se quedaba a la izquierda).
5. **Bloques vacíos:** agregar un bloque de texto y publicar sin escribir nada → **Revisar**
   debe avisar "1 bloque(s) de texto sin contenido". Y el correo real **no** debe traer
   "Título principal" ni "Hola {{nombre}}, escribe aquí…" en ninguna parte.
6. **Variables:** sin base seleccionada, el menú "Insertar variable" solo debe ofrecer
   `unsubscribeUrl` y `preferencesUrl` bajo "Del sistema", más el aviso de elegir una base.
   Con base elegida, aparecen sus columnas reales bajo "De tu base de datos".
7. **Diálogos propios (sin popups del navegador).** En **Plantillas PDF básicas**, seleccionar
   una palabra y pulsar el botón de enlace: debe salir el diálogo de la aplicación y, al
   aceptar, el enlace debe caer **sobre esa palabra** (si cae en otro lado, se perdió la
   selección al abrir el diálogo). Sin nada seleccionado debe ofrecer el campo "Texto que se
   ve". En **Mi cuenta → Desactivar 2FA**: un único diálogo con el aviso y el campo del código.
8. **Editor PDF básico contra el motor real.** Elegir una base en el panel **Datos**: el menú
   "Variable" debe ofrecer sus **columnas reales**. Insertar dos, elegir **Times New Roman**
   sin seleccionar texto y pulsar **Vista previa PDF**: el documento debe salir **con serifa**
   (si sale en Arial, el envoltorio `data-mc-doc` no está llegando) y con los **datos de la
   primera fila** de la base. Una variable que no exista en la base debe verse como
   `{{campo}}`, no como su nombre suelto.


---

## 21. Página configurable del editor PDF (ago 2026)

Márgenes, orientación, encabezado/pie con numeración y salto de página. La configuración
viaja **dentro del HTML** de la plantilla, así que no cambia el esquema de `messageTemplate`
ni el mensaje de la cola.

- [ ] `[J]` **Redesplegar LAS DOS lambdas, juntas**: `Api_V1_Template_Render-pdf` (vista
  previa) y `Api_V1_Template_Combination-EAP-PDF` (envío real). ⚠️ Comparten `wrap_html`
  **copiado**, que es donde vive el motor de página. Si solo se despliega una, la vista
  previa y el PDF que recibe el destinatario dejan de coincidir — exactamente el problema
  que esta tanda vino a cerrar.
- **Sin cambios de infra, IAM, rutas ni layers.** El motor de página usa solo la stdlib
  (`html.parser`, `re`); no suma dependencias al layer.
- **Compatibilidad:** una plantilla guardada antes de esto no trae los `data-*` y se
  renderiza con los valores por defecto, que son los de siempre (A4 vertical, 2 cm, sin
  membrete) — y sin membrete no se declaran marcos, así que su maquetación no cambia.

### Verificación post-deploy

1. **Membrete:** configurar encabezado "ACME" y pie `Página [[pagina]] de [[paginas]]`,
   escribir contenido que ocupe 3 hojas y generar la vista previa: el encabezado debe salir
   en **las 3** y el pie numerar 1, 2 y 3 de 3.
2. **El mismo membrete en el ENVÍO REAL:** guardar esa plantilla, usarla en una campaña
   EAP-PDF y enviarse una muestra. El PDF adjunto debe traer el membrete y la numeración
   igual que la vista previa. Si la vista previa los trae y el adjunto no, falta desplegar
   el combinador.
3. **Orientación y márgenes:** poner horizontal con margen izquierdo 1,5 cm → el PDF debe
   salir apaisado y con ese margen.
4. **Salto de página:** botón "Salto de página" a mitad del texto → lo que sigue arranca en
   hoja nueva.
5. **Variable llamada "pagina":** con una base que tenga una columna `pagina`, el pie debe
   seguir numerando (los corchetes no se confunden con las llaves de datos).
6. **Plantilla vieja:** cargar una guardada antes de esta tanda → debe verse y renderizar
   igual que antes, con A4 vertical y 2 cm.

---


---

## 23. Correos internos con identidad de marca (ago 2026)

Los 8 correos que envía la plataforma (activación, códigos, avisos al owner) pasan a un
armazón común con logo, botón bulletproof y pie con redes.

- [ ] `[J]` ⚠️ **Desplegar el FRONTEND antes o junto con las lambdas.** Los assets del
  correo (`logo.png` y `red-*.png`) viven en `05_Frontend/.../public/email/` y se sirven
  desde `https://www.mailconnect.com.co/email/`. Si las lambdas salen primero, los correos
  se envían con las imágenes rotas (degradan al texto `alt`, pero se ve mal).
- [ ] `[J]` **Redesplegar las 6 lambdas** que envían correo interno:
  `Api_V1_Security_{Register,Create-otp,Recovery-password}`, `Api_V1_Notifications_Scan`,
  `Api_V1_Email_Prepare-batch-template`, `Api_V1_Admin_User-support`.
  ⚠️ El armazón está **copiado** en las seis: si una queda atrás, sus correos se ven
  distintos a los demás. La prueba `test_las_seis_comparten_el_armazon` lo detecta en CI,
  pero no puede detectar un despliegue parcial.
- [ ] `[J]` **Confirmar las URLs de los perfiles de redes.** Están derivadas de la marca
  (`linkedin.com/company/mailconnect`, `facebook.com/mailconnect`,
  `instagram.com/mailconnect`) y **no están verificadas**. Se cambian con las envs
  `SOCIAL_LINKEDIN` / `SOCIAL_FACEBOOK` / `SOCIAL_INSTAGRAM` sin tocar código; una red con
  valor vacío desaparece del pie.
- **Envs opcionales** (todas con default): `SITE_URL`, `EMAIL_ASSETS_URL`, `CONTACT_EMAIL`,
  `WHATSAPP_URL`. **Sin cambios de IAM, rutas, tablas ni layers.**

### Verificación post-deploy

1. Registrar una cuenta de prueba: el correo debe llegar con el logotipo, el botón azul
   redondeado y el pie con las 4 redes.
2. **Abrirlo en Outlook de escritorio de Windows** (motor Word) — es el único que reproduce
   los dos defectos que esto corrige: el correo debe quedar **acotado a 600 px** (antes se
   desparramaba a todo el ancho) y el botón **redondeado y de su tamaño**, una sola vez.
3. Con las imágenes bloqueadas (lo normal en Gmail y Outlook): debe leerse "MailConnect"
   donde va el logotipo y el nombre de cada red — no huecos vacíos.
4. Pedir un código de recuperación: en la bandeja, **antes de abrir**, el preheader debe
   mostrar el código junto al asunto.
5. Hacer clic en cada icono del pie: los cuatro deben abrir el perfil correcto. Si alguno
   cae en un 404, es el punto de "confirmar las URLs" de arriba.
