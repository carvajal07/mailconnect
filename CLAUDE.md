# CLAUDE.md — Contexto y estado del proyecto (handoff)

> **Propósito:** este documento le da contexto a una sesión de Claude Code sobre
> **qué se implementó recientemente y qué falta**. Complementa a `README.md`
> (que describe la arquitectura completa: lambdas, tablas, colas, S3, roles, etc.).
>
> - **`README.md`** → referencia de arquitectura y catálogo de componentes.
> - **`CLAUDE.md`** (este archivo) → estado actual, cambios recientes, contratos
>   nuevos, convenciones y plan de trabajo pendiente.
>
> Si hay conflicto de "estado" entre ambos, **manda este archivo** (el README trae
> algunas lambdas de seguridad marcadas como TODO que ya fueron implementadas).
>
> - **`PLAN_MVP.md`** (raíz) → **plan maestro de salida a producción**: definición
>   del MVP, brechas (gaps) por severidad, plan por fases con responsables, y el
>   diseño de los canales **SMS / WhatsApp / Voz**. El roadmap de §5 de este archivo
>   queda subordinado a ese plan.

_Última actualización: sesiones de trabajo sobre frontend (landing + auth) y backend de seguridad._

---

## 1. Resumen de lo trabajado en estas sesiones

Se trabajó en tres frentes: **landing page**, **conexión del frontend con la API de
seguridad** y **implementación de las lambdas de seguridad** (con pruebas).

### Frontend (`05_Frontend/Front/page`) — React 19 + Vite + TypeScript + MUI 7
- Se creó una **landing pública de marketing** (enfoque "correo masivo colombiano")
  en `src/pages/landing/LandingPage.tsx` + `landing.css`, montada en la ruta `/`.
- Todo el color/estilo de la landing se controla desde **un único bloque de tokens**
  (design tokens CSS) al inicio de `landing.css`, "scopeado" bajo `.mc-landing` para
  no afectar el resto de la app. Cambiar esos tokens re-skinea toda la landing.
- Logo embebido como SVG que se adapta a los tokens: `src/components/MailConnectLogo.tsx`.
- Se conectó la **autenticación** con la API real (antes eran `alert()` y `setTimeout`
  simulados):
  - `src/services/authService.ts` — cliente de la API + manejo de sesión (localStorage).
  - `src/config/api.ts` — base de la API (`VITE_API_BASE_URL`) y endpoints.
  - `src/components/RequireAuth.tsx` — protege `/admin` (redirige a `/login` sin sesión).
  - `LoginPage`, `RegisterPage`, `ForgotPasswordPage` y `AdminPage` conectados.
- Botón de WhatsApp funcional (`wa.me/573204586576` con mensaje pre-cargado).

### Backend (`04_Backend/lambdas`) — Python (AWS Lambda)
Se implementaron/corrigieron estas lambdas de seguridad (ver contratos en §3):
- `Api_V1_Security_Register` — **arreglado** (tenía texto pegado que lo rompía) + ahora
  envía el **correo de activación** por SES.
- `Api_V1_Security_Login` — **fix**: se inicializó `userId` (antes reventaba con
  `UnboundLocalError` en login fallido/cuenta inactiva).
- `Api_V1_Security_Change-password` — implementado (autoriza por token JWT o por OTP).
- `Api_V1_Security_Logout` — implementado (cierra sesiones en tabla `session`).
- `Api_V1_Security_Create-otp` — implementado (genera OTP, lo guarda hasheado y lo envía por SES).
- `Api_V1_Security_Validate-otp` — implementado (valida y consume el OTP).
- `Api_V1_Security_Acount-activation` — implementado (valida la clave, activa la cuenta, redirige 302).

### Pruebas (`08_Pruebas/PruebasSeguridad`)
- Suite **pytest + moto** (mock de DynamoDB y SES; no toca AWS). 25 pruebas, todas en verde.
- Cubre: registro, activación, login, OTP, cambio de contraseña (por OTP y por token),
  recuperación de contraseña (`forgot-password`), validación del `Authorizer` (JWT) y
  logout, con casos de error.
- **CI:** corren solas en cada push/PR (`.github/workflows/tests.yml`).

---

## 2. Estado real de las lambdas de seguridad

Corrige la tabla del README (que marca varias como TODO):

| Lambda | Endpoint | Estado real |
|--------|----------|-------------|
| `Register` | `POST /api/register` | ✅ Implementado + envía correo de activación |
| `Login` | `POST /api/login` | ✅ Implementado (bug de `userId` corregido) |
| `Acount-activation` | `GET /api/account-activation?qs=` o `/verify-email/{token}` | ✅ Implementado |
| `Change-password` | `POST /api/change-password` | ✅ Implementado (token o OTP) |
| `Logout` | `POST /api/logout` | ✅ Implementado |
| `Create-otp` | `POST /api/create-otp` | ✅ Implementado |
| `Validate-otp` | `POST /api/validate-otp` | ✅ Implementado |
| `Recovery-password` | `POST /api/forgot-password` | ✅ Implementado (genera y envía OTP; respuesta genérica) |
| `Verify-code` | `POST /api/verify-code` | ⚠️ **Stub** |
| `Refresh-token` | `POST /api/token/refresh` | ✅ Implementado (renueva el JWT con los mismos claims) |
| `Authorizer` / `Authorizer2` | (Lambda Authorizer) | ✅ Valida el JWT (HS256) con `SECRET_KEY`; deniega por defecto |

---

## 3. Contratos de los endpoints (para el frontend y para integrar)

**Convención de respuesta:** las lambdas de datos usan integración **no-proxy** y
devuelven un objeto con el resultado **dentro del cuerpo** (HTTP 200):

```json
{ "status": true, "statusCode": 200, "description": "...", "data": { } }
```

El frontend (`authService.ts`) lee `statusCode`/`status` del cuerpo, no del HTTP status.
`Acount-activation` es la excepción: integración **proxy** que devuelve un **302** con `Location`.

