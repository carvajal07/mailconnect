# Revisión de Seguridad y Base de Datos (Escalabilidad) — Backend Lambdas

> **Alcance:** revisión de las ~60 lambdas de `04_Backend/lambdas/` con dos focos:
> **(1) seguridad** y **(2) patrón de acceso a DynamoDB / escalabilidad** para que la
> plataforma soporte muchos usuarios y muchas consultas y sea fácil de escalar.
>
> **Método:** lectura completa de cada `lambda_function.py`, agrupadas en 5 bloques
> (seguridad/auth, admin/config/pricing, campañas/plantillas/datos, pipeline de email,
> canales SMS/WSP/Voz + reportes). Cada hallazgo cita `archivo:línea`. Los hallazgos
> "CRÍTICA" marcados con ✔ fueron verificados a mano sobre el código.
>
> _Fecha: 2026-07-15 · Rama: `claude/lambda-security-db-review-4yxm8o`_

---

## 0. Resumen ejecutivo

El backend tiene una **base sólida de intención** (JWT con algoritmo fijado, Authorizers
fail-closed, OTP con CSPRNG y hasheado, salt por usuario, `batch_writer`, paginación en
varias lambdas, clientes boto3 fuera del handler). Pero hay **tres clases de problemas
sistémicos** que hoy impiden decir que el sistema es seguro o escalable:

1. **Aislamiento multi-tenant que depende de un mapping template aún NO desplegado.**
   Casi todas las lambdas caen al `body` cuando el context del Authorizer no llega
   (`auth.get('customerId') or payload.get('customerId')`). Como ese mapping está
   pendiente (`[J]` en el propio CLAUDE.md), **hoy un cliente autenticado puede leer,
   editar y borrar datos de otro cliente** simplemente poniendo su `customerId`/`customer`
   en el cuerpo. Esto es lo más grave del proyecto.

2. **`Scan` de tabla completa para buscar por atributo no-clave** (email, customerId,
   campaignId…). Hay **64 usos de `.scan()` en 39 lambdas**; el login, el registro, el
   OTP, los listados y los paneles admin escanean tablas enteras y filtran en memoria.
   Es O(n) sobre TODA la tabla (todos los tenants), y **muchos escaneos no paginan** →
   además de lento y caro, dan **falsos negativos** cuando la tabla supere 1 MB (un
   usuario real "no encontrado", un login que falla intermitentemente). Este es el techo
   de escalabilidad número uno.

3. **Fallos convertidos en pérdida silenciosa + recursos AWS creados/borrados en caliente.**
   Los consumidores SQS solo leen `Records[0]` (pierden 9 de 10 mensajes con batch>1),
   capturan excepciones y devuelven 200 (SQS borra el mensaje → envíos perdidos), no hay
   DLQ ni `ReportBatchItemFailures`, y se crean/borran **tablas DynamoDB por proceso**
   (límite ~2.500 tablas/cuenta) en el request path.

Además hay **bugs que hacen que código crítico ni siquiera funcione hoy**: EAU envía un
HTML hardcodeado de otro cliente, `Cron_DeleteTables` revienta con `NameError`,
`SQS_DeleteTables` referencia un cliente `s3` inexistente y puede borrar tablas core, y
`Api_V1_Combination` nunca serializa el mensaje a la cola EAP.

**Orden recomendado de trabajo:** Fase 0 (bugs que rompen prod) → Fase 1 (aislamiento
tenant, el riesgo de seguridad) → Fase 2 (escalabilidad DynamoDB: GSIs + quitar scans) →
Fase 3 (hashing, OTP hardening, DLQ/idempotencia) → Fase 4 (hardening fino). Detalle en §6.

---

## 1. Hallazgos CRÍTICOS (bloquean producción)

### 1.1 Seguridad — Aislamiento multi-tenant falsificable por el body ✔
**Dónde:** patrón `auth.get('customerId') or payload.get('customerId')` en casi todas las
lambdas de lectura/escritura. Ejemplos concretos:
- `Api_V1_Campaign_List/lambda_function.py:53` — leer campañas de otro cliente.
- `Api_V1_Campaign_Update/lambda_function.py:65` — `if tenant_customer_id and ...`: sin
  context, edita la campaña de cualquier tenant.
- `Api_V1_MessageTemplate_Delete/lambda_function.py:47` — borra plantillas ajenas.
- `Api_V1_Database_Delete/lambda_function.py:102-108` — borra la base (registro + CSV) de otro.
- `Api_V1_Reports_Statistics/lambda_function.py:160-161` — métricas de otro cliente.
- `Api_V1_Email_Prepare-batch-template/lambda_function.py:252-257,1074` — `customerName` y
  `campaignName` del body + `scan` global por nombre → disparar el envío de otro tenant.
