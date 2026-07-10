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
| `Refresh-token` | `POST /api/token/refresh` | ⚠️ **Stub** |
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
| `login` | `{ user (email), password }` | 200 `data:{token, userId, name, customer}` · 404 credenciales · 423 inactiva |
| `register` | `{ name, phone, email, company, companyTin (número), password }` | 201 ok · 409 email existe · 400 datos inválidos |
| `account-activation` | query `?qs=<activationKey>` | 302 redirect (éxito/error/expirado) |
| `create-otp` | `{ user (email) o userId, expiration (min), system, ip }` | 201 `data:{otpId}` (envía el código por correo) |
| `validate-otp` | `{ otp (número), user o userId, ip }` | 200 válido (consume) · 401 inválido · 410 expirado |
| `change-password` | `{ user (email), password (nueva), otp? }` + header `Authorization: Bearer` (alternativo) | 200 ok · 401 sin auth/OTP · 400 débil · 404 no existe |
| `forgot-password` | `{ user (email), ip? }` | 200 siempre (genérico, no revela si el correo existe; envía OTP por correo) |
| `logout` | `{ user (email) }` | 200 (idempotente) |

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

---

## 4. Convenciones y "gotchas" (léelo antes de tocar código)

- **Frontend – marca:** para cambiar la paleta de la landing se edita **solo** el bloque
  de tokens al inicio de `src/pages/landing/landing.css` (variables `--brand`, `--ink`, etc.).
- **Frontend – API base:** `VITE_API_BASE_URL` (ver `.env.example`). Default = stage `Test`.
- **Frontend – sesión:** el token y el usuario se guardan en `localStorage`
  (`mc_token`, `mc_user`) desde `authService.ts`.
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
- **Seguridad JWT:** el `Authorizer` ahora **valida** el JWT (HS256) con `SECRET_KEY`
  y deniega por defecto (fail-closed). `Login` y las lambdas nuevas leen `SECRET_KEY`
  desde variable de entorno. Pendiente: mover `SECRET_KEY` a AWS Secrets Manager.
  Requisito de despliegue: los Authorizers necesitan el layer de PyJWT y la env `SECRET_KEY`.
- **Pruebas:** independientes (cada test crea su propio usuario con email único). Rutas a
  las lambdas calculadas desde la raíz del repo (`Path(__file__).parents[2]`).

---

## 5. Plan de trabajo (roadmap / lista de tareas)

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
            Lista de bases de la sesión (backend aún no expone listado/edición/lista negra).
      - [x] **Estadísticas** (`EstadisticasSection` + `charts.tsx`): tablero con KPIs
            (pendientes/creadas/enviadas, total envíos, apertura promedio), **dona** de
            campañas por estado, **embudo** de envío (enviados→entregados→abiertos→clics) y
            tabla con detalle por campaña. Gráficos en SVG propio (sin dependencias),
            theme-aware y con paleta validada (dataviz). Datos ilustrativos hasta que el
            backend exponga métricas agregadas.
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

### Producto – Estimador de costo de envío (criterio para más adelante)
> **Objetivo:** antes de que el cliente confirme un envío, mostrarle un **estimado del
> valor** de esa campaña, para que decida con el costo a la vista (no cobrar a ciegas).

- [ ] **Mostrar un costo estimado en el flujo de envío** (pantalla previa a "Enviar"),
      recalculado en vivo según los parámetros de la campaña.
- **Factores que entran en el cálculo:**
  - **Cantidad de envíos** (nº de destinatarios del CSV / segmento).
  - **¿Lleva adjunto?** (sí/no) y **peso aproximado** del adjunto (por tramos de MB).
  - **Tipo de adjunto / canal:**
    - `EM` (sin adjunto) → costo base por correo.
    - `EAU` (adjunto único, mismo para todos) → base + recargo por peso del adjunto.
    - `EAP` (adjunto personalizado por destinatario) → base + costo de **combinación**
      por destinatario, **distinto si el documento es PDF o Word/.docx** (la generación
      y renderizado personalizado cuesta más y pesa más).
- **Dónde va:**
  - **Backend:** una tabla/JSON de **tarifas** (configurable, idealmente por cliente) y
    un endpoint tipo `POST /api/email/estimate` que reciba `{ channel, recipients,
    hasAttachment, attachmentSizeMB, attachmentType (pdf|docx), personalized }` y
    devuelva `{ estimatedCost, currency, breakdown }`. El desglose debe explicar cada
    componente (base × envíos, recargo por peso, recargo por personalización, etc.).
  - **Frontend:** en `CampanasSection`/portal, tras cargar el CSV y elegir opciones,
    llamar al estimador y mostrar el valor + desglose **antes** del botón de enviar,
    con la aclaración de que es un **estimado** (el cobro real puede variar).
- **Pendiente de definir:**
  - Modelo de precios y **moneda (COP)**: ¿tarifa plana por correo + recargos, o por tramos?
  - Cómo obtener el **peso del adjunto** (del archivo ya subido a S3 vía `get-urlS3`, o
    declarado por el usuario) y cómo estimarlo para `EAP` antes de generar los documentos.
  - Costos AWS de referencia (SES por correo, almacenamiento/tráfico S3, cómputo de la
    combinación docx/PDF) para calibrar la tarifa; redondeo, impuestos y mínimo por campaña.

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
- [ ] **Rotar/revocar** las AWS access keys (`consumoSQS`, `consumoS3`) y contraseñas que
      están en texto plano en `01_Documentacion/Tecnica/DatosTrabajo.txt`, y sacar ese
      archivo del control de versiones (`.gitignore`).

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
- Arquitectura completa y catálogo: **`README.md`** (raíz).
- Contrato de la API: **`09_Herramientas/01-MailConnect.postman_collection.json`**.
- Base de la API (Test): `https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api`
- Marca: fuente **Nunito**; colores del logo cyan `#00c3ff` / azul `#0075be` / navy `#16233f`.
- Para correr las pruebas: `cd 08_Pruebas/PruebasSeguridad && pip install -r requirements.txt && pytest -v`