| Endpoint | Request (body) | Respuesta clave |
|----------|----------------|-----------------|
| `login` | `{ user (email), password }` | 200 `data:{token, userId, name, customer, customerId, companyTin, realSendEnabled, role}` · 404 credenciales · 423 inactiva |
| `register` | `{ name, phone, email, company, companyTin (número), password }` | 201 ok · 409 email existe · 400 datos inválidos |
| `account-activation` | query `?qs=<activationKey>` | 302 redirect (éxito/error/expirado) |
| `create-otp` | `{ user (email) o userId, expiration (min), system, ip }` | 201 `data:{otpId}` (envía el código por correo) |
| `validate-otp` | `{ otp (número), user o userId, ip }` | 200 válido (consume) · 401 inválido · 410 expirado |
| `change-password` | `{ user (email), password (nueva), otp? }` + header `Authorization: Bearer` (alternativo) | 200 ok · 401 sin auth/OTP · 400 débil · 404 no existe |
| `forgot-password` | `{ user (email), ip? }` | 200 siempre (genérico, no revela si el correo existe; envía OTP por correo) |
| `logout` | `{ user (email) }` | 200 (idempotente) |
| `Campaign/List` | `{ customerId }` | 200 `data:{campaigns[], count}` (orden desc por fecha; incluye `campaignState`) |
| `Campaign/Update` | `{ campaignId, campaignName?, channelName?, attachmentType?, dataPath?, template?, from? }` | 200 ok · 409 no-Pendiente · 403 otro cliente · 404 no existe. Solo edita campañas en estado `Pendiente`; toma el cliente del context del Authorizer |
| `Template/List` | `{ customer }` o `{ customerId }` | 200 `data:{templates:[{name, created}], count}` (SES filtrado por prefijo `{customer}_`) |
| `Email/Unsubscribe` | **GET/POST público (proxy, sin authorizer)** `?t=<token HMAC>` | 200 página HTML (confirmación / enlace inválido). El token lo firman las lambdas Send con `SECRET_KEY`; inserta en `{customer}_unsubscribe` (PK `email`) |
| `Database/Register-file` | `{ customerId, customer, fileName, s3Path, totalRecords?, channel?, columns?, ... }` | 201 `data:{databaseFileId}`. `columns` = encabezados del CSV (campos usables como `{{variables}}`) |
| `Database/List` | `{ customerId }` | 200 `data:{files[], count}` (incluye `columns`, `validEmails`, `invalidEmails`) |
| `Database/Delete` | `{ databaseFileId }` | 200 ok · 403 otro cliente · 404 no existe. Borra el registro (no el CSV en S3) |
| `Customer/List` | `{}` (**admin**) | 200 `data:{customers:[{customerId, company, companyTin, realSendEnabled}], count}` |
| `Customer/Update` | `{ customerId, realSendEnabled (bool) }` (**admin**) | 200 ok · 404 no existe · 400 datos. Togglea el bloqueo de envíos reales |
| `MessageTemplate/Create` | `{ channel:SMS\|WSP\|DOCX, name, body?/hsmName?+language?+params?/s3Path?+params? }` | 201 `data:{messageTemplateId}` · 400 datos. SMS necesita `body`, WSP `hsmName`, DOCX `s3Path` |
| `MessageTemplate/List` | `{ customerId, channel? }` | 200 `data:{templates[], count}` (desc por fecha; filtra por canal si se envía) |
| `MessageTemplate/Delete` | `{ messageTemplateId }` | 200 ok · 403 otro cliente · 404 no existe |
| `Blacklist/List` | `{ customerId }` o `{ customer }` | 200 `data:{items:[{email, rejectionType, description, date}], count}` (tabla `{customer}_blackList`) |
| `Blacklist/Add` | `{ email (correo o celular), reason? }` | 201 ok · 400 datos. Crea la tabla si no existe (PK `email`) |
| `Blacklist/Delete` | `{ email }` | 200 ok · 404 no estaba · 400 datos |
| `Pricing/List` | `{ customerId? }` (**admin**) | 200 `data:{customerId, defaults, effective, overrides, currency}` (alcance `*` global o cliente) |
| `Pricing/Update` | `{ customerId?, channel, fields }` (**admin**) | 200 ok · 400. `channel` ∈ EMAIL·SMS·WHATSAPP·VOICE·COMMON (COMMON escribe taxRate/minCampaign en los 4) |
| `Customer/Detail` | `{ customerId }` (**admin**) | 200 `data:{customer, users:[{userId,email,name,phone,role,active}], count}` · 404 |
| `User/SetRole` | `{ userId, role (admin\|client) }` (**admin**) | 200 ok · 400 · 404 · 409 (no degradar al último admin) |
| `Billing/Summary` | `{ month?, customerId? }` (**admin**) | 200 `data:{customers:[{company, totalSent, subtotal, tax, total, byChannel[]}], totals, truncated}` |
| `Admin/Dashboard` | `{ month? }` (**admin**) | 200 `data:{kpis, funnel[], byChannel[], health:[{company, sent, bounceRate, complaintRate, level}], truncated}` (panel global + reputación) |
| `Admin/Jobs` | `{ month?, state? }` (**admin**) | 200 `data:{jobs:[{campaignName, company, channelLabel, processState, campaignState, sent, registersToSend, progress, blocked{}}], counts, truncated}` (solo lectura) |
| `Config/Get` | `{}` (**admin**) | 200 `data:{settings:[{key, label, group, type, default, value, isOverridden, consumers[]}]}` |
| `Config/Set` | `{ key, value }` (**admin**) | 200 ok · 400 key/valor inválido. Crea `platformConfig` si no existe |
| `Admin/Audit` | `{ month?, action?, actor? }` (**admin**) | 200 `data:{entries:[{date, actor, action, target, detail}], count, actions[], truncated}` (bitácora, solo lectura) |

> **Flujo de recuperación:** `forgot-password` genera y envía un OTP → la pantalla de reseteo
> del front llama a `change-password` con `{ user, password, otp }`. `change-password` valida
> primero la fortaleza de la contraseña (400) **antes** de consumir el OTP, para que una clave
> débil no gaste el código.

### Variables de entorno que esperan las lambdas
- `SECRET_KEY` — firma/validación JWT (login, change-password). **La misma que ya usa login.**
- `SENDER_EMAIL` — remitente SES (register, create-otp). Default `comunicaciones@mailconnect.com.co`.
- `ACTIVATION_URL` — endpoint público de activación que va en el correo (register).
- `ACTIVATION_SUCCESS_URL` / `ACTIVATION_ERROR_URL` / `ACTIVATION_EXPIRED_URL` — redirects (account-activation).
- `OTP_EXPIRATION_MIN` — minutos de validez del OTP (create-otp, default 5).
- `UNSUBSCRIBE_URL` — URL pública de la lambda Unsubscribe (Send-EM/EAU; default
  `https://api.mailconnect.com.co/V1/Email/Unsubscribe`).
- `SECRET_KEY` **también** en `Api_V1_Email_Unsubscribe`, `Send-batch-template-EM` y `-EAU`
  (firma/validación del token de desuscripción — la misma clave del JWT).