- Admin (`Api_V1_Admin_*`, `Api_V1_Customer_*`, `Api_V1_Pricing_*`, `Api_V1_User_SetRole`,
  `Api_V1_Config_*`): `_is_admin()` lee `role` del `requestContext.authorizer`; en no-proxy,
  si el mapping template hace passthrough del body, un no-admin manda
  `{"requestContext":{"authorizer":{"role":"admin"}}}` y **se auto-promueve, cambia tarifas,
  deshabilita envíos de cualquier cliente y redirige el `ACTIVATION_URL` a un dominio de phishing**.

**Impacto:** IDOR de lectura/escritura/borrado cross-tenant + escalada a admin. Es la
combinación de que el fallback existe *y* el mapping template está pendiente.

**Arreglo:**
- **Fail-closed:** si `event.requestContext.authorizer.customerId` (o `role` para admin) no
  llega, responder **401/403** — nunca caer al body. Adoptar en TODAS las lambdas el patrón
  que ya usan `Template_List:63-65` y `Blacklist_List:55-56` (ignoran el body si el token
  trae identidad), pero endurecido a "si no hay token, corta".
- Desplegar el mapping template que inyecta `$context.authorizer.{customerId,customer,role,userId}`
  o pasar esas rutas a **integración proxy** (donde el context no es falsificable).
- **Doble barrera:** validar el JWT dentro de las lambdas admin con el mismo `SECRET_KEY`.

### 1.2 Seguridad — Nombre de tabla/bucket construido con string del cliente ✔
**Dónde:** `f"{customer}_blackList"` y `f"{customer}_sendStatus"` con `customer` del body:
- `Api_V1_Blacklist_List:63`, `Api_V1_Blacklist_Delete:62`, `Api_V1_Blacklist_Add:86-90`
  (este además hace `create_table` con nombre derivado del body).
- `Api_V1_Sms_Send-batch:55`, `Wsp:62`, `Voice:61`, `Messaging_ReceptionStatus:88`.
- `Api_V1_Campaign_Prefirm-url` y `Api_V1_Combination:196` construyen **buckets** con el
  string del cliente.

**Impacto:** leer/escribir/borrar la lista negra de otra empresa (desbloquear contactos que
se quejaron → daño a la reputación SES **compartida**), y **crear tablas/buckets arbitrarios**
hasta agotar el límite de la cuenta (DoS).

**Arreglo:** derivar el `customer` **solo del token**; validar contra la tabla `customer`;
sanitizar con allowlist `^[A-Za-z0-9_]+$`; sacar `create_table`/`create_bucket` del request
path. Mejor aún: **una sola tabla `blackList`** con PK compuesta `customerId`+`email` (elimina
la inyección de raíz). `Api_V1_Template_Combination:19-21` ya tiene el patrón correcto
(`tenant_bucket` sanitiza el NIT) — generalizarlo.

### 1.3 Seguridad — `Prefirm-url` sin identidad + IDOR de plantillas
- `Api_V1_Campaign_Prefirm-url/lambda_function.py:60-90` — `customer`/`nit` del body, ninguna
  lectura del Authorizer: pedir URL prefirmada de `PUT` al bucket de otro tenant (envenenar
  su base). `document_name` sin validar (path traversal en la key), `ExpiresIn=3600`, y
  `print(url)` (línea 95) vuelca la **URL firmada completa** a CloudWatch.
- `Api_V1_Template_Delete-template/lambda_function.py:29-31` — `delete_template` sin ninguna
  verificación: **cualquier autenticado borra cualquier plantilla SES** de la plataforma.
- `Api_V1_Template_Get-template/lambda_function.py:19-28` — leer el HTML de plantillas ajenas
  (nombres predecibles `{customer}_{n}_{canal}_{nombre}`).
- `Api_V1_MessageTemplate_Create:91-121` — upsert por `messageTemplateId` sin comparar el
  `customerId` dueño → sobrescribir la plantilla de otro.

**Arreglo:** tomar identidad del token; exigir `templateName.startswith(f'{customer_token}_')`
antes de get/delete; validar `document_name` (basename + allowlist + extensión); no loguear
la URL; bajar `ExpiresIn` a ~300 s.

### 1.4 Seguridad — `Reports_state-report` y `Agent_Reports`: exfiltración de PII cross-tenant
- `Api_V1_Reports_state-report/lambda_function.py:174-183` — `cliente` viene del request y
  decide qué tablas leer; sin validar contra el token, cualquiera descarga el CSV con
  **correos y nombres de otro tenant**. Además `s3_bucket`/`s3_prefix` los elige el caller
  (línea 180-181) → escribe el reporte a **su propio bucket** (exfiltración).
- `Api_V1_Agent_Reports/lambda_function.py:1004-1013` — el tenant lo decide el
  parámetro del tool de Bedrock; con prompt injection se obtiene `full_report` de otro
  cliente y una **URL prefirmada pública** al Excel (línea 963-967).

