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
| `login` | `{ user (email), password }` | 200 `data:{token, userId, name, customer, customerId, companyTin}` · 404 credenciales · 423 inactiva |
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
| `Database/Register-file` | `{ customerId, customer, fileName, s3Path, totalRecords?, ... }` | 201 `data:{databaseFileId}` |
| `Database/List` | `{ customerId }` | 200 `data:{files[], count}` |

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
      - [ ] Plantillas PDF queda como placeholder (espera backend). El constructor HTML se
            irá ampliando (más bloques/estilos).
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
- **Plan de salida a producción (MVP) y canales SMS/WhatsApp/Voz: `PLAN_MVP.md`** (raíz).
- Arquitectura completa y catálogo: **`README.md`** (raíz).
- Contrato de la API: **`09_Herramientas/01-MailConnect.postman_collection.json`**.
- Base de la API (Test): `https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api`
- Marca: fuente **Nunito**; colores del logo cyan `#00c3ff` / azul `#0075be` / navy `#16233f`.
- Para correr las pruebas: `cd 08_Pruebas/PruebasSeguridad && pip install -r requirements.txt && pytest -v`