### Desuscripción (cómo funciona)
1. El builder agrega SIEMPRE un pie con `{{unsubscribeUrl}}` al HTML generado (no removible).
2. Send-EM llena esa variable por destinatario (token HMAC `base64url({c,e}).firma`);
   Send-EAU además agrega headers `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058).
3. La lambda `Api_V1_Email_Unsubscribe` (pública) valida la firma e inserta el email en
   `{customer}_unsubscribe` (PK `email`) y muestra una página de confirmación con la marca.
4. Prepare-batch filtra contra esa tabla en el envío real (chequeo reparado: antes nunca corría).
   ⚠️ EAP aún no reemplaza la variable (pendiente, mismo patrón que EAU).

### Portal: precarga y edición (jul 2026)
- **Precarga al loguear:** `PortalDataProvider` (`context/PortalDataContext.tsx`) envuelve el
  portal y al montar carga en paralelo **campañas, bases de datos y estadísticas**; cuando el
  cliente abre cada tab la data ya está lista. `CampanasSection`, `BasesDatosSection` y
  `EstadisticasSection` consumen del contexto (`usePortalData`) con su botón de refrescar.
- **Editar campaña:** botón ✏️ en la tabla (solo si estado `Pendiente`) que abre el mismo
  diálogo precargado y llama a `Campaign/Update`.
- **Base de datos en crear/editar campaña:** el "Data Path" es un **selector** de las bases del
  cliente (del contexto), no un texto libre; al elegir una se fija su `s3Path`.
- **Delimitador del CSV:** `Prepare-batch` ahora **detecta** el delimitador (`; , tab |`) leyendo
  el encabezado, así el cliente puede subir la base con cualquiera de los 4 (antes asumía `;`).
- **Bases por canal:** la carga de base tiene un selector de **Canal** (Correo/SMS/WhatsApp/Voz).
  Define el **tipo de contacto** de la columna 2: correo (EMAIL) o celular E.164 (SMS/WhatsApp/Voz).
  `csv.ts` valida en consecuencia (`channelContactType`, `requiredColumns(contact)`,
  `analyzeCsv(text, delim, contact)`); el canal se guarda en `databaseFile.channel`.
- **Modal de progreso de subida:** la carga a S3 abre un popup con **3 checks** (crear URL
  prefirmada, cargar a S3, **registrar la base en el sistema**) y botón Aceptar. El 3er paso
  es el que hace que la base aparezca en el tab/selectores (`Database/Register-file`); si falla,
  se muestra en rojo con el detalle (antes era invisible → la base subía a S3 pero no se
  registraba y "desaparecía"). El diálogo solo se cierra si el registro quedó OK.
- **Tabla de bases (jul 2026):** se quitaron las columnas **Cliente** y **Ruta S3** (quedan en el
  detalle). Columnas: Archivo · Registros · Válidos · Inválidos · Cargada · Acciones.
- **Botón "Cargar CSV" de Campañas eliminado (jul 2026):** subía a S3 **sin registrar** la base
  (no aparecía en el tab) → confundía. El flujo único es: subir en **Bases de datos** (valida +
  registra) y elegir la base del **selector** al crear la campaña.
- **Eliminar base (jul 2026):** botón papelera en la tabla + lambda `Api_V1_Database_Delete`
  (borra el registro de `databaseFile`, no el CSV en S3; verifica el tenant).
- **Válidos/Inválidos:** en la tabla, columnas con tooltip explicando el cálculo: **válidos** =
  contacto (col 2) con formato correcto y sin duplicar; **inválidos** = contacto vacío o con
  formato inválido para el canal (correo mal escrito o celular que no es E.164). Duplicados aparte.
- **Campaña EAU/EAP — adjunto (fix 400):** el backend exige `attachment` para EAU/EAP; el form
  ahora sube el documento a S3 (documentType=document) y envía `attachment:[{path}]`. Sin adjunto
  bloquea antes de llamar. Los tipos de entrega se renombraron: `NONE`=Sin adjunto,
  `ONFILE`=Archivo adjunto en el correo, `ONLINE`=Enlace/botón de descarga; el popup trae una guía.
  **Fix backend:** `Create-campaign` guardaba el literal `"attachment_type"` en `document.attachmentType`
  (bug) → ahora guarda el valor real (afectaba el ONFILE/ONLINE del envío EAU).
- **Listado de bases (fix):** `Database/List` cae a buscar por **nombre de empresa** (`customer`)
  si el `customerId` no coincide (robustez ante desalineación del `customerId` entre registro y
  consulta, p. ej. por el mapping template del Authorizer). `Register-file` también prefiere el
  `customerId` del context del Authorizer para quedar consistente con List.

### Canal SMS (jul 2026, base)
- **Envío:** `Api_V1_Sms_Send-batch` (trigger cola `Sms_Send-batch`) manda cada SMS con
  **AWS End User Messaging** (`pinpoint-sms-voice-v2` → `SendTextMessage`) y registra el
  estado en `{customer}_sendStatus_{proceso}` (mismo patrón que email → reportes/estadísticas
  funcionan igual). Env: `SMS_ORIGINATION_IDENTITY` (obligatoria), `SMS_CONFIGURATION_SET` (opc).
- **Enrutamiento:** `Prepare-batch` enruta `channel="SMS"` a `URL_SQS_SMS` (lotes de 100) y
  agrega `smsBody` al mensaje = **campo `template` de la campaña** (para SMS, `template` guarda
  el TEXTO del mensaje, no un template de SES). Admite variables `{{columna}}` del CSV.
- **CSV en SMS:** la **columna 2** (line[1]) es el **celular E.164** (`+57…`), no el correo.
  `csv.ts` exporta `isValidPhone`. ⚠️ La validación por canal en la carga de bases queda pendiente.
- **Front:** el form de campaña (`CampanasSection`) tiene el canal **SMS** con campo de texto
  (contador de segmentos) en vez del selector de plantilla SES.
- ⚠️ `[J]`: crear la cola `Sms_Send-batch` + trigger, y configurar origen en End User Messaging.

### Canal WhatsApp (jul 2026, base)
- **Envío:** `Api_V1_Wsp_Send-batch` (trigger cola `Wsp_Send-batch`) manda cada mensaje con
  **AWS End User Messaging Social** (`socialmessaging` → `send_whatsapp_message`, WhatsApp
  Business Platform) y registra el estado en `{customer}_sendStatus_{proceso}` (mismo patrón
  que email/SMS → reportes/estadísticas funcionan igual). Env:
  `WSP_ORIGINATION_PHONE_NUMBER_ID` (obligatoria), `WSP_TEMPLATE_LANGUAGE` (default `es`),
  `WSP_META_API_VERSION` (default `v20.0`).
- **Plantilla (HSM):** WhatsApp de marketing **exige una plantilla pre-aprobada por Meta**; el
  campo `template` de la campaña guarda el **NOMBRE** de esa plantilla (no un template SES ni un
  texto libre). Los parámetros del cuerpo (`{{1}}`, `{{2}}`, …) se toman de las columnas del CSV
  desde "Nombre" en adelante (`row[2:]`): `{{1}}`=Nombre, `{{2}}`=opcional 1, …
- **Enrutamiento:** `Prepare-batch` enruta `channel="WSP"` a `URL_SQS_WSP` (lotes de 100) y
  agrega `wspTemplate` al mensaje = campo `template` de la campaña.
- **CSV en WhatsApp:** la **columna 2** (line[1]) es el **celular E.164** (`+57…`), igual que SMS.
- **Front:** el form de campaña (`CampanasSection`) tiene el canal **WSP** con un campo para el
  **nombre de la plantilla HSM** en vez del selector de plantilla SES. El estimador de costo
  mapea `WSP → WHATSAPP` (y `VOZ → VOICE`).
- ⚠️ `[J]`: crear la cola `Wsp_Send-batch` + trigger, registrar el número/WABA en End User
  Messaging Social y aprobar las plantillas HSM con Meta.

### Canal Voz (jul 2026, base)
- **Envío:** `Api_V1_Voice_Send-batch` (trigger cola `Voice_Send-batch`) hace una llamada y
  reproduce un mensaje con **texto a voz (TTS)** vía **AWS End User Messaging Voice**
  (`pinpoint-sms-voice-v2` → `send_voice_message`, voz de Amazon Polly). Registra el estado en
  `{customer}_sendStatus_{proceso}` (igual que email/SMS/WhatsApp). Env:
  `VOICE_ORIGINATION_IDENTITY` (obligatoria), `VOICE_ID` (default `LUPE`, español),
  `VOICE_CONFIGURATION_SET` (opc), `VOICE_BODY_TEXT_TYPE` (`TEXT`|`SSML`, default `TEXT`).
- **Enrutamiento:** `Prepare-batch` enruta `channel="VOZ"` a `URL_SQS_VOICE` (lotes de 50) y
  agrega `voiceMessage` = campo `template` de la campaña (para Voz, `template` guarda el TEXTO
  a leer). Admite variables `{{columna}}` del CSV. Columna 2 = celular E.164.
- **Front:** el form de campaña tiene el canal **VOZ** con un campo de texto del mensaje; el
  estimador mapea `VOZ → VOICE`.
- ⚠️ `[J]`: crear la cola `Voice_Send-batch` + trigger y habilitar el origen de voz en End User
  Messaging (número con capacidad de voz).

### Roles (admin/client) (jul 2026)
- **Modelo:** dos roles — **`admin`** (personal interno de MailConnect: gestiona clientes,
  tarifas, config global) y **`client`** (default, usuario de una empresa). Dentro de un cliente
  no hay sub-roles todavía (futuro: owner/member).
- **Backend:** campo `role` en la tabla `user` (default `client` en `Register`). `Login` lo
  embebe en el JWT y lo devuelve en `data.role`; `Authorizer`/`Authorizer2` lo reenvían en el
  context (`event.requestContext.authorizer.role`); `Refresh-token` lo preserva. Los endpoints
  **admin** (`Customer_List`, `Customer_Update`) exigen `role=admin` (403 si no).
- **Front:** la sesión guarda `role`; `isAdmin(user)` en `authService`. `RequireAuth requireAdmin`
  protege `/admin` (un `client` autenticado se redirige a `/panel`).
- **Provisión de admins:** `Register` siempre crea `client`. Un admin se crea cambiando el campo
  `role` a `admin` en la tabla `user` (consola/script). ⚠️ `[J]`: promover el/los usuarios admin.
- **Aceptación de términos:** `Register` guarda `termsAccepted` (bool) + `termsAcceptedAt` +
  `termsVersion` (evidencia Ley 1581); el front envía `acceptedTerms` desde la casilla del registro.

### Lista negra por cliente (jul 2026)
- **Gestión:** lambdas `Api_V1_Blacklist_{List,Add,Delete}` sobre la tabla `{customer}_blackList`
  (PK `email`; el "email" es el contacto: correo **o** celular E.164). Multi-tenant por el nombre
  de empresa del token. `Add` crea la tabla si no existe (mismo esquema que Prepare-batch /
  ReceptionStatus). `List` devuelve vacío si la tabla no existe (no es error).
- **Automático + manual:** la llena sola `Email_ReceptionStatus` (rebotes permanentes / quejas) y
  el cliente puede agregar/quitar desde el portal (sección **Lista negra**, `ListaNegraSection`).
- **Filtrado:** `Prepare-batch` ya excluye estos contactos en el **envío real** (`check_blacklist`).

### Estados de entrega SMS / Voz (ReceptionStatus EUM) (jul 2026)
- **Email** ya tenía `Api_V1_Email_ReceptionStatus` (eventos SES por SNS → estados 1..10).
- **SMS y Voz:** nueva `Api_V1_Messaging_ReceptionStatus` procesa los eventos de **AWS End User
  Messaging** (SMS + Voz) por SNS y **añade** una fila a `{customer}_sendStatus_{proceso}` con el
  estado (1 enviado · 2 entregado/contestado · 3 rechazado/fallido). `Statistics` agrega por
  `messageId` tomando el estado de mayor prioridad → los reportes reflejan entrega, no solo envío.
- **Metadata:** los envíos SMS/Voz ahora pasan `Context={customer, processId, uniqueId}` en
  `send_text_message`/`send_voice_message`; EUM lo incluye en el evento y ReceptionStatus lo lee
  para saber a qué cliente/proceso pertenece cada estado.
- ⚠️ **WhatsApp:** los recibos de entrega/lectura vienen de **Meta** (formato distinto, vía la
  SNS de `socialmessaging`); su ReceptionStatus queda **pendiente** (mismo patrón, otro parser).
- ⚠️ `[J]`: crear los **configuration sets** de SMS y Voz con **event destination → SNS**, y
  suscribir `Api_V1_Messaging_ReceptionStatus` a esa SNS. Env `SMS_CONFIGURATION_SET` /
  `VOICE_CONFIGURATION_SET` en los envíos para que emitan eventos.

### Límite de muestras y bloqueo de envíos por cliente (jul 2026)
- **Límite de muestras (5 por campaña):** cada operación de `Send-batch-template-samples`
  cuenta 1 en `campaign.samplesSentCount` (contador atómico); al llegar a `MAX_SAMPLE_SENDS`
  (5) Prepare-batch bloquea (429). `Create-campaign` inicializa el contador y `Campaign/List`
  lo devuelve. Front (`MuestrasSection`): chip "usados/quedan" y botón deshabilitado al límite.
- **Deshabilitar envíos reales por cliente:** campo `customer.realSendEnabled` (default `true`
  en `Register`; fail-open si falta). Prepare-batch, en el **envío real** (no muestras),
  lanza `RealSendDisabled` → 403 si está deshabilitado. `Login` devuelve `realSendEnabled` →
  sesión; el portal deshabilita "Enviar campaña real" con aviso.
- **Panel admin:** lambdas `Api_V1_Customer_List` y `Api_V1_Customer_Update` (togglea
  `realSendEnabled`) + sección `/admin` **"Envíos por cliente"** (tabla con switch por cliente).
  ⚠️ Son endpoints administrativos (afectan a todos los clientes): restringir a **rol admin**
  en el despliegue (pendiente seguridad).

### Panel administrativo ampliado: Tarifas, Ficha de cliente, Facturación (jul 2026)
Tres tabs nuevos en `/admin` (todos **admin-only**, gating por `authorizer.role`):
- **Tarifas** (`TarifasSection`): edita `pricingRate` por canal a nivel **global (`*`)** o
  **override por cliente**. Lambdas `Api_V1_Pricing_{List,Update}`. `List` devuelve `defaults`
  (embebidos), `effective` (defaults→global→cliente) y `overrides` (lo explícito del alcance,
  para el chip heredado/propio). `Update` hace upsert de campos por canal; el pseudo-canal
  **COMMON** escribe `taxRate`/`minCampaign` en los 4 canales (el estimador los lee por canal).
  Consistente con `Api_V1_Cost_Estimate` (mismos `DEFAULT_RATES`; **si cambian allá, cambian
  en Pricing_List y Billing_Summary**).
- **Clientes → Ficha** (`ClientesSection` reescrita): lista clientes reales (`Customer/List`) y
  abre una ficha (`Api_V1_Customer_Detail`) con datos + **usuarios de la empresa** (une `user`
  con `userData`), toggle de envíos reales y **promover/degradar admin** vía
  `Api_V1_User_SetRole` (bloquea degradar al **último admin**, 409). Esto **cierra el `[J]` de
  promover admins a mano** en DynamoDB.
- **Facturación** (`FacturacionSection`): `Api_V1_Billing_Summary` convierte los envíos reales
  (messageId en `{customer}_sendStatus`) en consumo por cliente y canal, aplica `pricingRate` +
  IVA + mínimo por campaña. Filtros por **mes** y **cliente**; tope de procesos con aviso de
  parcial. Aproximaciones: no suma recargo por MB de adjunto, SMS asume 1 segmento, Voz usa
  `avgMinutes`. Es un **resumen operativo, no una factura fiscal**. Export CSV en el front.

### Panel de control global + salud de envíos (jul 2026)
- **Tab "Panel de control"** (`DashboardSection`, primer tab y default de `/admin`):
  `Api_V1_Admin_Dashboard` agrega métricas **macro de todos los clientes** (no acotado por
  tenant): KPIs (clientes, campañas activas/por aprobar, envíos, tasa de entrega, clientes
  en riesgo), **embudo de entrega global** (enviados→entregados→abiertos→clics), **volumen
  por canal** y **salud de envíos por cliente**.
- **Salud / reputación:** por cada cliente con actividad calcula `bounceRate`/`complaintRate`
  y asigna nivel **ok/warning/critical** según umbrales de referencia de SES (rebote >5%/>10%,
  queja >0.1%/>0.5%). La tabla ordena **riesgo primero**. Recordatorio en la UI: la reputación
  de SES es **compartida** entre todos los clientes de la plataforma.
- Reusa la lógica de estados de `Api_V1_Reports_Statistics` (misma `STATE_PRIORITY` y conteos)
  y los componentes `StatTile`/`Funnel` de `portal/charts.tsx`. Filtro por **mes**; tope de
  procesos (`MAX_PROCESSES`) con aviso de parcial. `dashboardService.ts` en el front.

### Trabajos / colas + Configuración de plataforma (jul 2026)
- **Trabajos** (`JobsSection`, tab admin): `Api_V1_Admin_Jobs` da visibilidad **solo lectura**
  de los envíos en curso y recientes. Enriquece la tabla `process` con el estado de la campaña
  y el conteo de envíos (`sendStatus`) → **progreso** (enviados/a-enviar) y los contactos
  filtrados en la preparación (lista negra, desuscritos, inválidos). Filtros por mes/estado,
  chips de conteo por `processState`, orden reciente primero, tope con aviso. La profundidad
  real de SQS no se lee (requiere permisos SQS + URLs); el reencolado queda para otra iteración.
- **Configuración** (`ConfiguracionSection`, tab admin): tabla **`platformConfig`** (PK
  `configKey`) + lambdas `Api_V1_Config_{Get,Set}`. Centraliza ajustes globales que antes eran
  env vars sueltas. **Ajustes cableados hoy** (las lambdas los leen con fallback a su env var,
  así un cambio aplica **sin redesplegar**):
  - `SENDER_EMAIL` → `Register`, `Create-otp`, `Recovery-password` (remitente de los correos).
  - `ACTIVATION_URL` → `Register` (enlace del botón "Activar mi cuenta").
  - `OTP_EXPIRATION_MIN` → `Create-otp`, `Recovery-password` (vigencia del OTP).
  El patrón `_platform_cfg(key)` (get_item defensivo con fallback) se puede adoptar en más
  lambdas. `Config/Get` devuelve el catálogo con `value`/`isOverridden`/`consumers` para la UI.

### Auditoría de acciones admin (jul 2026)
- **Auditoría** (`AuditoriaSection`, tab admin): tabla **`adminAudit`** (PK `auditId`) + lambda
  `Api_V1_Admin_Audit` (solo lectura). Registra **quién hizo qué y cuándo** en las acciones
  administrativas sensibles. Las lambdas que mutan escriben con un helper **best-effort**
  `_audit(event, action, target, detail)` (nunca rompe la operación; el actor sale de
  `authorizer.user`/`userId`). Acciones registradas hoy:
  - `customer.realSend` → `Customer_Update` (habilitar/deshabilitar envíos).
  - `user.role` → `User_SetRole` (promover/degradar, guarda `rol_anterior → rol_nuevo`).
  - `pricing.update` → `Pricing_Update` (alcance/canal + campos tocados).
  - `config.set` → `Config_Set` (key + valor).
  Filtros por mes, acción y actor (substring); orden reciente primero; tope con aviso. El
  lector devuelve vacío si la tabla no existe (no es error).

### Plantillas multicanal: SMS / DOCX / WhatsApp (jul 2026)
- Las plantillas de **correo HTML** siguen en **SES** (`Template/Create-template`, `Template/List`).
  Los otros 3 canales usan una tabla nueva **`messageTemplate`** (PK `messageTemplateId`) y las
  lambdas `Api_V1_MessageTemplate_{Create,List,Delete}` (multi-tenant: `customerId` del context).
- **Modelo por canal** (campo `channel` = `SMS|WSP|DOCX`):
  - **SMS:** `name` + `body` (texto con `{{variables}}`).
  - **WSP:** `name` + `hsmName` (plantilla HSM de Meta) + `language` (default `es`) + `params`
    (etiquetas de `{{1}},{{2}}…`). El contenido real vive en Meta; aquí solo el mapeo.
  - **DOCX:** `name` + `s3Path` (.docx subido a S3 con `get-urlS3` documentType=document) +
    `params` (campos de combinación). La combinación real la hace el backend al enviar (EAP).
- **Gotcha `_get_payload` en Create:** el canal SMS trae un campo `body` que **colisiona** con
  la convención Lambda-proxy (`event['body']`=JSON string). El helper solo trata `event['body']`
  como proxy si **parsea a un dict**; si es texto plano (SMS), `event` ES el payload.
- **Front:** services `messageTemplatesService.ts`; secciones del portal **Plantillas SMS**,
  **Plantillas WhatsApp** (componente genérico `MessageTemplatesSection`) y **Plantillas DOCX**
  (`DocxTemplatesSection`, sube el .docx y registra la metadata) — reemplazan el placeholder PDF.
  Al crear campaña SMS/WSP hay un selector "Usar plantilla guardada" que prellena el campo.

### Variables de plantilla desde la base (jul 2026)
- Al subir una base, `Database/Register-file` guarda ahora **`columns`** (los encabezados del
  CSV; el front los toma de `analyzeCsv().headers`). `Database/List` los devuelve.
- Componente reusable **`DatabaseFieldPicker`** (autónomo, carga las bases con `databaseService`
  → funciona en portal y `/admin`): elige **1 base** y muestra sus campos como chips. `onInsert(f)`
  recibe el **nombre** del campo (sin llaves) y cada consumidor decide el formato; sin `onInsert`
  copia `{{campo}}` al portapapeles. `onFieldsChange(fields)` expone los campos a menús externos.
- Integrado en la creación de plantillas: **HTML builder** (alimenta el menú "Insertar variable"
  y permite insertar en el bloque seleccionado; si no hay base elegida usa las variables por
  defecto de `htmlBuilder.ts`), **SMS** (inserta `{{campo}}` en el texto), **WhatsApp** y **DOCX**
  (agregan el campo a la lista de parámetros/campos de combinación).
- Bases cargadas **antes** de esta función no tienen `columns` → el picker avisa "vuelve a subirla".

### Multi-tenant y refresh (jul 2026)
- **Claims en el JWT:** `Login` embebe `customerId`, `customer` y `userId` en el token.
  El `Authorizer`/`Authorizer2` los reenvían en el **context** de la policy.
- **Enforcement:** las read-lambdas (`Campaign_List`, `Template_List`, `Database_List`,
  `Reports_Statistics`) **prefieren el `customerId`/`customer` del context del Authorizer**
  (`event.requestContext.authorizer.*`) sobre el body → un cliente no puede consultar datos
  de otro. ⚠️ Para que el context llegue en integración **no-proxy**, el mapping template de
  esas rutas debe inyectar `$context.authorizer.customerId` (y `customer`) al body, o pasarlas
  a **proxy**. En proxy ya funciona directo. Sin eso, cae al body (comportamiento legacy).
- **Refresh token:** `Api_V1_Security_Refresh-token` valida el token vigente y reemite uno con
  los mismos claims y `exp` fresco (sesión deslizante). El front lo renueva en segundo plano
  (`RequireAuth`) cuando el usuario está activo y al token le queda < 1 h.

### Sesión del front
- El JWT se decodifica en el cliente para conocer `exp`: si venció, `apiClient` corta antes de
  llamar a la API y cualquier 401/403 del Authorizer limpia la sesión y redirige a `/login`
  con aviso ("Tu sesión expiró").
- **Inactividad:** `RequireAuth` marca actividad (mouse/teclado/scroll/touch, compartida entre
  pestañas vía `localStorage.mc_last_activity`) y cada 30 s verifica: si pasan más de
  `VITE_IDLE_MINUTES` (default 15) sin actividad → cierre automático con aviso
  ("Cerramos tu sesión por inactividad").

---

## 4. Convenciones y "gotchas" (léelo antes de tocar código)

- **Frontend – marca:** para cambiar la paleta de la landing se edita **solo** el bloque
  de tokens al inicio de `src/pages/landing/landing.css` (variables `--brand`, `--ink`, etc.).
- **Frontend – API base:** `VITE_API_BASE_URL` (ver `.env.example`). Default = stage `Test`.
- **Frontend – sesión:** el token y el usuario se guardan en `localStorage`
  (`mc_token`, `mc_user`) desde `authService.ts`. `login` devuelve y la sesión
  almacena **`customer`** (nombre de empresa), **`customerId`** (uuid) y **`nit`**
  (companyTin). **Convención:** el cliente/empresa **NO se captura en formularios**;
  se toma de la sesión. Muestras, Reportes y Bases de datos muestran la empresa como
  chip de solo lectura; el builder HTML usa `customerId` de la sesión para
  `create-template` (ya no pide "Customer ID"). El bucket de una base es
  `{customer}.database` (derivado del `customer` de la sesión).
- **Frontend – login DEMO (sin backend):** con `VITE_AUTH_MOCK=true` (en `.env`, ver
  `.env.example`), `authService.login`/`register` se resuelven en el cliente sin pegar a
  la API: cualquier credencial entra a `/panel` (sugerida `demo@mailconnect.com.co` /
  `Demo1234`). Útil mientras la API real no está lista. Solo login/registro se simulan;
  las llamadas del panel siguen siendo reales. **No activar en producción.** Lógica en
  `src/services/mockAuth.ts`. Los `.env`/`.env.*` están en `.gitignore` (se versiona
  solo `.env.example`).
- **Backend – lectura del evento:** las lambdas nuevas soportan tanto integración directa
  (el `event` **es** el body) como proxy (`event['body']` string) vía un helper `_get_payload`.
- **Backend – OTP:** el código se guarda **hasheado** (sha256); `create-otp` lo envía por
  correo, `validate-otp` lo consume. `change-password` acepta OTP (recuperación) **o** token (logueado).
  ⚠️ La tabla real en AWS se llama **`oneTimePassword`** (PK `oneTimePasswordId`), NO `otp`;
  las 4 lambdas ya apuntan al nombre correcto (también existe `oneTimePasswordAudit`, sin uso).
- **Seguridad JWT:** el `Authorizer` ahora **valida** el JWT (HS256) con `SECRET_KEY`
  y deniega por defecto (fail-closed). `Login` y las lambdas nuevas leen `SECRET_KEY`
  desde variable de entorno. Pendiente: mover `SECRET_KEY` a AWS Secrets Manager.
  Requisito de despliegue: los Authorizers necesitan el layer de PyJWT y la env `SECRET_KEY`.
- **Pruebas:** independientes (cada test crea su propio usuario con email único). Rutas a
  las lambdas calculadas desde la raíz del repo (`Path(__file__).parents[2]`).

---

## 5. Plan de trabajo (roadmap / lista de tareas)

> **⭐ El plan vigente para salir a producción es `PLAN_MVP.md`** (fases 0–3,
> responsables `[C]`/`[J]`, canales SMS/WhatsApp/Voz). Lo de abajo es el detalle
> histórico por área; ante conflicto manda `PLAN_MVP.md`.

Marcado `[x]` = hecho, `[ ]` = pendiente.

### Frontend
- [x] Landing pública (Opción B) en React, ruta `/`, tokens de marca configurables.
- [x] CTAs conectados a `/login` y `/register`; botón de WhatsApp real.
- [x] `authService` + `RequireAuth`; login/registro/recuperación conectados; `/admin` protegido.
- [x] **Fase 1 – Tema unificado:** `theme-light.config.js` ahora deriva de la marca
      (cyan `#00c3ff`, azul `#0075be`, navy `#16233f`, verde `#1fbf87`, ámbar `#ff9d2e`)
      en vez de los colores Flat-UI genéricos. El tema oscuro ya usaba la marca.