**Arreglo:** `cliente`/`customerId` solo de sesión autenticada (sessionAttributes firmados en
el caso del agente); bucket/prefix fijos en servidor; validar `idProceso` contra `process`
del tenant.

### 1.5 Escalabilidad — `Scan` por atributo no-clave en todo el hot path ✔
**Dónde (muestra):** login/registro/OTP escanean `user`/`customer` completas
(`Login:77,89,133`, `Register:82,91,100`, `Create-otp:74`, `Validate-otp:26,51`,
`Change-password:65,108`, `Account-activation:53`); paneles admin escanean `campaign`/`process`
por cliente (`Admin_Dashboard:176,180`, `Billing_Summary:176,180`, `Admin_Jobs:121,138`);
listados (`Campaign_List:65`, `Database_List:62`, `MessageTemplate_List:51`). Varios escanean
su **propia PK** (`Campaign_Update:59` sobre `campaignId`, `Customer_Update:53` sobre
`customerId`, `Customer_Detail:72`) — deberían ser `get_item`.

**Impacto:** cada operación lee toda la tabla (todos los tenants) → RCU y latencia crecen
linealmente con el número de usuarios; con miles de usuarios el login se vuelve lento y caro.

**Arreglo:** crear **GSIs** y reemplazar `scan` por `query`/`get_item`:
| Tabla | GSI (HASH / RANGE) | Reemplaza el scan de |
|-------|--------------------|----------------------|
| `user` | `email` | Login, Register, Change-password, Logout, Create-otp, Validate-otp |
| `customer` | `companyTin`; y `get_item` por PK `customerId` | Register, Customer_*, Blacklist_*, Template_* |
| `campaign` | `customerId` / `date`; `get_item` por `campaignId` | Campaign_List/Update, Statistics, Dashboard, Jobs |
| `process` | `customerId` / `date` | Statistics, Dashboard, Billing, Jobs |
| `oneTimePassword` | `userId` | Create/Validate-otp, Change-password |
| `session` | `userId` | Logout |
| `userActivation` | `activationKey` | Account-activation |
| `databaseFile` | `customerId` / `uploadDate` | Database_List |
| `messageTemplate` | `customerId` / `created` | MessageTemplate_List |
| `adminAudit` | `auditMonth` / `date` + TTL | Admin_Audit |

### 1.6 Escalabilidad — Agregaciones en memoria sobre tablas enteras (paneles admin)
- `Admin_Dashboard:161-180` — **scans anidados**: por cada cliente escanea `campaign` y
  `process` COMPLETAS → 100 clientes = 100+100 scans completos por carga del panel;
  `_states_of_process` carga un dict `{messageId: estado}` de todos los eventos (OOM/timeout
  con campañas de millones).
- `Billing_Summary:147-208` — igual, y el **truncado corrompe las cifras**: agotado
  `MAX_PROCESSES=500`, los clientes al final del scan aparecen con consumo **$0** pero se
  muestran como monto real; `_load_rate` se llama por campaña sin caché (miles de GetItem).
- `Admin_Jobs:138-140` — `scan` completo de `campaign` por cada `campaignId` (debería ser
  `get_item`).

**Arreglo:** **pre-agregar contadores por proceso** (un ítem-resumen que ReceptionStatus
actualiza con `ADD` al llegar cada evento) en vez de recontar mensaje a mensaje; Query por
GSI; caché de tarifas por `(customerId, channel)` dentro de la invocación; si hay truncado,
**excluir** a los clientes no computados en vez de mostrarlos en cero; considerar
materializar el dashboard con un job programado.

### 1.7 Escalabilidad/Robustez — Consumidores SQS solo procesan `Records[0]` ✔
**Dónde:** `EM:281`, `EAU:561`, `EAP:232`, `Messaging_ReceptionStatus:191`, `Combination:157`,
`Template_Combination:168`, `CombinacionPython3-9:74`.
**Impacto:** con `BatchSize>1` (default 10), 9 de cada 10 mensajes se borran sin procesar →
**pérdida masiva de envíos/estados**.
**Arreglo:** `for record in event["Records"]:` + `ReportBatchItemFailures` (devolver
`batchItemFailures`), o fijar `BatchSize=1`. Configurar **DLQ** en todos los event source mappings.

### 1.8 Escalabilidad — Tabla DynamoDB nueva POR PROCESO
**Dónde:** `Prepare-batch:1142,597` crea `{customer}_sendDetail_{process_id}`; escrita en
`EM:118`, `EAU:143`. `SQS_DeleteTables`/`Cron_DeleteTables` existen para limpiarlas.
**Impacto:** límite ~2.500 tablas/región + `CreateTable` throttleado/asíncrono (se escribe
antes de `ACTIVE` → carreras). `sendStatus` ya se unificó a tabla única; **falta hacer lo
mismo con `sendDetail`** → tabla `{customer}_sendDetail` con PK `processId` + SK.