- [x] **Fase 3 – Deuda técnica:** limpiado el boilerplate de Vite en `src/index.css`
      (sin `#242424` ni `#646cff`; solo resets neutros, MUI controla el color). Los colores
      "dark-only" hardcodeados de las páginas de auth se movieron a un helper theme-aware
      (`src/theme/authStyles.ts`): glow cyan en oscuro, sombras suaves en claro.
- [x] **Pantalla de reseteo con OTP** (`/reset-password`: código + nueva contraseña) que
      cierra la recuperación end-to-end (llama a `change-password` con OTP).
- [~] **Portal del cliente** (`/panel`, destino del login; `/admin` sigue intacto con sus 3
      secciones para uso interno). Sidebar **colapsable** (riel de solo iconos con tooltips,
      toggle en el AppBar) con tabs: Plantillas HTML, Plantillas PDF, Campañas, Bases de datos,
      Reportes, Estadísticas, Mi cuenta.
      - [x] **Plantillas HTML** → constructor drag-and-drop "pro" (tipo Topol): 10 bloques
            (encabezado, texto, imagen, botón, logo, 2 columnas, redes sociales, HTML crudo,
            divisor, espaciador) en paleta agrupada (Contenido/Estructura), reorden por
            arrastre + flechas, duplicar/eliminar, panel de propiedades, variables `{{nombre}}`.
            **Ajustes globales** (ancho de contenido, fondos, color de texto/enlaces, fuente,
            esquinas, preheader), **vista previa** escritorio/móvil (iframe), "Ver HTML",
            **borradores** en localStorage (bloques + ajustes), **cargar de SES**
            (get-template → bloque HTML editable) y **publicar** vía `create-template`.
            El HTML generado es **responsive y cross-client**: XHTML doctype, media queries
            (columnas que apilan en móvil), ghost tables + condicionales MSO para Outlook,
            fix de Apple Mail, imágenes fluidas y botones bulletproof. Modelo y generación en
            `components/portal/htmlBuilder.ts`; UI en `HtmlBuilderSection.tsx`.
            **Diseño:** paleta con icono por bloque (Contenido/Estructura) y lienzo tipo "hoja
            de correo" centrada con sombra; los bloques se renderizan sobre la hoja blanca
            (colores fijos), de modo que el **modo oscuro** se ve correcto (WYSIWYG legible).
            **Imágenes:** los bloques imagen/logo tienen "Subir imagen a S3" (get-urlS3 con
            `documentType=document`), que fija el `src` a la URL pública del objeto.
            **Plantillas prediseñadas** (`templatePresets.ts`): 5 integradas (Boletín, Promoción,
            Bienvenida, Anuncio, Evento) con miniatura en vivo; el admin puede crear más con
            "Guardar plantilla" (se guardan en localStorage). El builder se reusa en `/admin`
            (sección "Plantillas prediseñadas", `HtmlBuilderSection allowSavePreset`).
      - [x] **Campañas** reutiliza `CampanasSection`. **Mi cuenta** muestra la sesión y permite
            cambiar la contraseña (change-password con token).
      - [x] **Muestras** (`MuestrasSection`): flujo de prueba/aprobación **conectado end-to-end**
            a la Lambda `Prepare-batch-template` (es la misma para muestras y envío real; distingue
            por `event["resource"]`). Configuración de la campaña, **slider 1–5** que habilita
            dinámicamente los campos de correo, selector **Aleatorias/Selectivas** (en selectivas,
            campo de **identificación** por muestra). **Enviar muestras** → `POST
            /Email/Send-batch-template-samples` (la Lambda reemplaza el correo real por el de prueba
            y deja la campaña en estado `Muestras`); solo si responde OK se registra el lote para
            aprobación. **Aprobar** habilita **Enviar campaña real** → `POST
            /Email/Send-batch-template` (misma Lambda, sin "samples" → envío a toda la base, estado
            `Enviando`). Servicios `campaignsService.sendSamples` / `sendReal`. Requiere que la
            campaña esté en estado `Pendiente` o `Muestras`. **Fix backend:** en muestras selectivas
            la comparación de identificación era `int(line[0]) == identificación(str)` y nunca hacía
            match; ahora compara como texto normalizado. **Fix front:** `apiClient` normaliza también
            el envelope con `status_code` (snake_case) que devuelve esta Lambda (proxy).
      - [x] **Bases de datos** (`BasesDatosSection` + `csv.ts`): carga de CSV con
            **validación/preview local** (parser propio: detecta delimitador, columnas, total
            de registros, columna de email, y cuenta válidos/inválidos/duplicados) y subida real
            a S3 vía `get-urlS3` (`documentType=database`), devolviendo la ruta para usarla como
            Data Path. **Valida la estructura obligatoria por posición** (el backend Prepare-batch
            lee `line[0]`=Identificación numérica, `line[1]`=Correo, `line[2]`=Nombre): el diálogo
            muestra las 3 columnas requeridas **en orden** con estado ✓/✗ y avisa si no cumplen.
            **Historial persistente:** tras subir a S3 se registra la metadata (nombre, ruta,
            registros, válidos/inválidos, fecha) vía `POST /Database/Register-file`, y la tabla se
            carga con `POST /Database/List` (por `customerId`). La vista previa del contenido solo
            está para las bases cargadas en la sesión. Servicio `databaseService.ts`; tabla
            DynamoDB `databaseFile`. (Lista negra por cliente sigue pendiente.)
      - [x] **Estadísticas** (`EstadisticasSection` + `charts.tsx`): tablero con KPIs
            (pendientes/creadas/enviadas, total envíos, apertura promedio), **dona** de
            campañas por estado, **embudo** de envío (enviados→entregados→abiertos→clics) y
            tabla con detalle por campaña (muestra el estado real). Gráficos en SVG propio
            (sin dependencias), theme-aware y con paleta validada (dataviz). **Conectado a
            datos reales** vía `statsService` → `POST /Report/Statistics` (lambda
            `Api_V1_Reports_Statistics`, **sin Bedrock**: lee `campaign` + `process` +
            `{customer}_sendStatus_{proceso}` y agrega por estado de mayor prioridad por
            messageId). Con refrescar/loading/error/vacío.
      - [x] **Reportes** (`ReportesSection` + `reportsService`): (a) **exportar resumen** de
            campañas a CSV al instante (local, sin backend) y (b) **reporte de estado por
            campaña** vía el endpoint real `state-report` (`{cliente, idProceso}` → `{count,
            csv_preview, csv_base64|s3_key}`), con vista previa y descarga del CSV desde base64.
            Datos de campañas compartidos en `campaignData.ts` (los usa Estadísticas también).
      - [x] **Plantillas multicanal** (SMS / WhatsApp / DOCX): tabla `messageTemplate` +
            lambdas Create/List/Delete + secciones del portal. El placeholder "Plantillas PDF"
            se reemplazó por **Plantillas DOCX** (combinación de correspondencia: sube el .docx
            + metadata). El constructor HTML se irá ampliando (más bloques/estilos).
- [~] Conectar las secciones del panel a la API real (capa de servicios nueva):
      - [x] **Plantillas** → `create-template`, `get-template`, `delete-template` (reales).
      - [x] **Campañas** → `create-campaign` y `get-urlS3` (URL prefirmada + PUT a S3).
      - [x] **Muestras/Envío real** → `Send-batch-template-samples` (muestras) y
            `Send-batch-template` (envío real tras aprobación), ambos a `Prepare-batch-template`.
      - [ ] **Clientes** → solo existe `register`; falta backend de listar/editar/eliminar.
      - Nota: el backend aún no expone listar/buscar campañas, así que las
        tablas muestran lo creado/consultado en la sesión y esas acciones están deshabilitadas.
        Los servicios viven en `src/services/{apiClient,templatesService,campaignsService}.ts`.

### Backend
- [x] `register` arreglado (+ correo de activación); `login` corregido (`userId`).
- [x] `change-password`, `logout`, `create-otp`, `validate-otp`, `account-activation`.
- [x] Implementar `/forgot-password` como wrapper que crea y envía el OTP (con respuesta
      genérica anti-enumeración). `change-password` ahora valida la clave antes de consumir el OTP.
- [ ] Implementar `verify-code` y `token/refresh` (hoy stubs).
- [x] Endurecer el `Authorizer` (y `Authorizer2`) para que **valide el JWT** (HS256) con
      `SECRET_KEY`, soportando autorizadores TOKEN y REQUEST, y denegando por defecto.