### 1.9 Robustez — Código crítico que hoy NO funciona ✔
- **`EAU` envía HTML hardcodeado de "Mercacaldas".** `Send-batch-template-EAU:477-552` fija
  `html = """...<title>Mercacaldas Octubre 2025</title>..."""` y la línea real
  `#html = response_template["Template"]["HtmlPart"]` (618) está **comentada** → todo envío
  EAU sale con la campaña de otro cliente. Arreglo: descomentar y usar el HTML del template.
- **`Cron_DeleteTables` revienta con `NameError`.** `batch.append(...)` (línea 34) sin
  `batch = []` previo; y `QUEUE_URL = "SQS_QUEUE_URL"` (línea 9) es un placeholder. El cron
  de limpieza está muerto.
- **`SQS_DeleteTables` está roto y es peligroso.** Referencia `s3` (líneas 11,17,49) que
  **nunca se define** (solo hay `ddb`/`dynamodb`) → falla siempre, pero **después** de marcar
  `TABLE-DELETING`; usa `lifeCycleStatus` (76) vs `lifecycleStatus` (105,118) inconsistentes;
  `delete_table(TableName=event["tableName"])` (113) **sin allowlist** → un mensaje corrupto
  puede borrar `user`/`customer`/`campaign`. `ACCOUNT = "ACCOUNT_ID"` (9) es placeholder.
- **`Api_V1_Combination` nunca encola a EAP.** `send_sqs:30-53` hace
  `send_message(MessageBody=message)` con `message` **dict** (no `json.dumps`) → lanza,
  se traga el error, la parte se pierde. `Template_Combination:54` sí serializa.
- **`Api_V1_Email_Send-batch-template-EAP` no registra estados** (`sendStatus`/`sendDetail`)
  → los envíos EAP son invisibles para reportes y facturación; `insert_sendDetail:102-128`
  es código muerto (uso incorrecto de `batch_write_item`).
- **`CombinacionPython3-9`** (si sigue desplegada) sube DOCX **vacíos** (`doc.save` nunca se
  llama) y con datos del primer registro repetidos (no re-carga la plantilla por render).

---

## 2. Hallazgos ALTOS

### Seguridad
- **Hashing de contraseñas con SHA-256 de una pasada** (`Register:211-214`, `Login:161-166`,
  `Change-password:158-159`). Aunque hay salt aleatorio por usuario, un volcado de `user`
  permite miles de millones de intentos/segundo por GPU. → **bcrypt / argon2id / PBKDF2**
  (≥600k iter). Migración transparente: rehashear al próximo login.
- **OTP de 6 dígitos sin límite de intentos** (`Change-password:102-122`, `Validate-otp:36-74`).
  Con `forgot-password` + fuerza bruta en la ventana de 5 min → **account takeover**. →
  máx. 3-5 intentos por OTP (contador atómico), invalidar al exceder, rate limit por IP/usuario.
- **Refresh-token deslizante infinito sin revalidar contra la BD** (`Refresh-token:53-90`):
  no relee `active`/`role` → un usuario desactivado o degradado conserva `role:admin`
  indefinidamente; no hay vida máxima de sesión. → revalidar en cada refresh + tope absoluto.
- **Sin revocación de JWT tras cambio de contraseña** (`Logout`, `Change-password:161-165`):
  el token del atacante sigue válido hasta 24 h. → claim `pwdChangedAt` comparado en el Authorizer.
- **`realSendEnabled` fail-open** (`Login:82-84`): default `True` si falta el campo; para un
  control de bloqueo de envíos el default seguro es `False`.
- **`SECRET_KEY` con default `''` al FIRMAR** en las lambdas de envío (`EM:26`, `EAU:42`) →
  tokens de desuscripción forjables con clave vacía. → abortar si no está configurada
  (como ya hace `Unsubscribe:129`).
- **`Campaign_Create-campaign` — `from` sin validar** (`:165-169`): spoofing de remitente
  entre identidades verificadas; `dataPath`/`template` sin validar → apuntar al CSV de otro
  tenant. La máscara nunca se aplica (`if (not "" in mask):` siempre falso).

### Escalabilidad / Robustez
- **Ningún consumidor SQS implementa `ReportBatchItemFailures` ni DLQ** (SMS/WSP/Voz,
  ReceptionStatus, Combination×3): el patrón "capturar, `print`, devolver 200" convierte
  fallos en **pérdida silenciosa**. Es el problema de robustez más extendido.