- [x] `SECRET_KEY` se lee desde variable de entorno (`Login` + lambdas nuevas + Authorizers).
- [ ] Mover `SECRET_KEY` a **AWS Secrets Manager** (hoy es variable de entorno).
- [ ] Lista negra por cliente; manejo de CSV grandes por partes; segmentar IPs SES por cliente.

### Producto – Estimador de costo de envío (✅ implementado, jul 2026)
> **Objetivo:** antes de confirmar un envío, mostrarle al cliente un **estimado del valor**
> de la campaña (los **4 canales**), con desglose, para que decida con el costo a la vista.

**Endpoint:** `POST /Cost/Estimate` (lambda `Api_V1_Cost_Estimate`, no-proxy, envelope).
- Request: `{ customerId, channel, recipients, emailMode?, attachmentSizeMB?, attachmentType?,
  smsSegments?, voiceMinutes? }`.
- Response `data`: `{ currency:'COP', channel, recipients, unitCost, subtotal, taxRate, tax,
  estimatedCost, appliedMinimum, breakdown:[{concept,detail,amount}], isEstimate, note }`.

**Tabla de tarifas `pricingRate`** (DynamoDB — **PK `customerId` (String) + SK `channel`
(String)**; `customerId='*'` = tarifa **global** por defecto). La lambda trae DEFAULT_RATES
embebidas, así funciona aunque la tabla no exista; si existe, el ítem `('*',canal)` y luego
`(cliente,canal)` **sobreescriben** los defaults (tarifa por cliente). Valores en **COP**.

Campos por canal (todos configurables en `pricingRate`):
- **EMAIL:** `baseEM`, `baseEAU`, `baseEAP`, `attachmentPerMB`, `personalizedPdf`, `personalizedDocx`.
- **SMS:** `baseSms` (por SMS y por segmento de 160 GSM-7 / 70 unicode).
- **WHATSAPP:** `baseMarketing` (por mensaje de plantilla de marketing).
- **VOICE:** `basePerMinute`, `avgMinutes`.
- **Comunes:** `taxRate` (IVA, default 0.19), `minCampaign` (mínimo por campaña, default $5000).

**Criterios de cálculo** (unit = costo por destinatario; subtotal = unit × destinatarios):
- EMAIL·EM → `baseEM`. EMAIL·EAU → `baseEAU + MB×attachmentPerMB`.
  EMAIL·EAP → `baseEAP + MB×attachmentPerMB + (pdf? personalizedPdf : personalizedDocx)`.
- SMS → `baseSms × segmentos`. WHATSAPP → `baseMarketing`. VOICE → `basePerMinute × minutos`.
- Se aplica `max(subtotal, minCampaign)`, luego IVA. `breakdown` explica cada componente.

**Frontend:** `costService.ts` + componente **`CostEstimate`** (interactivo, los 4 canales),
integrado en **Muestras** (antes de aprobar/enviar), con el canal preseleccionado según la
campaña. Muestra total, costo unitario, desglose e IVA, y la aclaración de "estimado".

**Tarifas por defecto (COP, INDICATIVAS — calibrar `[J]`):** EM 8 · EAU 15 · EAP 40 ·
adjunto 5/MB · pers. PDF 25 / DOCX 35 · SMS 60 · WhatsApp 90 · Voz 120/min · mín. $5000 · IVA 19%.

**Pendiente `[J]`:** crear la tabla `pricingRate` + ruta `/Cost/Estimate` (authorizer+CORS) +
permiso `dynamodb:GetItem`; calibrar tarifas con costos reales (SES/SNS/Meta/AWS EUM) y cargar
overrides por cliente. (El peso del adjunto hoy lo declara el usuario en el estimador; a futuro
se puede leer del objeto ya subido a S3.)

### Infraestructura / despliegue
- [ ] Desplegar las lambdas nuevas y **crear sus rutas** en API Gateway
      (`/change-password`, `/logout`, `/create-otp`, `/validate-otp`, `/account-activation`).
- [ ] **Habilitar CORS** en API Gateway para los endpoints que llama el navegador.
- [ ] **Nuevas de esta sesión** `[J]`:
      - Tabla DynamoDB **`messageTemplate`** (PK `messageTemplateId`) + permisos
        `PutItem/Scan/GetItem/DeleteItem`.
      - Campo **`realSendEnabled`** en la tabla `customer` (lo escriben Register/Customer_Update;
        Login/Prepare-batch lo leen). Para clientes existentes se asume `true` (fail-open).
      - Campo **`samplesSentCount`** en la tabla `campaign` (lo maneja Prepare-batch; default 0).
      - Rutas API Gateway (authorizer + CORS): `/Customer/List`, `/Customer/Update`,
        `/MessageTemplate/Create`, `/MessageTemplate/List`, `/MessageTemplate/Delete`.
        ⚠️ `/Customer/*` son **admin** (afectan a todos los clientes): restringir a rol admin.
      - Desplegar las lambdas nuevas: `Api_V1_Customer_List`, `Api_V1_Customer_Update`,
        `Api_V1_MessageTemplate_{Create,List,Delete}` (crear la función vacía antes del CD).
      - **`Api_V1_Database_Delete`** + ruta `/Database/Delete` (authorizer + CORS) + permiso
        `dynamodb:DeleteItem`/`GetItem` sobre `databaseFile`. Campo **`columns`** en `databaseFile`
        (lo escribe Register-file; List lo devuelve).
      - **Canal Voz:** cola `Voice_Send-batch` + trigger a `Api_V1_Voice_Send-batch` (crear la
        función vacía antes del CD) + origen de voz en End User Messaging + permiso
        `sms-voice:SendVoiceMessage`. Env `VOICE_ORIGINATION_IDENTITY`.
      - **Lista negra:** rutas `/Blacklist/List`, `/Blacklist/Add`, `/Blacklist/Delete`
        (authorizer + CORS) + lambdas `Api_V1_Blacklist_{List,Add,Delete}` (crear vacías) con
        permisos `Scan/PutItem/GetItem/DeleteItem/CreateTable/DescribeTable` sobre `*_blackList`.
      - **Estados SMS/Voz:** lambda `Api_V1_Messaging_ReceptionStatus` (crear vacía) suscrita a la
        SNS de los **configuration sets** de SMS y Voz (event destinations). Permiso
        `PutItem` sobre `*_sendStatus_*`.
      - **Roles:** campo `role` en la tabla `user` (default `client`; Register lo escribe). Los
        Authorizers deben reenviar `role` en el context (proxy directo; en no-proxy, el mapping
        template debe inyectar `$context.authorizer.role`). **Promover manualmente** al menos un
        usuario a `role='admin'`. Campos `termsAccepted`/`termsAcceptedAt`/`termsVersion` en `user`.
      - **⚠️ Mapping template del rol en rutas admin (bug de "Acceso restringido"):** las rutas
        admin **no-proxy** (`/Customer/*`, `/User/SetRole`, `/Pricing/*`, `/Billing/Summary`) NO
        reciben el `role` a menos que el body mapping template inyecte
        `$context.authorizer.role` (y `customerId`/`customer`). Sin eso la lambda ve el context
        vacío → 403 aunque el usuario SÍ sea admin. Alternativa: pasar esas rutas a **proxy**.
      - **Panel admin ampliado (jul 2026):** desplegar `Api_V1_Pricing_List`,
        `Api_V1_Pricing_Update`, `Api_V1_Customer_Detail`, `Api_V1_User_SetRole`,
        `Api_V1_Billing_Summary` (crear la función vacía antes del CD) + sus rutas
        `/Pricing/List`, `/Pricing/Update`, `/Customer/Detail`, `/User/SetRole`,
        `/Billing/Summary` (authorizer + CORS, **admin-only**). Permisos:
        `dynamodb:GetItem/UpdateItem` sobre **`pricingRate`**; `Scan` sobre `user`/`userData`/
        `customer`/`campaign`/`process` y `UpdateItem` sobre `user` (SetRole); `Query` sobre
        `*_sendStatus` (Billing). La tabla **`pricingRate`** (PK `customerId` + SK `channel`)
        ya era requisito del estimador — ahora también la escribe Pricing_Update.
      - **Panel de control global (jul 2026):** desplegar `Api_V1_Admin_Dashboard` (crear la
        función vacía antes del CD) + ruta `/Admin/Dashboard` (authorizer + CORS, **admin-only**,
        mismo mapping template de `role`). Permisos: `Scan` sobre `customer`/`campaign`/`process`
        y `Query` sobre `*_sendStatus`. Mismo patrón de agregación que `Reports_Statistics`.
      - **Trabajos / colas (jul 2026):** desplegar `Api_V1_Admin_Jobs` (crear vacía) + ruta
        `/Admin/Jobs` (authorizer + CORS, **admin-only**, mapping de `role`). Permisos: `Scan`
        sobre `process`/`campaign` y `Query` sobre `*_sendStatus`.
      - **Configuración de plataforma (jul 2026):** tabla **`platformConfig`** (PK `configKey`)
        + lambdas `Api_V1_Config_{Get,Set}` (crear vacías) + rutas `/Config/Get`, `/Config/Set`
        (authorizer + CORS, **admin-only**). Permisos: `Scan/GetItem/PutItem` + `CreateTable/
        DescribeTable` sobre `platformConfig`. Las lambdas **consumidoras** (`Register`,
        `Create-otp`, `Recovery-password`) necesitan `dynamodb:GetItem` sobre `platformConfig`
        (leen con fallback a env, así que sin permiso/tabla siguen funcionando con la env var).
      - **Auditoría (jul 2026):** tabla **`adminAudit`** (PK `auditId`) + lambda
        `Api_V1_Admin_Audit` (crear vacía) + ruta `/Admin/Audit` (authorizer + CORS, **admin-only**).
        Permisos: `Scan` sobre `adminAudit` (lectura) y `PutItem` sobre `adminAudit` para las
        lambdas que mutan (`Customer_Update`, `User_SetRole`, `Pricing_Update`, `Config_Set`;
        escriben best-effort, así que sin permiso/tabla la operación sigue pero no se audita).
        Para que el actor quede identificado, el Authorizer ya reenvía `user`/`userId` en el
        context (en no-proxy, inyectarlos en el mapping template junto con `role`).