- **Fallos de EUM tratados como "Rechazado" permanente** (`Sms:109-112`, `Wsp:112-115`,
  `Voice:118-121`): un `ThrottlingException` marca al destinatario como rechazado para
  siempre. → distinguir transitorio vs permanente + reintento.
- **Sin rate limiting hacia SES/EUM** (`EM:199`, `EAU:391`, `Sms:96-107`): SMS/Voz tienen
  TPS bajos; con concurrencia Lambda se supera el límite al instante. → reserved/maximum
  concurrency + token bucket + backoff.
- **Reintentos SQS → envíos duplicados** (SMS/WSP/Voz sin idempotencia): SQS es at-least-once;
  si la Lambda muere a mitad de lote se re-envían mensajes. → `PutItem` condicional por
  `(processId, uniqueId)` antes de enviar.
- **Scans sin paginación → falso 404/negativos** (`Customer_Update:53-59`, `Database_List:62`,
  `Campaign_Create consult_consecutive:45-51`): cuando la tabla pase de 1 MB, el ítem puede
  no aparecer. En `consult_consecutive` el consecutivo **se reinicia a "0001"** → duplicados.
- **Contadores no atómicos (race conditions):** consecutivos de campaña/plantilla
  (`Create-campaign:39-87`), `samplesSentCount` (`Prepare-batch:670-808`), "último admin"
  (`User_SetRole:63-74` → dos degradaciones concurrentes dejan 0 admins). → `UpdateExpression
  ADD` / `ConditionExpression`.
- **Registro de usuario sin atomicidad** (`Register:198-280`): `valid_email` (scan) + `put_item`
  sin `ConditionExpression` → dos registros concurrentes crean **dos usuarios** con el mismo
  email. → único sobre email (GSI + tabla de emails con PK=email, o transacción condicional).

---

## 3. Hallazgos MEDIOS (selección)

- **Enumeración de usuarios** en `Create-otp:145`, `Validate-otp:46`, `Change-password:142`,
  `Login:191/194` (404 vs 423 revela cuentas) + **timing** en Login (no calcula hash si el
  usuario no existe). → respuestas genéricas + hash dummy.
- **Múltiples OTP activos simultáneos** (`Create-otp`, `Recovery-password`) y **expiración del
  OTP controlada por el cliente sin tope** (`Create-otp:137-140`: `expiration` del payload).
  → invalidar OTPs previos + `min(expiration, 15)`.
- **Consumo de OTP no atómico (TOCTOU)** (`Validate-otp:57-66`, `Change-password:113-121`):
  `update SET active=false` sin `ConditionExpression=active=true`.
- **Token de activación:** reuso simula ÉXITO y fecha no parseable omite expiración
  (`Account-activation:65-75`, fail-open).
- **XSS latente** en la página pública de Unsubscribe (`Unsubscribe:159-161`, email sin
  `html.escape`).
- **Inyección de fórmulas CSV/Excel** en los reportes (`state-report:145-156`, `Agent_Reports:503`,
  Combination): un valor `=HYPERLINK(...)` se ejecuta al abrir. → prefijar `'` en celdas que
  empiecen con `= + - @`.
- **Config con validación débil** (`Config_Set:95-112`): `ACTIVATION_URL` acepta cualquier
  texto; `OTP_EXPIRATION_MIN` acepta 0 o valores enormes. Combinado con 1.1 → phishing de
  plataforma. → regex/URL con `https://` + allowlist, rango 1-60.
- **CSV completo a `/tmp`** en el splitter (`Prepare-batch:1180`): límite 512 MB + 15 min.
- **Partición caliente** en `{customer}_sendStatus` (PK=processId): todos los estados de una
  campaña en una partición → throttling. → sufijo de sharding.
- **`csv_base64` en la respuesta** (`state-report:169`, `Agent_Reports`): choca con el límite
  de 6 MB de payload Lambda; forzar vía S3 sobre cierto tamaño.
- **Atribución cruzada por nombre de empresa** (`Dashboard`/`Billing` filtran `process` por
  `customerName` pero `campaign` por `customerId`): si el nombre cambia/duplica, la
  facturación se asigna mal. Verificar además el esquema real de la tabla de estados
  (`{company}_sendStatus` vs `{customer}_sendStatus_{proceso}`) — si está desalineado, panel
  y facturación reportan **$0 sin error**.
- **`KeyError`/campo faltante → 500 en vez de 400** (`Register:191`, `Login:139`,
  `Create-campaign:199`), `except:` desnudos, regiones SES inconsistentes
  (`us-east-1` vs `us-east-2` entre Template_Create/List y Get/Delete → plantillas "no
  encontradas"), `NameError` en rutas de error (`Get-template:52`, `Prefirm-url:89`).
- **Auditoría best-effort** (`Config_Set`, `User_SetRole`, `Pricing_Update`, `Customer_Update`):
  si `adminAudit` no existe o falta permiso, la acción se ejecuta **sin evidencia** (solo un
  `print`). Hacerla bloqueante para `user.role` y `config.set`.
- **PII masiva en logs** (`Prepare-batch:652,728`, `EM:282`, `Sms:112`, `ReceptionStatus:201`,
  `Login:176,198`, `Account-activation:45 print(event)`): correos/celulares/nombres en
  CloudWatch (relevante para Ley 1581). → bajar a debug / enmascarar.

---

## 4. Deuda menor y limpieza (BAJOS)
- Comparaciones no timing-safe (`Login:166`, `Change-password:97`): usar `hmac.compare_digest`.
- Email sin normalizar a minúsculas (`Register`): `User@x.com` vs `user@x.com` → duplicados.
- `Register` no valida fortaleza de contraseña (solo `Change-password` lo hace).
- Colisión de prefijos de plantillas entre empresas cuyo nombre es prefijo de otra
  (`Template_List:81`): usar `customerId` en el nombre.
- Respuestas/envelopes inconsistentes (con/sin `data`, `statusCode` snake vs camel, `201`
  para un delete en `Delete-template:15`).
- `Verify-code` es un stub que responde 200 siempre — no rutear hasta implementarlo.
- Imports muertos, `datetime.utcnow()` deprecado, `except (ClientError, Exception)` redundante,
  `MessageType:'TRANSACTIONAL'` para marketing (SMS), account IDs hardcodeados en URLs SQS,
  estado en variables `global` (frágil en Lambda caliente).

---

## 5. Patrones positivos (mantener)
- JWT con **algoritmo fijado** (`algorithms=['HS256']`) → sin `alg=none`.
- **Authorizers fail-closed** (deniegan por defecto).
- OTP con **CSPRNG** (`secrets.randbelow`) y **almacenado hasheado**; salt aleatorio por usuario.
- **Sin inyección NoSQL** (todas las FilterExpression usan `ExpressionAttributeValues`).
- **Anti-enumeración** correcta en `Recovery-password` (respuesta genérica).
- **`SECRET_KEY` siempre por env**, sin secretos hardcodeados en el código.
- **Clientes boto3 fuera del handler** en todos los archivos (reutilización warm).
- **Lock idempotente de envío real** con `UpdateItem`+`ConditionExpression` (`Prepare-batch:213`).
- **`BatchGetItem` troceado** para lista negra/desuscritos (`Prepare-batch:502-532`) — evita N+1.
- **`batch_writer`**, paginación con `LastEvaluatedKey` en varias lambdas, `ProjectionExpression`
  con manejo de palabras reservadas, whitelisting de campos de escritura (`Pricing_Update`,
  `Config_Set`, `User_SetRole`), flags `truncated`, `Query`+GSI en `Agent_Reports`.
- **Migración en curso a tabla única `sendStatus`** (dirección correcta; falta `sendDetail`).
- **`tenant_bucket` sanitiza el NIT** en `Template_Combination` — patrón a generalizar.

---

## 6. Plan de remediación por fases

> **Estado de implementación (rama `claude/lambda-security-db-review-4yxm8o`):**
> **Fase 0 ✅** (salvo registro de estados en EAP y el render de `CombinacionPython3-9`,
> que requieren verificación del pipeline real y quedan pendientes). **Fase 1 ✅** a nivel
> de código: aislamiento tenant fail-closed opcional vía `STRICT_TENANT`, verificación de
> dueño e higiene de identidad. **Falta el paso de infraestructura**: desplegar el mapping
> template que inyecta `$context.authorizer.*` (o pasar a proxy) y luego **activar
> `STRICT_TENANT=true`** en las lambdas para que el fail-closed entre en vigor. Mientras
> `STRICT_TENANT` esté desactivado, el comportamiento es el legacy (no rompe la app, pero
> el fallback al body sigue disponible). Pendientes de Fase 1: JWT como segunda barrera en
> lambdas admin, y tenant del agente Bedrock (`Agent_Reports`) por sessionAttributes.
>
> **Fase 2 ✅ (parte A + B ready):**
> - **Scan-sobre-PK → GetItem** (correcciones puras, sin infra): `Customer_Update`
>   (además update condicional atómico, sin falso 404), `Customer_Detail`, `Campaign_Update`,
>   `Admin_Jobs` (lookup de campaña), `Template_List` y `Blacklist_{Add,Delete,List}`
>   (`_customer_name`), `Database_Delete` (`_customer_nit`).
> - **Paginación** de los Scan del consecutivo en `Campaign_Create-campaign` y
>   `Template_Create-template` (elimina el reinicio a "0001" + inserción de duplicados);
>   y del fallback por nombre en `Database_List`.
> - **Facturación honesta:** `Billing_Summary` marca cada fila `partial` y reporta
>   `skippedCustomers` cuando se agota el tope (antes desaparecían/subestimaban en silencio).
> - **Listo para GSI (gate `USE_GSI`):** `Campaign_List`, `MessageTemplate_List`,
>   `Database_List` usan `_items_by_customer` → Query por GSI si `USE_GSI=true`, si no Scan
>   paginado. Al desplegar el GSI `customerId-index` se activa con `USE_GSI=true`.
>
> **Pendiente de Fase 2 (arquitectural, requiere verificación del pipeline real):**
> pre-agregación de contadores por proceso para `Admin_Dashboard`/`Billing_Summary`/
> `Reports_Statistics` (hoy recuentan mensaje a mensaje sobre `*_sendStatus`), unificación
> de `sendDetail` a tabla única, y contadores atómicos (consecutivos, último admin) que
> requieren migrar la PK.
>
> **Fase 3 ✅ (auth) + parte segura del pipeline:**
> - **Hashing:** PBKDF2-HMAC-SHA256 (stdlib) con formato `pbkdf2$iter$hex`, verificación
>   compatible con el sha256 viejo (timing-safe) y **rehash transparente al login**;
>   iteraciones por env (`PBKDF2_ITERATIONS`, default 600000).
> - **OTP:** tope de vigencia (`MAX_OTP_EXPIRATION_MIN`), un solo OTP activo por usuario
>   (invalida previos en Create-otp/Recovery), **límite de intentos** (`MAX_OTP_ATTEMPTS`) y
>   **consumo atómico** (`ConditionExpression active=true`) en Validate-otp y change-password;
>   comparación de hash timing-safe y scans paginados.
> - **Refresh-token:** revalida `active`/`role` contra la tabla `user` y aplica **vida máxima
>   de sesión** (`MAX_SESSION_DAYS`) con `iat` preservado; Login emite `iat`.
> - **Canales SMS/WSP/Voz (parte segura):** fallan ruidosamente si falta la identidad de
>   origen (SQS retiene y reintenta, en vez de marcar todo "Rechazado" y borrarlo),
>   enmascaran el celular en logs (PII) y el `MessageType` de SMS es configurable.
>
> **Pendiente de Fase 3 (infra + verificación del pipeline real, no se improvisa):**
> DLQ por cola, `ReportBatchItemFailures` + **idempotencia** por `(processId, uniqueId)` en
> los consumidores (para retry sin duplicar envíos — cambio con riesgo de doble cobro si se
> hace a ciegas), rate limiting/backoff hacia SES/EUM y reserved/maximum concurrency (infra),
> y contadores atómicos que requieren migrar la PK (compartido con Fase 2).
>
> **Fase 4 ✅ (hardening fino):**
> - **Login:** hash "dummy" cuando el usuario no existe (anti-timing/enumeración),
>   `except:` desnudo → `KeyError`(400)/`Exception`(500), y se quitó el log con el nombre.
>   Los códigos 404/423 se mantienen (contrato de producto + tests).
> - **Email en minúsculas** en Register (almacenamiento) y en los lookups de
>   Login/Create-otp/Validate-otp/Change-password/Recovery (evita cuentas duplicadas por
>   mayúsculas). **Register valida fortaleza de contraseña** y `KeyError`→400.
> - **Unsubscribe:** `html.escape` del email (defensa en profundidad XSS).
> - **Inyección de fórmulas CSV/Excel** neutralizada en `Reports_state-report` y
>   `Agent_Reports` (prefija `'` si la celda empieza con `= + - @`).
> - **Config_Set:** `ACTIVATION_URL` exige `https://`, `OTP_EXPIRATION_MIN` acotado 1..60,
>   email con regex real.
> - **Account-activation:** ya no loguea el evento (traía la activationKey) y trata la
>   fecha no parseable como **expirada** (fail-closed; antes activaba igual).
> - **Región SES** de Template Get/Delete alineada con Create/List vía `SES_REGION`
>   (default us-east-1); antes us-east-2 → plantillas "no encontradas".
> - **Fix de regresión:** el cambio de canales de Fase 3 (lanzar sin config de origen)
>   había roto 3 tests que codificaban el comportamiento viejo; se actualizaron para
>   esperar la excepción (SQS retiene/reintenta).
>
> **Pendiente de Fase 4 (infra):** mover `SECRET_KEY` a **AWS Secrets Manager** y
> **rotarla** (la clave vieja quedó en el historial git). El endurecimiento de la
> enumeración por HTTP code (404 vs 423) queda como decisión de producto (hoy es contrato
> con el frontend).
> Pruebas: **179/179 en verde**.

### Fase 0 — Bugs que rompen producción hoy (rápido, alto impacto)
- [ ] EAU: descomentar `html = response_template["Template"]["HtmlPart"]` y borrar el HTML de
      Mercacaldas (`Send-batch-template-EAU:477-618`).
- [ ] `Cron_DeleteTables`: inicializar `batch = []` (por página) y leer `QUEUE_URL` de env.
- [ ] `SQS_DeleteTables`: definir `s3 = boto3.client('s3')`, unificar `lifeCycleStatus`,
      leer `ACCOUNT` real, y **añadir allowlist de tablas** (`*_sendDetail_*`/`*_sendStatus_*`)
      + IAM del rol restringida por prefijo de ARN antes de `delete_table`.
- [ ] `Api_V1_Combination`: `json.dumps(message)` antes de encolar a EAP.
- [ ] EAP: registrar `sendStatus`/`sendDetail` por destinatario (como EM).
- [ ] Consumidores SQS: iterar `event["Records"]` (no `Records[0]`).
- [ ] Retirar/arreglar `CombinacionPython3-9` si sigue desplegada.

### Fase 1 — Aislamiento multi-tenant (seguridad P0)
- [ ] Hacer el tenant del Authorizer **obligatorio (fail-closed)** en todas las lambdas;
      eliminar el fallback `or payload.get(...)`.
- [ ] Desplegar el mapping template (`$context.authorizer.*`) o pasar rutas a **proxy**.
- [ ] Validar dueño antes de get/delete en Template SES, MessageTemplate, Database, Blacklist.
- [ ] `Prefirm-url` / `state-report` / `Agent_Reports`: identidad solo de sesión; bucket/prefix
      y `document_name` validados en servidor; no loguear URLs firmadas.
- [ ] Validar JWT dentro de las lambdas admin (segunda barrera).

### Fase 2 — Escalabilidad DynamoDB (P0 para crecer)
- [ ] Crear los **GSIs** de la tabla §1.5 y reemplazar `scan`→`query`/`get_item`.
- [ ] Convertir scans-sobre-PK en `get_item` (`Campaign_Update`, `Customer_Update/Detail`).
- [ ] Pre-agregar contadores por proceso (ítem-resumen actualizado con `ADD` en ReceptionStatus)
      y rehacer Dashboard/Billing/Statistics sobre ese resumen en vez de recontar mensajes.
- [ ] Paginar todos los scans que aún queden (`LastEvaluatedKey`).
- [ ] Unificar `sendDetail` a **tabla única** con PK `processId` (eliminar tabla-por-proceso).
- [ ] Corregir el truncado de Billing (excluir clientes no computados, no mostrarlos en $0).

### Fase 3 — Hardening de auth y del pipeline
- [ ] Migrar hashing a **bcrypt/argon2id** (rehash al login).
- [ ] OTP: límite de intentos + invalidar previos + tope de expiración + consumo atómico.
- [ ] Refresh-token: revalidar `active`/`role` + vida máxima; revocación por `pwdChangedAt`.
- [ ] DLQ + `ReportBatchItemFailures` + idempotencia en todos los consumidores SQS.
- [ ] Rate limiting/backoff hacia SES y EUM; reserved/maximum concurrency en SMS/Voz.
- [ ] Contadores atómicos (consecutivos, samples, último admin, registro único por email).

### Fase 4 — Hardening fino y limpieza
- [ ] Cerrar enumeración/timing en Login/Create-otp/Change-password.
- [ ] `html.escape` en Unsubscribe; neutralizar inyección CSV en reportes.
- [ ] Validar `ACTIVATION_URL`/`OTP_EXPIRATION_MIN` en Config_Set; auditoría bloqueante.
- [ ] Normalizar email a minúsculas + validar fortaleza en Register.
- [ ] Quitar PII de logs; unificar región SES; unificar envelopes; `KeyError`→400.
- [ ] Mover `SECRET_KEY` a **AWS Secrets Manager** (pendiente ya listado en CLAUDE.md).
- [ ] **Rotar `SECRET_KEY`** si no se ha hecho (la vieja quedó en el historial git público).

### Infra transversal
- [ ] DLQ por cada cola SQS; alarmas de CloudWatch sobre errores de auditoría y throttling SES/EUM.
- [ ] Aprovisionar tablas/buckets por IaC (sacar `create_table`/`create_bucket` del request path).
- [ ] Restringir el rol IAM de cada lambda al mínimo (prefijos de tabla/bucket por tenant).

---

## 7. Cómo se hizo esta revisión
Se leyó el código de las ~60 lambdas (no se ejecutó nada ni se tocó AWS). Los hallazgos
CRÍTICOS marcados ✔ (§1.1, 1.2, 1.5, 1.7, 1.8, 1.9) se verificaron a mano sobre el archivo.
El resto proviene de lectura directa con cita `archivo:línea`; se recomienda validar en el
entorno real los puntos que dependen del despliegue (mapping template del Authorizer, esquema
real de la tabla de estados, y qué lambdas legacy siguen ruteadas).