- [ ] Sacar **SES del sandbox** y verificar remitente/dominio.
- [ ] Configurar las **variables de entorno** de §3 en cada lambda.
- [ ] Definir `VITE_API_BASE_URL` de producción en el front.

### Calidad / CI-CD
- [x] **CI con GitHub Actions:** `pytest` de `08_Pruebas/PruebasSeguridad` corre
      automáticamente en cada `push` y `pull_request` (Python 3.11) vía
      `.github/workflows/tests.yml`, para evitar regresiones.
- [ ] (Opcional) Añadir al CI el build del frontend (`npm ci && npm run build`).
- [x] **CD de lambdas:** `.github/workflows/deploy-lambdas.yml` despliega a AWS solo las
      lambdas cambiadas en cada push a `main` (o manual). Requiere los secrets
      `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (+ `AWS_REGION`) y opcional
      `04_Backend/lambdas/deploy-map.json` si el nombre AWS difiere del de la carpeta.

### Seguridad (URGENTE)
- [x] Scripts `prueba genera JWT.py` / `prueba jwt.py` limpios: leen `SECRET_KEY` de env (jul 2026).
- [ ] **Confirmar que la `SECRET_KEY` en uso sea NUEVA** (32+ bytes): la clave vieja quedó en el
      **historial git** del repo público; si no se rotó el valor, sigue comprometida.
- [ ] Hacer el repo **privado** (o limpiar el historial con BFG/filter-repo).
- [x] AWS access keys y `DatosTrabajo.txt` gestionados por Jhon (jul 2026).

---

## 6. Mapa de archivos nuevos/modificados en estas sesiones

**Frontend** (`05_Frontend/Front/page/`)
```
src/pages/landing/LandingPage.tsx      (nuevo)  landing pública
src/pages/landing/landing.css          (nuevo)  tokens de marca + estilos
src/components/MailConnectLogo.tsx      (nuevo)  logo SVG
src/services/authService.ts             (nuevo)  cliente API + sesión
src/components/RequireAuth.tsx          (nuevo)  guard de rutas privadas
src/config/api.ts                       (mod)    base + endpoints de auth
src/App.tsx                             (mod)    ruta / (landing) + /admin protegido
src/pages/auth/LoginPage.tsx            (mod)    conectado a /login
src/pages/auth/RegisterPage.tsx         (mod)    +campos phone/company/NIT, /register
src/pages/auth/ForgotPasswordPage.tsx   (mod)    envía OTP y navega a /reset-password
src/pages/auth/ResetPasswordPage.tsx    (nuevo)  reseteo con OTP (código + nueva clave)
src/pages/auth/LoginPage.tsx            (mod)    estilos theme-aware (sin hardcodes)
src/pages/auth/RegisterPage.tsx         (mod)    estilos theme-aware (sin hardcodes)
src/theme/authStyles.ts                 (nuevo)  estilos de auth theme-aware (claro/oscuro)
src/services/apiClient.ts               (nuevo)  cliente HTTP autenticado + envelope
src/services/templatesService.ts        (nuevo)  create/get/delete-template (reales)
src/services/campaignsService.ts        (nuevo)  create-campaign + get-urlS3 (S3 PUT)
src/hooks/useFeedback.tsx               (nuevo)  Snackbar de feedback reutilizable
src/pages/portal/PortalPage.tsx         (nuevo)  portal del cliente (/panel) + tabs
src/components/portal/PortalSidebar.tsx (nuevo)  sidebar de tabs del portal
src/components/portal/HtmlBuilderSection.tsx (nuevo) constructor HTML drag-and-drop
src/components/portal/htmlBuilder.ts    (nuevo)  modelo de bloques + generación de HTML
src/components/portal/MiCuentaSection.tsx (nuevo) perfil + cambio de contraseña
src/components/portal/PlaceholderSection.tsx (nuevo) secciones "próximamente"
src/components/admin/PlantillasSection.tsx (mod) conectada a templatesService
src/components/admin/CampanasSection.tsx   (mod) conectada a campaignsService
src/config/api.ts                       (mod)    endpoints reales + placeholders marcados
theme-light.config.js                   (mod)    tema claro derivado de la marca
src/index.css                           (mod)    limpio boilerplate de Vite (resets neutros)
src/pages/admin/AdminPage.tsx           (mod)    logout real + saludo
.env.example                            (nuevo)  VITE_API_BASE_URL
```

**Backend** (`04_Backend/lambdas/`)
```
Api_V1_Security_Register/lambda_function.py          (arreglado + SES)
Api_V1_Security_Login/lambda_function.py             (fix userId)
Api_V1_Security_Change-password/lambda_function.py   (implementado)
Api_V1_Security_Logout/lambda_function.py            (implementado)
Api_V1_Security_Create-otp/lambda_function.py        (implementado)
Api_V1_Security_Validate-otp/lambda_function.py      (implementado)
Api_V1_Security_Acount-activation/lambda_function.py (implementado)
Api_V1_Security_Recovery-password/lambda_function.py (implementado: forgot-password)
Authorizer/lambda_function.py                        (valida JWT; antes allow-all)
Authorizer2/lambda_function.py                       (valida JWT; antes allow-all)
```

**CI** (`.github/workflows/`)
```
tests.yml             (nuevo)  corre pytest en cada push/PR (Python 3.11)
```

**Pruebas** (`08_Pruebas/PruebasSeguridad/`)
```
test_seguridad.py     (25 pruebas pytest + moto)
requirements.txt
README.md
```

---

## 7. Referencias rápidas
- **Checklist de despliegue consolidado (panel admin + pendientes): `DESPLIEGUE.md`** (raíz).
  Todo lo `[J]` (tablas, lambdas, rutas, IAM, mapping template de rol) y lo `[C]` (código pendiente).
- **Plan de salida a producción (MVP) y canales SMS/WhatsApp/Voz: `PLAN_MVP.md`** (raíz).
- Arquitectura completa y catálogo: **`README.md`** (raíz).
- Contrato de la API: **`09_Herramientas/01-MailConnect.postman_collection.json`**.
- Base de la API (Test): `https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api`
- Marca: fuente **Nunito**; colores del logo cyan `#00c3ff` / azul `#0075be` / navy `#16233f`.
- Para correr las pruebas: `cd 08_Pruebas/PruebasSeguridad && pip install -r requirements.txt && pytest -v`
