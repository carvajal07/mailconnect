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
> - **`PENDIENTES.md`** (raíz) → **backlog por bloques** (salido de la revisión
>   profunda de jul 2026): seguridad, despliegues `[J]` que desbloquean features ya
>   construidas, cierre del Estudio PDF, producto, tableros y panel admin.
>
> _Depuración de docs (ago 2026): se eliminaron 6 planes de features YA construidas
> cuyo detalle vive en este archivo y lo accionable en `PENDIENTES.md`/`DESPLIEGUE.md`
> — PLAN_APROBACIONES, PLAN_PREAGREGACION, PLAN_PREPAGO, PLAN_CACHE, PLAN_COPILOTO y
> PLAN_CASCADA. Se conserva `PLAN_MVP.md` (plan maestro con el gate de piloto abierto)._

_Última actualización: sesiones de trabajo sobre frontend (landing + auth) y backend de seguridad._

### Ajustes de producto y UI admin (ago 2026)
- **Funciones avanzadas OFF por defecto en clientes nuevos:** `Api_V1_Security_Register`
  escribe ahora `customer.featureFlags` con `DEFAULT_DISABLED_FEATURES` en **false** al crear
  la empresa: `func:canal_voz`, `func:canal_whatsapp`, `tab:whatsapp` (plantillas WSP),
  `tab:estudio` (PDF avanzadas), `tab:disenador` (PDF profesionales),
  `func:csv_multiregistro`, `func:json_import`. El resto sigue **FAIL-OPEN** (clave ausente =
  habilitada) → los clientes YA existentes no cambian. El admin las enciende por cliente en
  "Funciones por cliente". ⚠️ Mantener la lista en sync con `src/config/features.ts`.
- **Canales con clave propia:** el catálogo suma el grupo **Canales** con
  `func:canal_{sms,whatsapp,voz}`. `channelEnabled` exige TODAS las claves del canal:
  SMS = `func:canal_sms` + `tab:sms`; WSP = `func:canal_whatsapp` + `tab:whatsapp`;
  **VOZ = `func:canal_voz`** (antes Voz no se gateaba). Al conservar la clave del tab, los
  clientes que ya tenían el canal apagado por el tab NO lo recuperan.
- **Auditoría con color:** `ACTION_META` cubre ahora las ~35 acciones que emiten las lambdas
  (antes 12 → el resto salía en chip gris sin icono) + `FAMILY_META` (fallback por prefijo
  `security./support./balance./…`) para que una acción NUEVA salga con color/icono coherente.
  ⚠️ **NO se usa el `color` de MUI** en el chip: en el tema OSCURO de la marca `primary.main`
  es navy (`#0a1628`) y `secondary.main` azul oscuro (`#2a3d5f`) → los chips quedaban
  ilegibles (texto oscuro sobre fondo oscuro). En su lugar hay una paleta propia
  `ChipTone`/`TONE_COLORS` (blue·cyan·green·amber·red·purple·gray) **con un valor por modo**
  (claro/oscuro), y el chip sigue **outlined** aplicando ese color al **texto**, al **borde**
  y al **icono** (`& .MuiChip-icon`; por defecto MUI le pone su gris secundario y todas las
  acciones se veían iguales). El modo se lee con `useTheme().palette.mode`.
- **Verify-2fa sin PyJWT:** `Api_V1_Security_Verify-2fa` firma/valida el JWT con **stdlib**
  (`_jwt_encode`/`_jwt_decode`, HS256 con hmac+base64) en vez de `import jwt`. El CD crea las
  funciones nuevas en python3.13 y el layer de PyJWT está compilado para otro runtime → el
  import fallaba. Ahora **no necesita layer** ni runtime fijado (mismo enfoque que los gates
  admin y `Admin_Impersonate`).
- **Salud de despliegue:** secciones **contraídas** por defecto y carga **no bloqueante**:
  barra delgada + **esqueleto con los títulos** de las 4 secciones (`SECTION_SKELETON`) desde
  el primer render, así la página se ve completa mientras la verificación habla con AWS.
- **Plantillas de correo (admin):** el tab dejó de ser la herramienta legacy que solo mostraba
  lo creado/consultado en la sesión y pedía `userId`/`customerId` a mano. Ahora es el
  **inventario GLOBAL de SES** (`Admin/Templates`): filtro por **cliente** (prefijo del nombre
  `{cliente}_{consecutivo}_{nombre}`, resuelto al nombre de la empresa) y por nombre,
  paginación, **ver el contenido real** (asunto + HTML renderizado en iframe `sandbox=""` o el
  código) y eliminar de SES. Se quitó el alta manual: el nombre lo genera el builder del
  portal y una plantilla creada a dedo no sería seleccionable en las campañas (para diseñar
  está "Plantillas prediseñadas").
  ⚠️ **Ver/borrar van por la ruta ADMIN**, no por las de cliente: `Api_V1_Admin_Templates`
  acepta ahora `action: get|delete {name}` (mismo gate admin + 2ª barrera). Las rutas de
  cliente (`/Template/Get-template`, `/Template/Delete-template`) exigen que el nombre
  empiece por el prefijo del tenant del token, así que el admin recibía **403 "La plantilla
  no pertenece a tu cuenta"** con las de otras empresas; se resolvió por la lambda admin en
  vez de abrir un bypass por rol en una ruta de cliente. `[J]`: IAM **`ses:GetTemplate`** +
  **`ses:DeleteTemplate`** en `Api_V1_Admin_Templates` (antes solo `ses:ListTemplates`).
- **Paginación en Trabajos** (`JobsSection`) y **filtro por cliente** en Soporte → Plantillas SES.

### Impersonación auditada "ver como cliente" (ago 2026, Bloque D)
- **`Api_V1_Admin_Impersonate` (`POST /Admin/Impersonate`, admin + 2ª barrera):** emite un
  token de SESIÓN del tenant (customerId/customer/nit del cliente) para que el admin vea el
  portal como ese cliente, pero de **bajo privilegio y solo lectura**: `role=client` (no abre
  /admin), `tenantRole=operator` (los gates RBAC de sub-rol ya bloquean aprobar/rechazar/
  programar/ENVÍO REAL → la impersonación no gasta saldo ni dispara campañas), `readonly=true`
  + `impersonatedBy=<admin>`, `exp` corto (`IMPERSONATION_TTL_MIN` 30 min) y `sid` de una
  **sesión REAL** (revocable, marcada `impersonation:true`). Token firmado con stdlib HS256
  (sin PyJWT). Audita `support.impersonate`.
- **Enforcement en 3 capas:** (1) `Authorizer`/`Authorizer2` reenvían `readonly`/`impersonatedBy`
  en el context (+ mapping template `sync_api.py`); (2) **Prepare-batch** rechaza (403) toda
  sesión `readonly` ANTES de tocar campaña/saldo (ni muestras ni real — barrera server-side no
  puenteable); (3) el **apiClient** bloquea los endpoints de escritura (denylist `READONLY_
  BLOCKED`) en una sesión readonly, y el resto de mutaciones peligrosas (aprobar/programar/
  enviar) las corta el `tenantRole=operator`.
- **Front:** botón **"Ver como cliente"** en la ficha de Clientes (`ClientesSection`) →
  `impersonateService.start` → `enterImpersonation` (guarda la sesión del admin en
  `mc_admin_token`/`_user` y entra al portal). El portal muestra un **chip de advertencia**
  "Viendo como {empresa} · solo lectura" + botón **"Salir de la vista"** (`exitImpersonation`
  restaura la sesión del admin y vuelve a /admin, sin re-login). `isImpersonating`/
  `isReadOnlySession` en `authService`; la caché del portal se limpia al entrar/salir para no
  mezclar tenants.
- **Cobertura:** `test_impersonation.py` (6: gate admin, 400 sin id, 404 cliente, token
  readonly+operator+impersonatedBy + sesión + auditoría, Authorizer reenvía readonly,
  Prepare-batch rechaza readonly), `test_mapping_template.py` (+`impersonatedBy`/`readonly`).
- ⚠️ `[J]`: lambda `Api_V1_Admin_Impersonate` (el CD la crea) + ruta admin `/Admin/Impersonate`
  **ya en routes.json** + env `SECRET_KEY` (firma el token + 2ª barrera); IAM `GetItem customer`,
  `PutItem session`, `PutItem adminAudit`. Redesplegar los **Authorizers** + el **mapping
  template** (`deploy-api.yml`) para que reenvíen `readonly`/`impersonatedBy`.

### Panel de salud de despliegue (ago 2026, Bloque K)
- **`Api_V1_Admin_Deployment-health` (`POST /Admin/Deployment-health`, admin + 2ª barrera):**
  verifica CONTRA AWS si los recursos que el repo declara `[J]` existen de verdad — ataca la
  deriva "construido pero no desplegado". Secciones (cada chequeo **best-effort**: sin el
  permiso IAM → `unknown`, no penaliza): **tablas** núcleo (DescribeTable → ACTIVE/missing;
  las on-demand `assistantRateLimit`/`notificationLog` no penalizan si faltan), **colas** del
  pipeline + sus DLQ (GetQueueUrl), **lambdas críticas** (GetFunctionConfiguration → existe +
  las admin/JWT llevan `SECRET_KEY` + las de pipeline tienen su event source mapping ENABLED),
  y el **total de funciones** desplegadas (ListFunctions). Devuelve `sections[]` + `summary`
  (ok/warning/error/unknown). Estados por ítem: ok · missing · inactive · unwired · no-secret ·
  unknown.
- **Front:** sección admin **"Salud de despliegue"** (`DespliegueSection`, tab `despliegue`):
  chips de resumen + acordeones por sección (abiertos si no están OK) con tabla recurso/estado/
  detalle; aviso de que "sin verificar" = falta el permiso IAM de lectura, no que el recurso
  falte. `deploymentHealthService`.
- ⚠️ **No exhaustivo:** cubre el conjunto CRÍTICO (seguridad, admin, pipeline y features
  recientes) embebido en `CRITICAL_LAMBDAS`/`CORE_TABLES`/`PIPELINE_QUEUES` — al agregar una
  lambda/tabla/cola crítica nueva hay que sumarla al manifiesto de la lambda.
- **Cobertura:** `test_deployment_health.py` (5: gate admin, tabla faltante→missing, on-demand
  ausente no penaliza, colas existentes/faltantes, el resumen suma todos los ítems).
- ⚠️ `[J]`: ruta admin `/Admin/Deployment-health` **ya en routes.json** + env `SECRET_KEY`
  (2ª barrera). IAM solo-lectura (best-effort): `dynamodb:DescribeTable`, `sqs:GetQueueUrl`,
  **`lambda:GetFunctionConfiguration/ListFunctions/ListEventSourceMappings`** (el rol de
  convención no las incluye → agregar por `role-map.json` o inline; sin ellas, la sección de
  lambdas sale `unknown` pero tablas/colas siguen).

### Notificaciones al owner + centro de preferencias (ago 2026, Bloque H)
- **Notificaciones al owner (por correo, opt-in):** el cliente controla `customer.notify`
  (`{reputation, digest, lowBalance, lowBalanceThreshold}`, FAIL-OPEN: reputación+saldo bajo ON,
  resumen OFF, umbral 20.000 COP) desde **Mi cuenta** (`NotificationsCard`, solo owner) vía
  **`Api_V1_Notifications_Prefs`** (`POST /Notifications/Prefs`, get/set; set owner-only).
  Tres disparadores:
  - **Saldo bajo (instantáneo):** `Prepare-batch`, tras el débito del envío real, si el saldo
    quedó bajo el umbral → correo al owner (`notify_low_balance_if_needed`, best-effort,
    deduplicado por día vía tabla **`notificationLog`** PK `notifyKey`=customerId#kind#día, TTL).
  - **Reputación en riesgo + resumen diario (programado):** **`Api_V1_Notifications_Scan`**
    (cron EventBridge, `trigger-map.json` `cron(0 13 * * ? *)`): recorre clientes, lee la
    reputación de 7 días del rollup `{tenant}_sendSummary` (rebote/queja vs umbrales SES) y, si
    aplica, avisa; y si hubo actividad HOY y `digest` está ON, envía el resumen del día. Mismo
    dedup por (cliente, tipo, día). Owners = usuarios `tenantRole=owner` activos (fallback a
    cualquier activo).
  - ⚠️ **Campaña terminada** NO se implementó como aviso instantáneo: el pipeline distribuido
    NUNCA marca el proceso `Terminada` (no hay escritor de ese estado), así que no hay señal de
    completado confiable a la cual engancharse. El resumen DIARIO cubre "qué se envió"; el aviso
    por-campaña queda pendiente (exige un hook de completado en los workers).
- **Centro de preferencias del suscriptor (`Api_V1_Email_Preferences`, `GET/POST /Email/
  Preferences`, público/proxy):** página firmada (MISMO token HMAC del unsubscribe) donde el
  destinatario elige **frecuencia** (todas/menos/ninguna) y **temas** (promociones/novedades/
  transaccional), no solo la baja total. Guarda en `{tenant}_preferences` (PK email). Elegir
  "ninguna" o desmarcar TODO → escribe en `{tenant}_unsubscribe` (que Prepare-batch YA filtra);
  cualquier otra opción re-suscribe (borra de unsubscribe). La granularidad por TEMA se guarda
  como consentimiento; su APLICACIÓN (filtrar por tema) queda para cuando las campañas se
  etiqueten. `Send-EM` expone la variable **`{{preferencesUrl}}`** y el pie del builder HTML
  suma "Administrar preferencias · Cancelar suscripción".
- **Cobertura:** `test_notifications.py` (10: prefs get/set + owner-gate, scan reputación+resumen
  con dedup + preferencia apagada, saldo bajo notifica-una-vez/suficiente/desactivado),
  `test_preferences.py` (6: token inválido, GET, POST guarda, ninguna/sin-temas → baja, re-suscribe).
- ⚠️ `[J]`: lambdas `Api_V1_Notifications_{Prefs,Scan}` + `Api_V1_Email_Preferences` (el CD las
  crea) + rutas `/Notifications/Prefs` (authorizer) y `/Email/Preferences` (pública proxy) **ya
  en routes.json**; regla EventBridge del Scan (trigger-map.json); env `SENDER_EMAIL`/
  `NOTIFY_DASHBOARD_URL`/`PREFERENCES_URL`; IAM: Scan `Scan customer/process/user` + `BatchGetItem
  *_sendSummary` + `Get/PutItem notificationLog` + `ses:SendEmail`; Prefs `GetItem/UpdateItem
  customer`; Preferences `*_preferences`/`*_unsubscribe` (Get/Put/Delete/Create); Prepare-batch
  suma `Scan user` + `Get/PutItem notificationLog` + `ses:SendEmail` (ya tenía SES). Tabla
  `notify` en `customer` y `notificationLog` on-demand.

### 2FA (TOTP) para usuarios (ago 2026, Bloque I)
- **Segundo factor por TOTP** (RFC 6238, compatible con Google Authenticator/Authy/1Password),
  con stdlib (hmac/struct/base64, sin layer — igual que el JWT de los Authorizers).
- **Gestión (`Api_V1_Security_Totp`, `POST /Security/Totp`, tras el Authorizer):** `status`,
  `enroll` (genera secreto PENDIENTE + `otpauthUri` para el QR), `activate {code}` (verifica el
  1er código → activa + devuelve **10 códigos de respaldo** de un solo uso, hasheados en BD),
  `disable {code}` (exige un TOTP o código de respaldo válido). Datos en la tabla `user`
  (`totpEnabled`, `totpSecret`, `totpBackupCodes[]` sha256, `totpPendingSecret`).
- **Login en dos pasos:** `Login`, tras la contraseña correcta, si `totpEnabled` NO emite token;
  devuelve `data.twofaRequired=true` + `data.challenge` (JWT corto de 5 min, claim `twofa`). El
  ingreso se completa en **`Api_V1_Security_Verify-2fa`** (`POST /Security/Verify-2fa`, pública/
  pre-sesión): valida el desafío + el código (TOTP o respaldo, que se CONSUME), crea la sesión y
  emite el JWT real (idéntico a Login). Anti-fuerza-bruta: `twofaFails` en `user` → **429** a los
  5 fallos (hay que re-loguear); un ingreso correcto resetea el contador.
- **Front:** `TwoFactorCard` en Mi cuenta (QR con la lib `qrcode`, activación, códigos de
  respaldo mostrados UNA vez, desactivación); `LoginPage` gana la pantalla de código cuando
  `twofaRequired`; `authService.verify2fa` + `totpService`. La sesión sigue guardándose por
  pestaña (sessionStorage) igual que antes.
- **Cobertura:** `test_totp.py` (10: status/enroll/activate con código real/disable/403; login
  sin 2FA da token vs con 2FA pide desafío; verify con TOTP crea sesión, con código de respaldo
  que se consume, código malo + tope de intentos 429, desafío inválido 401).
- ⚠️ `[J]`: lambdas `Api_V1_Security_{Totp,Verify-2fa}` (el CD las crea) + rutas `/Security/Totp`
  (authorizer + mapping template con `userId`) y `/Security/Verify-2fa` (pública, sin authorizer)
  **ya en routes.json**; env `SECRET_KEY` en ambas (Verify-2fa firma el token, mismo layer PyJWT
  que Login); IAM: Totp `GetItem/UpdateItem user`; Verify-2fa `GetItem/UpdateItem user`, `GetItem
  customer/userData`, `PutItem session/adminAudit`. Campos `totp*`/`twofaFails` en `user` on-demand.

### Protección de reputación, límites y costos (ago 2026, Bloque E)
- **Rate limiting del chatbot público (`Api_V1_Assistant_Ask`)**: el endpoint es público y
  cada pregunta invoca un modelo de PAGO → limitador de ventana fija en DynamoDB (tabla
  **`assistantRateLimit`**, PK `rlKey`, TTL `expiresAt`; la crea la lambda on-demand):
  por IP `ASSISTANT_RATE_PER_MINUTE` (default 6) y `ASSISTANT_RATE_PER_DAY` (default 60),
  más un tope **GLOBAL** diario `ASSISTANT_RATE_GLOBAL_PER_DAY` (default 2000) que acota
  el costo total de Bedrock aunque el atacante rote IPs. Exceso → **429** con mensaje
  amable (el widget `LandingFloating` lo muestra; `assistantService` gana `reason:'rate'`).
  FALLA ABIERTO (error de DynamoDB → responde) y el chequeo va ANTES de invocar Bedrock.
  **`Assistant_Copilot`**: mismo patrón/tabla pero por TENANT y SOLO en `draft`/`rewrite`
  (`COPILOT_RATE_PER_MINUTE` 10 / `_PER_DAY` 200); `analyze` (determinista) no se limita.
- **Cuotas de envío por cliente (`customer.sendingLimits`)**: el admin fija **tope de
  destinatarios por campaña** y **tope diario** desde la ficha de Clientes ("Cuotas de
  envío"; 0/vacío = sin tope). `Customer/Update` acepta `limits` (merge por clave,
  auditado `customer.limits`); `Customer/List`/`Detail` los devuelven. **Gate en
  Prepare-batch** (`check_sending_limits`, envío real): corre tras el lock y ANTES de
  cobrar; si excede → `SendingLimitExceeded` → libera el lock y responde **429** (sin
  tocar saldo, sin marcar Error). El tope diario suma `registersToSend` de los procesos
  REALES de hoy (scan de `process` por customerName+fecha, muestras excluidas) — solo
  corre si hay tope configurado. Fail-open si falla la lectura de límites. ⚠️ Pendiente:
  tasa máxima (msgs/hora) — exige pacing en los workers.
- **Higiene de listas (`Api_V1_Database_Verify`, POST `/Database/Verify`)**: verificación
  PREVIA de una base registrada. Correo: sintaxis, duplicados, dominios **desechables**
  (lista embebida + env `HYGIENE_DISPOSABLE_EXTRA`), cuentas de **rol** (info@, noreply@…
  advertencia, no bajan score) y **dominio resoluble** (MX real con dnspython si el layer
  está; si no `socket.getaddrinfo`; cache por dominio, tope `HYGIENE_MAX_DOMAINS` 200 —
  lo saltado no penaliza). Celular: E.164 (+57) + duplicados. Devuelve counts + ejemplos
  (20 c/u) + `hygieneScore` (0-100; penalizan sintaxis/dup/desechable/no-resoluble) +
  `level` ok≥95/warning≥85/critical, y PERSISTE el resumen en `databaseFile.hygiene`.
  Front: botón escudo "Verificar higiene" en **Bases de datos** + diálogo del reporte
  (`databaseService.verify`). Tope `HYGIENE_MAX_ROWS` 20000 (más allá: truncated).
- **Cobertura:** `test_assistant_ratelimit.py` (6: 429 por minuto sin invocar el modelo,
  IPs independientes, tope global, fail-open + tabla on-demand, Copilot por tenant,
  analyze sin límite), `test_sending_limits.py` (6: topes campaña/diario con muestras y
  otros clientes excluidos, fail-open, Update merge + auditoría + List, negativos→0),
  `test_database_verify.py` (6: reporte completo, base limpia, celular, 403/404/400,
  tope de dominios no penaliza). `test_assistant.py` apaga el limitador (se prueba aparte).
- ⚠️ `[J]` (despliegue): lambda `Api_V1_Database_Verify` (el CD la crea) + ruta
  `/Database/Verify` **ya en routes.json**; IAM: Ask/Copilot `dynamodb:UpdateItem/
  CreateTable/DescribeTable/UpdateTimeToLive` sobre `assistantRateLimit`; Database_Verify
  `dynamodb:GetItem/UpdateItem databaseFile` + `s3:GetObject` (buckets de cliente), layer
  dnspython OPCIONAL (sin él, el chequeo MX cae a resolución de dominio); Prepare-batch
  ya tenía GetItem `customer` y Scan `process`. Envs `ASSISTANT_RATE_*`/`COPILOT_RATE_*`/
  `HYGIENE_*` opcionales (defaults arriba). El WAF/throttling de API Gateway sigue
  recomendado como capa extra (PENDIENTES Bloque 1.2).

### Series de 30 días + adiós "datos parciales" (ago 2026, Bloque A)
- **Serie temporal del cliente:** nueva lambda **`Api_V1_Reports_Series`** (POST
  `/Report/Series`, identidad del Authorizer): serie DIARIA CONTINUA de los últimos N días
  (default 30, máx. 90) con enviados/entregados/abiertos/clics/rebotes/quejas, leída BARATA
  del rollup `{tenant}_sendSummary` (BatchGetItem por proceso; sin escanear sendStatus).
  Excluye muestras; un proceso sin fila de rollup aporta `registersToSend` como enviados y
  cuenta en `withoutRollup` (correr `scripts/backfill_send_summary.py` lo elimina).
- **Serie global del admin:** `Api_V1_Admin_Dashboard` devuelve ahora `data.series`
  (helper `_series_global`, best-effort): mismos buckets diarios sobre TODOS los clientes
  (scan de `process` por fecha + BatchGet del rollup por tenant, tope 2000 procesos).
- **Frontend:** componente **`AreaChart`** en `portal/charts.tsx` (SVG propio, sin
  dependencias; leyenda interactiva mostrar/ocultar serie, guía vertical + tooltip por día,
  ejes con ticks, estado vacío, theme-aware; paleta `useSeriesColors` coherente con la
  categórica validada). "Actividad de los últimos 30 días" en **Estadísticas** del portal
  (`statsService.series`, best-effort: sin la ruta desplegada no se muestra) y en el
  **Panel de control** admin (`DashboardSection`, de `data.series`).
- **Adiós "datos parciales":** en los 4 lectores rollup-first (`Reports_Statistics`,
  `Admin_Dashboard`, `Billing_Summary`, `Portal_Bootstrap`) el tope de procesos se partió
  en dos: **absoluto generoso** (`MAX_PROCESSES` 5000, lecturas O(1) del rollup) y **bajo
  solo para el camino CARO** (`MAX_FALLBACK_QUERIES` 150–200: procesos SIN rollup que
  exigen query completa de `sendStatus`). Un proceso con rollup ya no consume el
  presupuesto → con el rollup poblado el aviso "(parcial)" desaparece; sin presupuesto de
  fallback, el proceso sin rollup se OMITE (truncated=true) pero los demás se agregan.
- **Cobertura:** `test_report_series.py` (8: 403 sin identidad, serie continua con ceros,
  bucketing por día + totales, exclusión de muestras, aislamiento de tenant, aproximación
  sin rollup, rango 90 días, clamp de days), `test_admin_dashboard.py` (+2: serie global
  con muestra excluida; rollup se agrega con fallback agotado), `test_listados_stats.py`
  (+1: rollup no consume fallback en Statistics).
- ⚠️ `[J]` (despliegue): lambda `Api_V1_Reports_Series` (el CD la crea) + ruta
  `/Report/Series` **ya en routes.json** (authorizer + CORS + mapping template con
  `customerId`/`customer`/`nit`); IAM `dynamodb:Scan process` + `BatchGetItem *_sendSummary`;
  en `Api_V1_Admin_Dashboard`, IAM `BatchGetItem *_sendSummary` (para la serie global).
  Para que el "(parcial)" desaparezca del histórico: correr `backfill_send_summary.py`.

### Centro de mando + caja de soporte admin (ago 2026)
- **Centro de mando (`CentroMandoSection` + `Api_V1_Admin_Control-center`)**: tablero de
  **operación en vivo**, nueva página de ENTRADA del admin (tab `centro`, default de
  `/admin`; el "Panel de control" histórico sigue como tab aparte). Secciones (cada una
  **best-effort** e independiente): resumen de chips por área; **salud de servicios**
  (cuota SES 24h con barra de uso + envío habilitado/deshabilitado, tablas DynamoDB núcleo
  ACTIVE, colas SQS accesibles); **pipeline** (procesos atascados en `Enviando/Procesando`
  >2 h, schedules `failed`, tabla de colas con profundidad + edad del mensaje más viejo +
  **DLQs** — DLQ con mensajes = crítico); **dinero del día** (débitos/recargas de hoy,
  solicitudes pendientes, saldo agregado de la plataforma); **reputación en riesgo** (top 5
  por rebote/queja de los últimos 7 días CON tendencia vs los 7 anteriores, leyendo el
  rollup `{tenant}_sendSummary` por processId — barato, sin escanear sendStatus); y últimas
  10 entradas de auditoría. **Auto-refresco cada 60 s** (switch). Umbrales: rebote 5/10%,
  queja 0.1/0.5% (los de SES), cuota SES 80%, backlog 1000 msgs / 30 min.
- **Soporte (`SoporteSection`, tab `soporte`)**, 3 pestañas: **Buscar destinatario**
  (`Api_V1_Admin_Recipient-lookup`: cliente + correo/celular → línea de tiempo de TODOS
  sus envíos con estado y detalle + banderas de lista negra/desuscrito; celular se
  normaliza a E.164); **Dominios remitentes** (`Api_V1_Admin_Domains`: los `senderDomain`
  de todos los clientes con empresa y estado, pendientes primero); **Plantillas SES**
  (`Api_V1_Admin_Templates`: listado GLOBAL con filtro/paginación — cierra el aviso de
  "solo lo creado en la sesión").
- **Acciones de soporte en la ficha del cliente** (`ClientesSection` +
  `Api_V1_Admin_User-support`, auditadas `support.*`): **reenviar activación** (solo
  cuentas inactivas; enlace nuevo de 24 h), **forzar reseteo** (OTP hasheado compatible
  con el flujo "¿olvidaste tu contraseña?") y **cerrar sesiones** (desactiva `session`;
  revocación real por el claim `sid`).
- **Export de auditoría**: `Admin/Audit` acepta `dateFrom`/`dateTo` (YYYY-MM-DD) y la
  sección tiene botón **"Exportar CSV"** (BOM UTF-8, `;`, exporta lo filtrado).
- **Fix "Saldo total plataforma" inflado (ago 2026):** el centro de mando sumaba TODA la tabla
  `customerBalance`, pero **`Customer/Delete` borra la empresa y sus usuarios y NO purga el
  saldo** → quedan filas **huérfanas** que el tab **Saldos** (`Admin/Balances`, que recorre
  `customer`) no cuenta y el centro de mando sí → los dos tableros mostraban cifras distintas.
  Ahora `_section_money` cruza contra los `customerId` que EXISTEN en `customer` y suma solo
  esos; lo huérfano se reporta **aparte** (`orphanBalance`/`orphanCount`) y la UI lo muestra
  como nota bajo el número ("+ $X de N cliente(s) eliminado(s), sin contar") en vez de
  ocultarlo. ⚠️ `[J]`: `Api_V1_Admin_Control-center` necesita **`dynamodb:Scan` sobre
  `customer`** (antes no lo leía; sin el permiso la sección de dinero cae a `error`).
- **Cobertura:** `test_control_center.py` (8: gate, atascados, DLQ crítica, dinero del día,
  saldo de plataforma excluye clientes eliminados, reputación con tendencia, salud,
  auditoría), `test_admin_support.py` (13: lookup por
  correo/celular normalizado + listas, las 3 acciones de soporte + auditoría + gates,
  plantillas y dominios globales), `test_admin_audit.py` (+1 rango de fechas).
- ⚠️ `[J]` (despliegue): 5 lambdas nuevas (`Api_V1_Admin_{Control-center,Recipient-lookup,
  User-support,Templates,Domains}` — el CD las crea) + rutas ya en `routes.json` (admin) +
  env `SECRET_KEY` en las 5 (2ª barrera; User-support además `SENDER_EMAIL`/
  `ACTIVATION_URL`/`OTP_EXPIRATION_MIN`). IAM: Control-center (Scans de process/
  scheduledSend/walletTransaction/customerBalance/**customer**/adminAudit, `BatchGetItem *_sendSummary`,
  `sqs:GetQueueUrl/GetQueueAttributes`, `ses:GetSendQuota/GetAccountSendingEnabled`,
  `dynamodb:DescribeTable`); Recipient-lookup (`GetItem customer`, `Scan *_sendStatus`,
  `BatchGetItem process`, `GetItem *_blackList/*_unsubscribe`); User-support (`GetItem user`,
  `PutItem userActivation/oneTimePassword/adminAudit`, `Scan/UpdateItem session`,
  `ses:SendEmail`); Templates (`ses:ListTemplates`); Domains (`Scan senderDomain/customer`).

### IP de envío dedicada por cliente (ago 2026)
- **Qué:** el admin asigna un **configuration set de SES** por cliente desde `/admin`
  **"IP de envío"** (`IpEnvioSection`): tabla de todos los clientes (Pool general vs IP
  dedicada) + diálogo (config set, pool, IPs informativas, habilitar/deshabilitar, notas).
- **Modelo SES:** en SES no se envía "por una IP" directo — la IP dedicada vive en un
  **pool de IP dedicada** y un **configuration set** apunta a ese pool (delivery options →
  `SendingPoolName`). Enviar con `ConfigurationSetName=<config set del cliente>` enruta por
  su IP. Un cliente **sin fila** (o deshabilitado) usa el config set **general**
  (`SES_CONFIGURATION_SET`, default `default`) = el pool por donde envían todos.
- **Backend:** tabla **`sendingConfig`** (PK `customerId`: `configurationSet`, `poolName`,
  `ips[]`, `enabled`, `notes`, `updatedAt`) + lambdas `Api_V1_SendingConfig_{List,Set}`
  (admin, 2ª barrera JWT, auditado `sendingConfig.set/remove`; `Set` crea la tabla
  on-demand, acepta `remove:true` para volver al general). **Ruteo:** `Prepare-batch`
  resuelve el config set del cliente (`resolve_configuration_set`, fail-open al general) y
  lo mete en `build_ctx` (`configurationSet`); **`Send-EM/EAU/EAP`** lo pasan a SES en vez
  del `"default"` hardcodeado (fallback defensivo al general para mensajes viejos en vuelo).
  Solo aplica a los canales de correo (SMS/WhatsApp/Voz no usan config set de IP).
- **Cobertura:** `08_Pruebas/PruebasSeguridad/test_sending_config.py` (List/Set admin gate,
  upsert, remove, enabled string→bool; `resolve_configuration_set` general vs dedicado vs
  deshabilitado; `build_ctx`/`prepare_message` llevan el config set).
- ⚠️ `[J]` (despliegue): tabla `sendingConfig` (la crea `Set` on-demand); lambdas
  `Api_V1_SendingConfig_{List,Set}` (el CD las crea si no existen); rutas
  `/SendingConfig/{List,Set}` **ya declaradas en `infra/api/routes.json`** (admin-only →
  `deploy-api.yml` las crea con authorizer + CORS + mapping template de `role`/`authToken`); env
  `SECRET_KEY` en ambas (2ª barrera); IAM `dynamodb:GetItem/PutItem/DeleteItem/Scan/
  CreateTable/DescribeTable` sobre `sendingConfig` + `PutItem adminAudit`; **`dynamodb:GetItem
  sendingConfig`** en `Prepare-batch`; env `SES_CONFIGURATION_SET` en Prepare-batch/Send-EM/
  EAU/EAP (opcional; default `default`). **En SES:** crear el pool de IP dedicada, mover la
  IP al pool, crear el config set del cliente apuntando al pool y **replicar su event
  destination (SNS)** para no perder rebotes/quejas en `Email_ReceptionStatus`.

### Canal Voz — estado y pendientes (ago 2026)
> El código de Voz (`Api_V1_Voice_Send-batch`) está COMPLETO y al día (idempotencia por
> parte, E.164, estados en `{tenant}_sendStatus`, muestras, `Context` para
> `Messaging_ReceptionStatus`). Lo "desatendido" es la **configuración/infra**, no el código.
- **Dónde se configura:** por **env vars** de la lambda `Api_V1_Voice_Send-batch`:
  `VOICE_ORIGINATION_IDENTITY` (obligatoria — número/pool con capacidad de **voz** en AWS
  End User Messaging), `VOICE_ID` (voz Polly, default `LUPE`), `VOICE_CONFIGURATION_SET`
  (opcional, para eventos), `VOICE_BODY_TEXT_TYPE` (`TEXT`|`SSML`). Sin
  `VOICE_ORIGINATION_IDENTITY` la lambda **lanza** y no procesa el lote.
- **Pendientes `[J]`/producto de Voz:** (1) habilitar un **número con capacidad de voz** en
  End User Messaging y ponerlo en `VOICE_ORIGINATION_IDENTITY`; (2) crear la cola
  `Voice_Send-batch` + trigger (ya en `trigger-map.json`); (3) IAM `sms-voice:SendVoiceMessage`
  en el rol de la lambda; (4) **estados de entrega**: crear el **configuration set de voz**
  con event destination → SNS y suscribir `Api_V1_Messaging_ReceptionStatus` (hoy Voz solo
  registra estado 1 "llamada iniciada"/3 "fallo"; sin el config set no hay 2 "contestada");
  (5) **tarifa** real por minuto (`basePerMinute`/`avgMinutes` en `pricingRate`, hoy indicativa);
  (6) producto: **consentimiento/opt-out** de voz (Ley 1581 / robocall), **ventana horaria**
  permitida, reintentos y `SSML` para pausas/número hablado. El estimador ya mapea `VOZ→VOICE`.

### Funciones por cliente (feature flags) (ago 2026)
- **Qué:** el admin enciende/apaga cada **tab** y **función** del portal **por cliente**
  desde una nueva sección `/admin` **"Funciones por cliente"** (`FuncionesClienteSection`):
  selector de cliente + lista agrupada con un **`Switch` verde/gris** por función (verde =
  habilitada). Ejemplos: apagar Plantillas PDF avanzadas (Estudio) o profesionales
  (Diseñador), el mapeo de CSV multiregistro, la importación de JSON, etc.
- **Backend:** las banderas viven en **`customer.featureFlags`** (map `{clave: bool}`).
  Convención **FAIL-OPEN**: clave ausente o `true` = habilitada; solo `false` la apaga
  (los clientes viejos sin el campo conservan todo). `Customer/Update` acepta ahora un
  map `features` (parcial) y hace **merge por clave** (lee el ítem, mergea y reescribe;
  auditado `customer.features`); `Customer/List` devuelve `featureFlags`; **Login** los
  incluye en `data.featureFlags` (aplican en el próximo inicio de sesión del cliente).
- **Frontend:** catálogo único en `src/config/features.ts` (`FEATURE_CATALOG` +
  `featureEnabled`/`tabEnabled`, FAIL-OPEN). Claves `tab:<id>` (mismo id de `PORTAL_TABS`)
  y `func:<x>` (funciones puntuales: `func:csv_multiregistro`, `func:json_import`). El
  portal (`PortalSidebar`/`PortalPage`) oculta los tabs deshabilitados (además del RBAC de
  sub-rol) y `BasesDatosSection` gatea el asistente multiregistro y la carga JSON. La
  sesión (`SessionUser.featureFlags`) se guarda al loguear.
- **Cobertura:** `08_Pruebas/PruebasSeguridad/test_customer_admin.py` (setear funciones,
  merge que no pisa otras, string→bool, realSend+features juntos, 404, List incluye flags).
- ⚠️ `[J]` (despliegue): campo `featureFlags` en la tabla `customer` (lo crea `Customer/Update`
  on-demand); **IAM `dynamodb:GetItem` sobre `customer` en `Api_V1_Customer_Update`** (antes
  solo hacía `UpdateItem`); `Login`/`Customer_List` ya leían la tabla. No hay rutas ni lambdas
  nuevas (reusa `/Customer/Update` y `/Customer/List`).

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
| `login` (2FA) | igual que `login` | Si el usuario tiene 2FA: 200 `data:{twofaRequired:true, challenge}` (sin `token`). El front completa con `Verify-2fa` |
| `Verify-2fa` | `{ challenge, code }` **público** | 200 `data:{token, ...}` (idéntico a login OK) · 401 código/desafío inválido o vencido · 429 demasiados intentos. `code` = TOTP o código de respaldo (se consume) |
| `Security/Totp` | `{ action: status\|enroll\|activate\|disable, code? }` (tras Authorizer) | `enroll`→`{secret, otpauthUri}` · `activate`→`{enabled, backupCodes[10]}` · `disable` (exige código) · `status`→`{enabled, pending}`. Gestión del 2FA TOTP del usuario |
| `Notifications/Prefs` | `{ action: get\|set, prefs? }` (tenant del token; set owner-only) | 200 `data:{notify:{reputation, digest, lowBalance, lowBalanceThreshold}}`. Preferencias de aviso al owner (saldo bajo, reputación, resumen diario) |
| `Email/Preferences` | **GET/POST público (proxy)** `?t=<token HMAC>` | 200 página HTML del **centro de preferencias** (frecuencia + temas). POST guarda en `{tenant}_preferences`; "ninguna"/sin-temas → da de baja (`{tenant}_unsubscribe`), otra opción re-suscribe |
| `Campaign/List` | `{ customerId }` | 200 `data:{campaigns[], count}` (orden desc por fecha; incluye `campaignState` y `messageTemplateId` de SMS/WSP) |
| `Campaign/Update` | `{ campaignId, campaignName?, channelName?, attachmentType?, dataPath?, template?, messageTemplateId?, from? }` | 200 ok · 409 no-Pendiente · 403 otro cliente · 404 no existe. Solo edita campañas en estado `Pendiente`; toma el cliente del context del Authorizer. `messageTemplateId` = referencia a la plantilla SMS/WSP (contenido en vivo al enviar) |
| `Campaign/Delete` | `{ campaignId }` | 200 ok · 400 falta id · 403 otro cliente · 404 no existe. Borra el registro de `campaign` (+ sus `document` best-effort); no borra el CSV ni el historial de procesos. Audita `campaign.delete` |
| `Campaign/Request-approval` | `{ campaignId }` | 200 ok · 400 (sin muestras) · 403 · 404 · 409. Flujo maker-checker: `approvalStatus none/rejected→pending` (exige `samplesSentCount>0`). Audita `campaign.request-approval` |
| `Campaign/Approve` | `{ campaignId }` | 200 ok · 403 · 404 · 409 (no pending). `pending→approved` (habilita el envío real). Audita `campaign.approve` |
| `Campaign/Reject` | `{ campaignId, reason }` | 200 ok · 400 (sin motivo) · 403 · 404 · 409. `pending→rejected` + motivo. Audita `campaign.reject` |
| `Schedule/Create` | `{ campaignId, scheduledAt (UTC ISO), templateVersion? }` | 201 `data:{scheduleId, scheduledAt, status:'pending'}` · 400 (fecha pasada/inválida) · 403 (otro cliente / no owner-approver) · 404 · 409 (ya enviando o aprobación pendiente). Programa el envío real a futuro (tabla `scheduledSend`) |
| `Schedule/List` | `{}` | 200 `data:{schedules:[{scheduleId, campaignId, campaignName, scheduledAt, status, firedAt, processId, error}], count}` (del tenant, próximos primero) |
| `Schedule/Cancel` | `{ scheduleId }` | 200 ok · 400 · 403 otro cliente · 404 · 409 (ya no está `pending`). `pending→canceled` |
| `Template/List` | `{ customer }` o `{ customerId }` | 200 `data:{templates:[{name, created}], count}` (SES filtrado por prefijo `{customer}_`) |
| `Template/Render-pdf` | `{ html o messageTemplateId, variables?, pageSize?, store?, filename? }` | 200 `data:{pdfBase64, filename}` (store=false) · `data:{path, url}` (store=true) · 400 · 403 · 500 (falta layer). Renderiza a PDF el HTML del editor sustituyendo `{{campo}}` (xhtml2pdf). Lo llama el botón "Vista previa PDF" del editor |
| `Email/Unsubscribe` | **GET/POST público (proxy, sin authorizer)** `?t=<token HMAC>` | 200 página HTML (confirmación / enlace inválido). El token lo firman las lambdas Send con `SECRET_KEY`; inserta en `{customer}_unsubscribe` (PK `email`) |
| `Database/Register-file` | `{ customerId, customer, fileName, s3Path, totalRecords?, channel?, columns?, previewRows?, duplicates?, allowDuplicates?, ... }` | 201 `data:{databaseFileId}`. `columns` = encabezados del CSV (campos usables como `{{variables}}`). `previewRows` = primeras filas (máx. 5) para la vista previa persistente. `allowDuplicates` = si el envío real NO filtra contactos repetidos |
| `Database/List` | `{ customerId }` | 200 `data:{files[], count}` (incluye `columns`, `previewRows`, `validEmails`, `invalidEmails`) |
| `Database/Delete` | `{ databaseFileId }` | 200 ok · 403 otro cliente · 404 no existe. Borra el registro (no el CSV en S3) |
| `Database/Verify` | `{ databaseFileId }` (tenant del token) | 200 `data:{counts{valid,invalidSyntax,duplicates,disposable,roleAccounts,unresolvableDomains}, samples, domains, hygieneScore, level, truncated}` · 403 · 404 · 502 S3. **Higiene de listas**: verificación previa de la base (correo: sintaxis/duplicados/desechables/rol/dominio resoluble · celular: E.164/duplicados). Persiste el resumen en `databaseFile.hygiene` |
| `Customer/List` | `{}` (**admin**) | 200 `data:{customers:[{customerId, company, companyTin, realSendEnabled}], count}` |
| `Customer/Update` | `{ customerId, realSendEnabled? (bool), features? ({clave:bool}), limits? ({maxPerCampaign, maxPerDay}) }` (**admin**) | 200 ok · 404 no existe · 400 datos. Togglea el bloqueo de envíos reales, **banderas de funciones** y/o **cuotas de envío** por cliente (merge por clave; 0 = sin tope). Devuelve `data:{realSendEnabled, featureFlags, sendingLimits}`. Audita `customer.realSend` / `customer.features` / `customer.limits` |
| `SendingConfig/List` | `{}` (**admin**) | 200 `data:{configs:[{customerId, configurationSet, poolName, ips[], enabled, notes, updatedAt}], count}`. IP de envío dedicada por cliente (tabla `sendingConfig`) |
| `SendingConfig/Set` | `{ customerId, configurationSet, poolName?, ips?[], enabled?=true, notes? }` o `{ customerId, remove:true }` (**admin**) | 200 ok · 400 datos. Upsert de la IP dedicada (config set SES) o baja (`remove` → pool general). Crea la tabla on-demand. Audita `sendingConfig.set/remove` |
| `MessageTemplate/Create` | `{ channel:SMS\|WSP\|DOCX\|PDF, name, body?/hsmName?+language?+params?/s3Path?+params?/html? }` | 201 `data:{messageTemplateId}` · 400 datos. SMS necesita `body`, WSP `hsmName`, DOCX `s3Path`, **PDF `html`** (el HTML del editor) |
| `MessageTemplate/List` | `{ customerId, channel? }` | 200 `data:{templates[], count}` (desc por fecha; filtra por canal si se envía) |
| `MessageTemplate/Delete` | `{ messageTemplateId }` | 200 ok · 403 otro cliente · 404 no existe |
| `Blacklist/List` | `{ customerId }` o `{ customer }` | 200 `data:{items:[{email, rejectionType, description, date}], count}` (tabla `{customer}_blackList`) |
| `Blacklist/Add` | `{ email (correo o celular), reason? }` | 201 ok · 400 datos. Crea la tabla si no existe (PK `email`) |
| `Blacklist/Delete` | `{ email }` | 200 ok · 404 no estaba · 400 datos |
| `Domain/Add` | `{ identity }` (dominio `empresa.com` o correo `x@empresa.com`; se detecta por `@`) | 201 `data:{domainId, kind, domain, status:'pending', records[]}` · 200 (reenvío de correo pendiente) · 400 · 403 · 409. **Dominio**: `verify_domain_identity + verify_domain_dkim` → 1 TXT + 3 CNAME. **Correo**: `verify_email_identity` → SES envía un enlace al correo (`records:[]`, sin DNS) |
| `Domain/List` | `{}` | 200 `data:{domains:[{domainId, kind, domain, status, records, createdAt, verifiedAt}], count}`. Refresca el estado desde SES (pending/verified/failed) para dominios **y** correos |
| `Domain/Delete` | `{ domainId }` | 200 ok · 400 · 403 otro cliente · 404. Borra el registro + `delete_identity` en SES (best-effort) |
| `Pricing/List` | `{ customerId? }` (**admin**) | 200 `data:{customerId, defaults, effective, overrides, currency}` (alcance `*` global o cliente) |
| `Pricing/Update` | `{ customerId?, channel, fields }` (**admin**) | 200 ok · 400. `channel` ∈ EMAIL·SMS·WHATSAPP·VOICE·COMMON (COMMON escribe taxRate/minCampaign en los 4) |
| `Customer/Detail` | `{ customerId }` (**admin**) | 200 `data:{customer, users:[{userId,email,name,phone,role,active}], count}` · 404 |
| `Customer/Delete` | `{ customerId }` (**admin**) | 200 `data:{customerId, deletedUsers}` · 400 (falta id / es tu propia empresa) · 403 · 404. Borra `customer` + sus `user`/`userData` (best-effort); **no** purga el histórico (campañas/envíos/saldo). Audita `customer.delete` |
| `User/SetRole` | `{ userId, role (admin\|client) }` (**admin**) | 200 ok · 400 · 404 · 409 (no degradar al último admin) |
| `Billing/Summary` | `{ month?, customerId? }` (**admin**) | 200 `data:{customers:[{company, totalSent, subtotal, tax, total, byChannel[]}], totals, truncated}` |
| `Admin/Dashboard` | `{ month? }` (**admin**) | 200 `data:{kpis, funnel[], byChannel[], health:[{company, sent, bounceRate, complaintRate, level}], series:[{date, enviados, entregados, abiertos, ...}], truncated}` (panel global + reputación + serie diaria de 30 días de toda la plataforma) |
| `Admin/Jobs` | `{ month?, state? }` (**admin**) | 200 `data:{jobs:[{campaignName, company, channelLabel, processState, campaignState, sent, registersToSend, progress, blocked{}}], counts, truncated}` (solo lectura) |
| `Config/Get` | `{}` (**admin**) | 200 `data:{settings:[{key, label, group, type, default, value, isOverridden, consumers[]}]}` |
| `Config/Set` | `{ key, value }` (**admin**) | 200 ok · 400 key/valor inválido. Crea `platformConfig` si no existe |
| `Admin/Audit` | `{ month?, action?, actor?, dateFrom?, dateTo? }` (**admin**) | 200 `data:{entries:[{date, actor, action, target, detail}], count, actions[], truncated}` (bitácora, solo lectura; `dateFrom/dateTo` YYYY-MM-DD inclusivo = rango del export CSV de la UI) |
| `Admin/Control-center` | `{}` (**admin**) | 200 `data:{pipeline:{stuckProcesses[], stuckCount, failedSchedules[], queues:[{queue, depth, oldestSeconds, dlqDepth, level}]}, money:{todayDebits, todayTopups, pendingTopups, platformBalance}, reputation:{top:[{company, sent, bounceRate, complaintRate, level, trend}]}, health:{services:[{service, status, detail, metric?}]}, audit[], generatedAt}` — **Centro de mando** (operación en vivo; cada sección best-effort) |
| `Admin/Deployment-health` | `{}` (**admin**) | 200 `data:{sections:[{key, title, level, ok, total, items:[{name, status, detail}]}], summary:{ok, warning, error, unknown}, generatedAt}` — **Salud de despliegue**: verifica contra AWS que lambdas/tablas/colas/`SECRET_KEY`/triggers críticos existan (deriva "construido pero no desplegado"; best-effort → `unknown` sin el permiso IAM) |
| `Admin/Impersonate` | `{ customerId }` (**admin**) | 200 `data:{token, customer, customerId, companyTin, expiresInMinutes, impersonatedBy}` · 400 · 404. **"Ver como cliente"**: emite un token de sesión del tenant en SOLO LECTURA (`role=client`, `tenantRole=operator`, `readonly=true`, `impersonatedBy`, exp 30 min, sesión revocable). Audita `support.impersonate` |
| `Admin/Recipient-lookup` | `{ customerId, contact }` (**admin**) | 200 `data:{company, timeline:[{date, campaignName, channel, state, stateLabel, detail}], count, truncated, lists:{blacklisted, unsubscribed}}` · 404 cliente. "¿Qué le llegó a X?" — línea de tiempo por contacto (correo o celular, normaliza E.164) |
| `Admin/User-support` | `{ userId, action: resend-activation\|force-reset\|revoke-sessions }` (**admin**) | 200 ok · 400 · 404 · 409 (activación con cuenta ya activa). Acciones de soporte auditadas (`support.*`): reenvía activación (enlace nuevo 24 h), envía OTP de reseteo (hasheado, compatible con Validate-otp), o desactiva TODAS las sesiones del usuario (revocación por `sid`) |
| `Admin/Templates` | `{}` (**admin**) | 200 `data:{templates:[{name, customerPrefix, createdAt}], count, truncated}` — listado GLOBAL de plantillas SES (`ListTemplates` paginado) |
| `Admin/Domains` | `{}` (**admin**) | 200 `data:{domains:[{domainId, customerId, company, kind, domain, status, createdAt}], count}` — dominios/correos remitentes de TODOS los clientes (pendientes primero) |
| `Report/Series` | `{ days? }` (tenant del token; default 30, máx. 90) | 200 `data:{from, to, days:[{date, enviados, entregados, abiertos, clics, rebotes, quejas}], totals, withoutRollup}` · 403 sin identidad. Serie DIARIA continua desde el rollup `{tenant}_sendSummary` (excluye muestras; sin rollup aproxima por `registersToSend`). La consume el gráfico "Actividad de los últimos 30 días" de Estadísticas |
| `Balance/Get` | `{ limit? }` (tenant del token) | 200 `data:{customerId, balance, currency, transactions:[{txId, type, amount, balanceAfter, status, reference, bank, detail, rejectReason, createdAt}], count}` (saldo + movimientos; lee por GSI `customerId-createdAt-index` con fallback a Scan) |
| `Balance/Topup-manual-request` | `{ amount (COP>0), proofS3Path, bank?, reference?, note? }` (tenant del token) | 201 `data:{txId, status:'pending'}` · 400 · 403. Crea la solicitud manual `pending` (no toca el saldo); el comprobante ya se subió a S3 (get-urlS3, documentType=document) |
| `Balance/Topup-manual` | `{ customerId, amount (COP>0), note? }` (**admin**) | 200 `data:{balance, txId}` · 400 · 403. **Ajuste directo** (crédito) del admin — tipo `adjustment` (correcciones/cortesías); distinto de la solicitud del cliente |
| `Admin/Topups` | `{ status? (pending\|approved\|declined\|all), month? }` (**admin**) | 200 `data:{topups:[{txId, customerId, company, amount, bank, reference, status, rejectReason, proofUrl, createdAt}], count}` (bandeja + URL prefirmada del comprobante) |
| `Admin/Topup-approve` | `{ txId }` (**admin**) | 200 ok (idempotente si ya aprobada) · 404 · 409. `pending→approved` + acredita saldo en un `TransactWriteItems` atómico. Audita `balance.topup.approve` |
| `Admin/Topup-reject` | `{ txId, reason }` (**admin**) | 200 ok · 400 · 404 · 409. `pending→declined` + motivo; no toca el saldo. Audita `balance.topup.reject` |
| `Admin/Balances` | `{}` (**admin**) | 200 `data:{customers:[{customerId, company, companyTin, balance, updatedAt}], totals:{balance}, recentTransactions[], count}` (saldo de todos, menor primero + ledger global) |
| `Balance/Topup-init` | `{ amount (COP≥20000) }` (tenant del token) | 200 `data:{reference, amountInCents, currency, publicKey, signatureIntegrity, redirectUrl?}` · 400. Firma de integridad Wompi; crea el intento `pending` en el ledger |
| `Wallet/Wompi-webhook` | **público/proxy sin authorizer** (evento Wompi firmado) | 200 ack. Verifica la firma del evento y acredita **idempotente** por `reference` (pending→approved, `TransactWriteItems`); nunca acredita desde el redirect del navegador |
| `Assistant/Ask` | **público/proxy sin authorizer** `{ question }` | 200 `{answer}` · 400 vacía · **429 límite de uso** (por IP 6/min · 60/día + tope global 2000/día, tabla `assistantRateLimit`) · 502 modelo no disponible. Asistente de IA (AWS Bedrock Converse, modelo Claude) con prompt de sistema aterrizado en MailConnect; responde en español, solo sobre la plataforma. Lo usan los botones flotantes de la landing |
| `Cascade/Dispatch` | `{ name, dataPath, waitMinutes?, successCriterion?, steps:[{channel(EM\|SMS\|WSP\|VOZ), content}] }` | 201 `data:{cascadeRunId, contacts, debited}` · 400 · 402 saldo · 403. Lanza la **cascada omnicanal** (Opción A): crea el run + un contacto por fila, filtra consentimiento del canal 0, encola el paso 0 y debita su costo. |
| `Cascade/List` | `{}` (tenant del token) | 200 `data:{runs:[{cascadeRunId, name, steps, status, counts{total,confirmed,exhausted,inFlight,budget}, createdAt}], count}` |
| `Cascade/Advance` | (EventBridge cron; sin body) | Tick del motor: por cada contacto vencido lee el estado en `sendStatus`, y confirma/escala/agota/frena por saldo (`decide_next`). Escala encolando el siguiente canal + debitando |
| `Assistant/Copilot` | `{ action:analyze\|draft\|rewrite, ... }` (portal, tras Authorizer) | **Copiloto de campañas (Opción B).** `analyze` (DETERMINISTA, sin IA): `data:{score, level, issues[], suggestions[], habeasData{ok,present,missing,requiredMissing}, sendTime}` — spam/entregabilidad + checklist Ley 1581 + hora óptima. `draft`/`rewrite` (Bedrock): redacta/mejora copy. ⚠️ **UI oculta (jul 2026):** el tab **"Copiloto IA"** se quitó del portal (`PortalSidebar`/`PortalPage`) por decisión de producto ("de momento"); la lambda + la ruta `/Assistant/Copilot` quedan **desplegadas pero dormidas** (`CopilotoSection.tsx`/`copilotService.ts` quedan huérfanos). Re-habilitar = volver a agregar el tab + el `case`. |

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
   Send-EAU **y Send-EAP** además agregan headers `List-Unsubscribe` +
   `List-Unsubscribe-Post` (RFC 8058).
3. La lambda `Api_V1_Email_Unsubscribe` (pública) valida la firma e inserta el email en
   `{customer}_unsubscribe` (PK `email`) y muestra una página de confirmación con la marca.
4. Prepare-batch filtra contra esa tabla en el envío real (chequeo reparado: antes nunca corría).
   ✅ EAP ya reemplaza `{{unsubscribeUrl}}` por destinatario (mismo patrón que EAU; jul 2026).
   Requiere la env `SECRET_KEY` (y `UNSUBSCRIBE_URL`) también en `Send-batch-template-EAP`.

### Tres niveles de plantillas PDF + motor estándar (jul 2026)
> **Objetivo:** tres generadores de PDF en el portal, del más simple al más potente, con
> **un solo contrato** de render por plantilla posicionada. Los diseñadores se trajeron
> (COPIADOS, los repos `workflow*` originales NO se tocan) de:
> `carvajal07/workflow` (pdfsketch) y `carvajal07/workflow-doc-studio` (DocumentDesigner);
> el motor de `carvajal07/workflow-doc-studio-production` (pdf_engine, ReportLab).

- **Nivel BÁSICO — "Plantillas PDF"** (sin cambios): editor tipo Word (`PdfTemplatesSection`,
  HTML + xhtml2pdf vía `Api_V1_Template_Render-pdf`).
- **Nivel MEDIO — "Estudio PDF"** (`PdfStudioSection` → chunk lazy `SketchStudio`): editor de
  lienzo **pdfsketch** (Konva) copiado a `src/pdfsketch/`, scopeado bajo `.mc-sketch` (Tailwind
  SOLO para esa carpeta, sin preflight → MUI intacto; alias `@` → `src/pdfsketch`). **El export
  pasó de XML a JSON**: envelope `{schema:'pdfsketch@1', document}` (`json/documentJson.ts`),
  que es lo que se guarda en el backend y lo que consume el motor.
  - **Paridad con el Diseñador (jul 2026):** la sección es un **lanzador** (tarjetas de plantillas
    + "Nuevo diseño") y el editor abre a **pantalla completa** (overlay, barra Guardar/Vista
    previa/Cerrar con confirm si hay cambios). **Tema claro/oscuro sincronizado** con el
    ThemeContext del portal (tokens `.light` del sketch). **Reglas estilo Diseñador**
    (`Rulers.tsx` reescrito: ticks por unidad + paleta por tema) con **unidades mm/cm/pt/px/in**
    (`utils/displayUnits.ts`, selector en la StatusBar; cursor y tamaño de hoja formateados en la
    unidad). StatusBar suma **1:1** y **Ajustar a la ventana** (uiStore `fitTick/requestFit`).
    La hoja dibuja sus **márgenes** punteados (`Sheet.tsx`). **Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y**
    por teclado (keydown del Canvas; la selección múltiple marquee+shift ya existía). El tab
    "Estilos" pasa a **"Recursos"** con sección de **Colores** del documento (CRUD en
    `documentStore`: addColor/updateColor/removeColor; clic aplica a la selección).
- **Nivel FULL — "Diseñador PDF"** (`DesignerPdfSection` → chunk lazy `DesignerStudio`): el
  **DocumentDesigner** completo copiado a `src/designer/` (+ satélites `ScriptProcessor/config`,
  `DataProcessor/engine/JsonPath`, `tokens.css`; `allowJs` activado en tsconfig). Abre como
  overlay full-screen; las variables `{{campo}}` se alimentan con las **columnas de las bases**
  del cliente. Gráficas (vega) quedan en chunk dinámico propio.
- **Paridad de Recursos con el Diseñador (jul 2026):** el Estudio PDF trae ahora TODOS los
  tipos de recurso del Diseñador con configuraciones FUNCIONALES de punta a punta (modelo →
  canvas → traductor → motor): **texto** (subrayado/tachado, super-subíndice, interletra,
  transformación de mayúsculas, interlineado), **párrafo** (listas viñetas/numeradas/letras,
  sangrías, primera línea, espacio antes/después + flujo), **relleno** (sólido/degradado
  lineal-radial con stops + opacidad), **color** (HTML/RGB/CMYK + alfa) y **borde/línea** (ya
  estaban completos). Elemento nuevo **triángulo** (herramienta + render + motor). Los estilos
  se vinculan por `textStyleId`/`paragraphStyleId`/`fillStyleId` → editar el recurso actualiza
  los elementos EN VIVO (`documentStore.updateStyle`). Motor: `html_parser` parsea `<s>/<strike>`
  y `line-through`; `text_renderer` aplica decoraciones del estilo + **interletra** (layout
  manual con `charSpace`); `shape_renderer` pinta **degradados** (clip + linear/radialGradient)
  y opacidad; el traductor emite todo (spans con estilos por-fragmento → contentarea, listas →
  `<ul>/<ol>`). Cubierto por `08_Pruebas/PruebasSeguridad/test_paridad_estilos.py` (11).
  NO portado (el motor no lo renderiza): rellenos por imagen/condicionales, tabuladores,
  separación silábica, catálogo de 49 formas y gráficas del Diseñador.
- **Motor estándar** — lambda **`Api_V1_Template_Render-engine`** (`POST /Template/Render-engine`,
  no-proxy, envelope): `pdf_engine/` de production **vendorizado** + `sketch_translator.py`
  (pdfsketch JSON → templateJson: unidades mm/pt/px, var-tags `data-var` con rutas de punto,
  warnings de elementos no soportados — pen/data-URI/rotación). Request:
  `{ templateJson | sketch | messageTemplateId, data, store?, filename? }` → base64 o S3
  (`attachment/pdf-preview/…`). Imágenes por URL http(s) (descarga a /tmp con tope). Fix real
  al motor: `drawImage` con `ImageReader` en QR/barcode (con BytesIO reventaba).
- **Persistencia:** `MessageTemplate_Create` (channel `PDF`) acepta ahora **tres formatos**:
  `html` (básico), `sketchJson` (medio) o `templateJson` (full), guardados como **string JSON**
  (`_json_field`). El front (`messageTemplatesService`) expone los tres campos; `Render-engine`
  puede renderizar por `messageTemplateId` (valida tenant).
- **Front:** `pdfEngineService.ts` (`RENDER_ENGINE`), tabs nuevos `estudio` y `disenador`
  (`PortalSidebar`/`PortalPage`), visibles para todos los roles (como los demás tabs de plantillas).
- **Pruebas:** `08_Pruebas/PruebasSeguridad/test_render_engine.py` (13: render real con
  reportlab, traductor elemento a elemento, contrato del handler, S3 con moto, canal PDF
  extendido). Suite completo en verde. `requirements.txt` suma reportlab/qrcode/pillow.
- ⚠️ `[J]` (despliegue): crear `Api_V1_Template_Render-engine` + ruta `/Template/Render-engine`
  (authorizer + CORS + mapping template con `customerId`/`customer`/`nit`); **layer** con
  `reportlab` + `Pillow` (+ `qrcode`, `python-barcode`) para el runtime; IAM
  `dynamodb:GetItem messageTemplate` + S3 `PutObject` (store). El paquete de la lambda incluye
  `pdf_engine/`, `sketch_translator.py` y `fonts/` (el CD sube la carpeta completa).
- **Paridad de render lienzo↔PDF (jul 2026):** se corrigieron las diferencias visibles entre el
  lienzo del Estudio PDF y el PDF del motor (comparación con capturas): **giro** de las formas
  (el motor no aplicaba `rotation` → ahora gira alrededor del centro, `canvas.rotate(-rot)`);
  **degradado radial "gigante"** (el clip usaba `path.ellipse(x,y,x+w,y+h)` pasando esquinas donde
  ReportLab espera **ancho/alto** → clip enorme que desbordaba la elipse; corregido a
  `path.ellipse(x,y,w,h)`); **relleno que se salía del rectángulo redondeado** (el clip del
  degradado ahora usa `roundRect` cuando hay radio); **bordes de tabla invisibles** (el ancho se
  reducía a la mitad = 0.2 pt y el `borderWidth` del sketch venía en mm tratado como pt → el
  traductor convierte mm→pt y el renderer aplica un mínimo `max(0.5/0.4pt)`); **encabezado/pie de
  tabla** con su color de fondo + texto de contraste + tamaño (el traductor los emite; el renderer
  los pinta con `_band_style_cmds` y arma los `Paragraph` con su color — `TableStyle` `TEXTCOLOR`
  no afecta `Paragraph`); **cebra** limitada a las filas del CUERPO (no pisa encabezado/pie).
- ⚠️ Pendientes conocidos del motor (nivel FULL): tablas standalone usan el modelo viejo
  (las de rowSets solo renderizan EMBEBIDAS en áreas), bordes de celda por `styleRef` sin
  resolver, sin merges (`spanUp/spanLeft`), `flowType:'repeated'` sin implementar, sin render
  de gráficas. El editor las diseña; cerrar esa brecha es la siguiente iteración del motor.

### Landing: login responsive, botones flotantes y asistente IA (jul 2026)
- **Fix login en móvil:** en la landing el botón "Iniciar sesión" se ocultaba en pantallas
  ≤640px (clase `nav-hide` → `display:none`) y "desaparecía". Se quitó ese ocultamiento y se
  compactó el nav (gaps y padding de botones) para que **ambos** botones quepan hasta ~320px.
- **Botones flotantes (abajo-derecha):** componente `LandingFloating.tsx` (autocontenido, estilos
  en línea → portable): FAB de **WhatsApp** (enlace `wa.me`) + FAB de **Asistente IA**. Se ocultan
  mientras el chat está abierto (se cierra con la × del encabezado).
- **Asistente de IA (AWS Bedrock):** `Api_V1_Assistant_Ask` (pública/proxy + CORS) llama a Bedrock
  (**Converse API**, modelo Claude) con un **prompt de sistema aterrizado en MailConnect** (qué es,
  canales, precios, saldo, cumplimiento) y responde en español, SOLO sobre la plataforma; si no
  sabe, remite a WhatsApp. El chat del front (`LandingFloating` + `assistantService.ts`) degrada con
  gracia si la lambda no está desplegada (muestra fallback a WhatsApp). Env: `BEDROCK_MODEL_ID`
  (default `anthropic.claude-3-5-haiku-...`; ⚠️ Bedrock on-demand suele exigir un **inference
  profile** regional, p. ej. `us.anthropic.claude-3-5-haiku-...`), `BEDROCK_REGION`,
  `ASSISTANT_MAX_TOKENS`. Cubierto por `08_Pruebas/PruebasSeguridad/test_assistant.py` (Bedrock
  stubeado). ⚠️ `[J]` (despliegue): habilitar acceso al modelo en Bedrock; IAM `bedrock:InvokeModel`
  (+ ARN del inference profile si aplica); ruta **pública** `/Assistant/Ask` (proxy, sin authorizer,
  CORS) + **throttling/WAF** (endpoint público → posible abuso/costo).
- **IAM `aws-marketplace` para Bedrock (ago 2026):** invocar Claude por Bedrock exige, además de
  `bedrock:InvokeModel`, los permisos `aws-marketplace:Subscribe/Unsubscribe/ViewSubscriptions`
  (AWS valida la suscripción al modelo vía Marketplace en la primera invocación; sin esto el
  error típico es `AccessDeniedException` mencionando `marketplace` al llamar Converse/
  InvokeModel). `AmazonBedrockFullAccess` **no** los incluye. `deploy-lambdas.yml` ahora agrega
  un inline `BedrockMarketplace` a cualquier rol con el token `Bedrock` — tanto al **crear** el
  rol (`ensure_role`) como en **cada despliegue** de una lambda que invoque Bedrock
  (`reconcile_bedrock`, detecta `boto3.client('bedrock'|'bedrock-runtime')` en el código y se lo
  añade al rol ACTUAL de la función, sin esperar a que el rol se recree) — así
  `Api_V1_Assistant_Ask` y `Api_V1_Assistant_Copilot` (las dos únicas que usan Bedrock) reciben
  el permiso en el próximo push aunque su rol ya exista.
- **Bloqueante DISTINTO (no es IAM): medio de pago de AWS Marketplace (ago 2026).** Con el IAM
  ya correcto, Bedrock puede seguir rechazando la invocación con `AccessDeniedException:
  INVALID_PAYMENT_INSTRUMENT — A valid payment instrument must be provided... Your AWS
  Marketplace subscription for this model cannot be completed`. Los modelos Anthropic en
  Bedrock se activan como una suscripción de **AWS Marketplace** (el "Model access" de la
  consola de Bedrock la crea por debajo) y esa suscripción exige que la **cuenta de AWS**
  (no la lambda, no el IAM) tenga un **método de pago válido** en Billing. No es un `[J]` de
  código/IAM — lo resuelve quien administra la cuenta de AWS (facturación), no algo
  desplegable desde este repo:
  1. **Billing and Cost Management → Payment preferences**: agregar/verificar una tarjeta
     válida (si la cuenta es de una organización con facturación consolidada, el método de
     pago vive en la cuenta **pagadora**, no necesariamente en la cuenta donde corren las
     lambdas).
  2. **Amazon Bedrock → Model access**: confirmar que el acceso al modelo (Claude Haiku/
     Sonnet/Opus) siga en estado "Access granted" (si quedó en error, reintentar la
     solicitud tras arreglar el pago).
  3. Esperar los ~2 minutos que indica el propio mensaje de error antes de reintentar.
  Arregla esto UNA vez a nivel de cuenta y desbloquea **ambas** lambdas de Bedrock a la vez
  (no hay nada que tocar por lambda).

### Rol del Asistente IA (ago 2026)
> Es un endpoint **público, sin sesión** (cualquiera en internet le escribe) y **sin tools**:
> todo lo que "sabe" y "puede/no puede decir" vive en un único `SYSTEM_PROMPT` (string) dentro
> de `Api_V1_Assistant_Ask/lambda_function.py`. No hay acceso a datos de clientes ni a la BD.
- **Identidad y alcance:** asistente de MailConnect (comunicaciones masivas omnicanal sobre
  AWS); aclara explícitamente que NO tiene sesión ni acceso a cuentas/campañas/saldo reales.
- **Catálogo que puede explicar:** los 3 tipos de correo (EM/EAU/EAP), SMS, WhatsApp (HSM de
  Meta), Voz (TTS), la cascada omnicanal ("Entrega garantizada"), combinación de correspondencia,
  editor HTML/PDF, carga de bases (CSV/Excel/JSON), lista negra, dominios propios verificados,
  flujo maker-checker, cumplimiento (Ley 1581) y el modelo de saldo prepago (Wompi/transferencia).
- **IP de envío dedicada:** el rol la reconoce como oferta real para clientes de alto volumen,
  mencionable si preguntan, pero **sin detalles técnicos** de implementación y **sin prometer**
  que por sí sola resuelve entregabilidad — remite a cotización con el equipo comercial. Framing
  deliberado: existe, pero no es autoservicio ni un dato para exponer en detalle a un público
  no autenticado.
- **Guardrails explícitos (qué NO debe hacer), en el prompt en este orden:** (1) nunca inventar/
  confirmar saldo, campañas o datos de una cuenta real; (2) no responder fuera de MailConnect/
  comunicaciones, admitir cuando no sabe; (3) no revelar infraestructura/arquitectura/paneles
  internos; (4) no garantizar entregabilidad ni prometer plazos/descuentos/cifras exactas; (5) no
  procesar pagos ni datos sensibles (contraseñas, tarjetas); (6) no dar asesoría legal/tributaria
  personalizada; (7) no denigrar competencia; (8) no hacerse pasar por una persona del equipo. El
  prompt también instruye **ignorar** cualquier intento del usuario de hacerle revelar el mensaje
  de sistema o "olvidar instrucciones anteriores" (resistencia básica a inyección de prompt).
- **Estilo:** español, breve (~4 frases salvo que pidan más detalle), **texto plano sin
  markdown** (el widget `LandingFloating` renderiza con `white-space: pre-wrap`, no interpreta
  `**negritas**` ni `#`).
- **Cobertura:** `test_assistant.py` fija por contenido que el rol siga cubriendo los 4 canales +
  cascada, el framing de IP dedicada, y cada guardrail (cuenta real, entregabilidad,
  infraestructura, anti-prompt-injection, datos sensibles/legal, estilo) ante ediciones futuras
  del prompt.
- **Tablas cebra + compactas:** las tablas de **Estadísticas** y **Campañas** pasan a `size="small"`
  (alto de fila como el de "Movimientos" en Saldos) y filas **cebra** (fondo alterno sutil) para
  separar cada campaña.
- **Saldo y recargas:** se quitó el botón **"Recargar"** del header (redundante con "Recargar con
  Wompi" / "Registrar transferencia" de la tarjeta de saldo). Queda solo "Refrescar".

### Ajustes de plantillas, tarifas y modal de campaña (jul 2026)
- **SMS/WSP: la plantilla se usa EN VIVO (no snapshot).** Antes, al crear una campaña SMS/WSP
  se copiaba el TEXTO de la plantilla en `campaign.template` (snapshot); si el cliente editaba
  luego la plantilla, la campaña seguía enviando el texto viejo. **Ahora la campaña guarda una
  REFERENCIA** `campaign.messageTemplateId` y `Prepare-batch` resuelve el `body` (SMS) / `hsmName`
  (WSP) **en vivo** desde la tabla `messageTemplate` al enviar (muestras y real) — igual que el
  email referencia la plantilla SES por nombre. Helper `resolve_live_message_content(id, customerId,
  channel)` (fail-safe: sin id / plantilla borrada / de otro tenant → `None` → cae al snapshot
  `campaign.template`). **Voz** no tiene plantilla referenciada (texto libre) → sigue por snapshot.
  - Contrato: `Campaign/Create-campaign` y `Campaign/Update` aceptan `messageTemplateId?`;
    `Campaign/List` lo devuelve. El front (`CampanasSection`) guarda la referencia al elegir la
    plantilla y muestra la vista previa con el contenido **vigente** (`smsPreview`/`wspPreview`).
  - ⚠️ `[J]`: `Api_V1_Email_Prepare-batch-template` necesita `dynamodb:GetItem` sobre
    `messageTemplate`. Sin el permiso NO rompe (fail-safe → usa el snapshot), pero no reflejaría
    ediciones. Cubierto por `08_Pruebas/PruebasSeguridad/test_message_template_live.py`.
- **Variables como fichas azules en el editor SMS** (`VariableTextEditor.tsx`): el texto del SMS
  pasa de un `<TextField multiline>` a un `contentEditable` controlado donde las variables
  `{{Columna}}` se pintan como **ficha azul NO editable**. Se insertan **en la posición del
  cursor** (no al final) y **Backspace/Delete pegado a la ficha la borra completa** (no carácter a
  carácter). El `value` sigue siendo texto plano con tokens `{{Columna}}` (el backend no cambia);
  el componente serializa (chips→`{{}}`) y parsea (`{{}}`→chips) internamente.
- **Tarifas por VOLUMEN visibles en el admin (fix "todo en 0"):** al pasar el precio base a
  escalonado por volumen (`baseX=None`), `TarifasSection` mostraba `?? 0` → todo en 0. Ahora los
  campos vacíos se ven **vacíos** con placeholder "Por volumen", cada tarjeta de canal muestra la
  **tabla de tramos** (COP/u por rango de envíos/mes que devuelve `Pricing/List` en `tiers`), y
  escribir un valor fija un **precio plano (override)**. `ChannelRates = Record<string, number|null>`.
- **Modal de crear/editar campaña:** más ancho (`maxWidth="lg"`) y **compacto en vertical**
  (spacing reducido). La nota superior solo explica el **Canal** (se quitó la guía de "Entrega del
  adjunto"). En **EAU/EAP** el selector "Entrega del adjunto" ya **no ofrece "Sin adjunto"** (solo
  `ONFILE`/`ONLINE`; el canal exige adjunto).
- **Plantillas PDF:** al guardar se pide el nombre en un **diálogo** (antes `window.prompt` feo);
  se quitaron el título "Plantillas PDF" y la descripción para **agrandar el lienzo** del editor.
- **Calculadora de precios** (`CalculadoraPrecios.xlsx`, raíz): reconstruida completa (11 hojas:
  Leyenda, Supuestos, EM/EAU/EAP/SMS/WhatsApp/Voz por tramos, Cotizador, "Adjunto URL vs archivo",
  Resumen). Tarifas calibradas con Mailpro, arrancando en **30 COP** (EM 1er tramo). Es la fuente
  de los `VOLUME_TIERS` embebidos en `Cost_Estimate`/`Pricing_List`/`Prepare-batch`/`Billing_Summary`.

### Ajustes de campañas, fechas y duplicados (jul 2026)
- **Lista de campañas tipo tabla:** `CampanasSection` reordena columnas a
  **Canal · Estado · Campaña · Consecutivo · Plantilla · Fecha · Acciones** (chip de canal
  outlined, estado con color, nombre en negrita).
- **Eliminar campaña:** botón papelera en la tabla + lambda `Api_V1_Campaign_Delete`
  (ruta `/Campaign/Delete`, verifica tenant, borra `campaign` + `document` best-effort, audita
  `campaign.delete`). Servicio `campaignsService.delete`.
- **Modal de confirmación del envío real** (`MuestrasSection`): al pulsar "Enviar campaña real"
  se abre un diálogo con **nº de envíos** (filas de la base asociada, por `dataPath`), **costo
  estimado exacto** (recalcula `Cost/Estimate` sobre ese nº), saldo antes/después y una
  **casilla de responsabilidad obligatoria**. Solo se llega desde un lote **aprobado** (que
  exige haber enviado muestras). Se quitó la nota técnica de endpoints del tab de muestras.
- **Formato de fecha unificado** `DD-MM-YYYY HH:MM:SS` (24h, día/mes con 2 dígitos): helper
  `src/utils/datetime.ts` (`formatDateTime`), aplicado en TODAS las tablas (campañas admin/
  portal, bases, auditoría, trabajos, saldos/ledger, clientes, lista negra, reportes). Las
  fechas de auditoría se normalizan a UTC (Z) antes de formatear (hora local).
- **Duplicados en bases:** nueva columna **Duplicados** en `BasesDatosSection` con tooltip que
  indica si el duplicado se detectó sobre el **correo** o el **celular** (según el `channel` de
  la base). `Database/List`/`Register-file` ya devolvían/guardaban `duplicates` y `channel`.
- **Permitir duplicados (checkbox):** al cargar una base, casilla **"Permitir duplicados"** que
  se guarda en `databaseFile.allowDuplicates` (`Register-file`). En el **envío real**,
  `Prepare-batch` deduplica por contacto (columna 2, `_contact_key`) **por defecto**; si la base
  tiene `allowDuplicates=true`, envía el total (mismo destinatario repetido). El cobro se
  dimensiona sobre contactos **distintos** cuando se deduplica (`count_base_rows` dedup-aware).
  Fail-safe: si no se resuelve la base, se deduplica.

### Dominios de envío propios del cliente (jul 2026)
- **Nueva pestaña "Dominios"** (`DominiosSection`, RBAC **owner**): el cliente registra su propio
  dominio (ej. `empresa.com`) para enviar desde `{cualquier}@empresa.com`. Backend
  `Api_V1_Domain_{Add,List,Delete}` (tabla `senderDomain`, PK `domainId` + GSI `customerId-index`).
  - `Add` pide a SES `verify_domain_identity` (TXT `_amazonses.{dominio}`) + `verify_domain_dkim`
    (3 CNAME `{t}._domainkey.{dominio}` → `{t}.dkim.amazonses.com`) y **devuelve los registros DNS**
    para que el cliente los publique. Estado inicial `pending`.
  - `List` refresca el estado desde SES (`get_identity_verification_attributes`) →
    `pending|verified|failed` y lo persiste. La UI muestra los registros con botones de copiar.
  - `Delete` borra el registro + `delete_identity` (best-effort). ⚠️ Las identidades SES son a
    **nivel de cuenta AWS**; la tabla guarda **qué cliente** es dueño de cada dominio.
- **Correos como remitente (además de dominios) (jul 2026):** en la misma pestaña y tabla el
  cliente puede verificar **un correo específico** (ej. `ventas@empresa.com`) en vez del dominio
  completo. SES soporta las dos identidades y esta feature usa **la misma** tabla `senderDomain`
  con un campo **`kind`** (`domain` | `email`); el valor (dominio o correo) se guarda en el campo
  `domain` (sin cambiar el esquema ni los lectores). `Domain_Add` **detecta el tipo por el `@`**:
  - **Correo** → `ses.verify_email_identity` (SES manda un **correo con un enlace** a esa dirección;
    el dueño hace clic → verificado, **sin DNS**). Se guarda `records:[]`, estado `pending`. Si el
    correo pendiente ya existe, **reenvía** la verificación (200) en vez de duplicar (409); si ya
    está verificado → 409. La UI muestra un **paso a paso** (revisar bandeja/spam, clic en “Verify
    this email address”, el enlace vence en **24 h**, botón **Reenviar**) en vez de la tabla DNS.
  - **Dominio** → igual que antes (TXT + 3 CNAME DKIM). `Domain_List` refresca ambos por SES
    (`get_identity_verification_attributes` sirve para dominio y correo) y devuelve `kind`.
- **Remitente = nombre del correo + dominio, o correo verificado completo:** el "De (From)" de
  crear campaña tiene un texto **"Nombre del correo"** (`comunicaciones`, `avisos`…) + un selector
  **"Dominio o correo"** con `mailconnect.com.co` (plataforma), los **dominios verificados** y un
  grupo **"Correos verificados"**. Al elegir un correo verificado, `from` = esa dirección exacta y
  el campo "Nombre del correo" se **deshabilita** (identidad fija). `DEFAULT_FROM =
  notificaciones@mailconnect.com.co`.
- **Validación anti-spoofing:** `Create-campaign._from_allowed` valida (solo email, **fail-open**
  de rollout) que el `from` sea el dominio de la plataforma, un **dominio verificado** del cliente,
  **o un correo verificado exacto** del cliente (`senderDomain` por `customerId`), para que un
  tenant no envíe a nombre de otro.
- ⚠️ `[J]` ✅ (desplegado): la verificación SES debe estar en la **misma región del envío** (`us-east-1`); permisos
  `ses:VerifyDomainIdentity/VerifyDomainDkim/VerifyEmailIdentity/GetIdentityVerificationAttributes/GetIdentityDkimAttributes/DeleteIdentity`
  en las lambdas de dominio; tabla `senderDomain` (+ GSI) con el campo `kind` — la crea `Domain/Add`
  on-demand; rutas `/Domain/{Add,List,Delete}` (authorizer + CORS); permiso `Query senderDomain`
  (GSI) en `Create-campaign`.

### Remitente, plantilla del payload y mínimo de recarga (jul 2026)
- **Remitente por defecto `notificaciones@mailconnect.com.co`:** el campo "De (From)" de crear
  campaña pasa de texto libre a **desplegable** (`DEFAULT_FROM` en `CampanasSection`); por ahora
  solo esa opción (+ ítem deshabilitado "Tu dominio propio (próximamente)"). Al editar conserva
  el remitente previo si difiere. ⚠️ `[J]` ✅ (desplegado): `notificaciones@mailconnect.com.co` debe estar
  **verificado en SES** como identidad de envío. Futuro: dominios verificados por cliente.
- **Plantilla SES del payload (no recalculada):** `Prepare-batch` usa `campaign.template` (la
  plantilla que el cliente eligió al crear la campaña) como `st.template_name` para los canales
  de email (EM/EAU/EAP), en vez de reconstruir `{customer}_{consecutivo}_{campaña}`. Fallback a la
  convención si la campaña no trae `template` (compat). Así el envío usa exactamente la plantilla
  seleccionada.
- **Mínimo de recarga Wompi visible:** `RechargeDialog` avisa explícitamente cuando el monto es
  `>0` y `< MIN_TOPUP` (20.000 COP) con un `Alert` + helperText en error (antes el botón solo se
  deshabilitaba sin explicar). Sugiere "Registrar transferencia" (manual, sin mínimo) para montos
  menores. El backend `Topup-init` ya devolvía el 400 con el mensaje del mínimo.

### Idempotencia atómica de los workers de envío (anti-duplicado) (jul 2026)
- **Problema:** la garantía anti-duplicado del pipeline dependía de que cada worker de envío
  deduplicara por `(processId, part)`, pero en la práctica NO se cumplía: **SMS/Voz/WhatsApp/EAU
  no tenían guarda** (una redelivery de SQS reenviaba todo el lote — y en los telefónicos eso
  cuesta dinero real y llama/escribe a una persona), **EM/EAP y los combinadores** usaban un
  `scan` + `put` con **uuid ALEATORIO** que NO es atómico (dos entregas concurrentes pasaban ambas
  la validación → doble envío) y a escala el `scan` de 1 página de 1 MB ni encontraba la fila.
  **Send-EAP** tenía la guarda en CÓDIGO MUERTO (chequeaba un estado que la escritura comentada
  nunca producía).
- **Fix — claim ATÓMICO por etapa:** los 6 workers de envío (`Send-EM/EAU/EAP`, `Sms/Wsp/Voice_
  Send-batch`) y los 2 combinadores (`Template_Combination` DOCX, `Template_Combination-EAP-PDF`)
  usan ahora `_claim_part(tenant, processId, part, ..., stage)`: una escritura **condicional
  `attribute_not_exists`** sobre la clave **DETERMINISTA** `processId#part#stage` en
  `{tenant}_processDetail`. Solo la PRIMERA entrega gana (envía); la redelivery pierde la condición
  y se OMITE. `stage` separa `combine` (combinador) de `send` (worker), que comparten
  `(processId, part)` en la misma tabla. Reemplaza el patrón `scan`+`put(uuid)`. Fail-open solo si
  falta la llave de tenant/proceso (mensaje viejo en vuelo). El helper está **copiado** en cada
  lambda (convención del repo, sin imports compartidos).
- **Fix del combinador DOCX (mis-tenanting):** `Template_Combination` PERDÍA `nit`/`samples`/
  `documentFormat` al re-emitir a `Send-EAP` → Send-EAP corría con `tenant=''` (escribía en la
  tabla equivocada) y no contaba muestras ni distinguía el formato. Ahora los **preserva** en la
  re-emisión (el combinador PDF ya lo hacía).
- **Checkpoint INTRA-PARTE (reanudación) en EM/EAU:** un `part` del canal trae hasta 250
  destinatarios que EM envía en chunks de `QUANTITY_BATCH` (50; EAU 25) → varios `send_bulk`. Si
  uno fallaba a mitad, antes se marcaba TODA la parte en Error y se bloqueaba → los chunks
  siguientes se **perdían** y un reintento reenviaba desde cero. Ahora `Send-EM`/`Send-EAU` reclaman
  **por CHUNK** (`_claim_part` con `stage='send#{offset}'`): si el chunk ya salió, se OMITE; si su
  `send_bulk` falla (SES no entregó nada), se **libera** el claim (`_release_part` = delete) y se
  re-lanza → la redelivery de SQS **reanuda EXACTAMENTE desde ese chunk**, sin reenviar los ya
  enviados ni perder los pendientes. La reanudación es **automática por SQS** (no necesita
  `Admin_Requeue`, que opera al nivel de `procesar_parte`/`processedParts`). El resto de canales
  (SMS/Voz/WhatsApp/EAP) procesa el `part` como unidad → conserva el claim a nivel de parte
  (`stage='send'`). Muestras: el conteo se gatea con `any_sent` para no recontar en una redelivery
  donde todos los chunks ya estaban enviados.
- **Cobertura:** `08_Pruebas/PruebasSeguridad/test_idempotencia_envio.py` (claim atómico en los 6
  workers + dedup a nivel handler de SMS/Voz/WhatsApp + reanudación por chunk en EM: falla el 2º
  chunk y reanuda sin reenviar el 1º). Suite completo en verde. Los mensajes al canal SIEMPRE
  llevan `part` único en el proceso (`prepare_message`, `part_offset = part*PART_SIZE`).
  ⚠️ Pendiente relacionado (no en esta tanda): **DLQ** en las colas creadas por el CD (hoy solo en
  Terraform); sin DLQ, un chunk con error PERSISTENTE se reintenta hasta agotar la retención. EAP
  sigue tragando los fallos por-destinatario (pérdida silenciosa, otro pendiente).

### Ajustes operativos de envío y UX (jul 2026)
- **Fix `ResourceNotFoundException` en el primer envío:** `Prepare-batch` ahora ESPERA a que
  las tablas por cliente (`{tenant}_processDetail/_sendDetail/_sendStatus/_unsubscribe/_blackList`)
  estén **ACTIVE** antes de encolar (`wait_tables_active`, waiter `table_exists`). Sin esto, el
  worker (`Send-*`) leía una tabla recién creada en estado CREATING y fallaba.
- **Contador de muestras SOLO si el envío sale bien:** se quitó el `increment_samples_count` de
  `Prepare-batch/preparar_muestras`; ahora las lambdas de **envío** (`Send-EM/EAU/EAP`, `Sms/Wsp/
  Voice Send-batch`) cuentan `campaign.samplesSentCount` **al terminar OK**. El mensaje SQS lleva
  `samples: true` (`build_ctx` + `st.is_samples`) para que el worker sepa contarlo. Idempotente
  por la deduplicación de parte (una redelivery no recuenta). Una muestra que se prepara pero no
  se entrega ya no consume cupo.
- **Nombre de plantilla SES sin canal:** el template SES pasa de
  `{customer}_{consecutivo}_{canal}_{nombre}` a `{customer}_{consecutivo}_{nombre}` (una plantilla
  HTML aplica a varios canales de email EM/EAU/EAP). Cambia en `Template_Create-template` (creación)
  y en `Prepare-batch` (lookup `st.template_name`) de forma consistente.
- **Desplegables de campaña tipo tabla:** helper `campaignOption.tsx` (`CampaignOption` +
  `campaignOptionText`) → los selectores de Muestras y Reportes muestran **[Canal] [Estado] Nombre**
  alineado en columnas.
- **Comprobante de transferencia en modal:** la bandeja admin de recargas (`SaldosSection`) ve el
  comprobante en un **modal** (iframe, imagen/PDF) sin salir de la pestaña (+ enlace "abrir en
  pestaña nueva").
- **Orden de tabs del portal:** **Bases de datos** primero · separador · **Plantillas** (HTML/DOCX/
  **PDF**/SMS/WhatsApp) · separador · **Campañas** · **Programar envíos** · Muestras · el resto
  (`PortalSidebar`, con `dividerAfter`).
- **Plantillas PDF (jul 2026, EDITOR TIPO WORD):** **Plantillas PDF** (`PdfTemplatesSection`) es un
  **editor de documento tipo Word** (WYSIWYG). Usa un `contentEditable` + `document.execCommand`
  (sin librerías extra): barra de formato **arriba** (bloque Normal/Título/Cita, fuente, tamaño,
  negrita/cursiva/subrayado, color, alineación, listas, enlace, quitar formato, deshacer/rehacer),
  **herramientas a la izquierda** (insertar **Imagen** →S3 `resources`, **Variable** `{{campo}}`,
  **Tabla**, y selector de hoja **A4/Carta**) y un **lienzo con reglas** en cm (`HRuler`/`VRuler`)
  que dibuja la hoja blanca centrada. **Borradores** en localStorage (`mc_pdf_drafts`: Guardar/
  Cargar por nombre), **Ver HTML** (diálogo + copiar) y **Descargar** (.html).
- **Generador de PDF conectado al editor (jul 2026):** el editor "habla" con el backend que
  RENDERIZA el PDF. **Botón "Vista previa PDF"** (`PdfTemplatesSection`) → `pdfTemplatesService.render`
  → `POST /Template/Render-pdf` (lambda **`Api_V1_Template_Render-pdf`**): toma el HTML del editor +
  **valores de muestra** de las `{{variables}}` detectadas y devuelve el PDF real (base64) que se
  muestra en un diálogo con `<iframe>` + descargar. La lambda envuelve el HTML en una hoja (A4/Carta),
  sustituye `{{campo}}` y renderiza con **xhtml2pdf** (`html_to_pdf`); `store=true` lo sube a S3
  (`attachment/pdf-preview/…`) en vez de base64.
- **Envío real EAP-PDF (jul 2026):** el hook ya existía stubbeado — `Prepare-batch` enruta `EAP` con
  `documentFormat=PDF` a la cola **`Template_Combination-EAP-PDF`**, cuyo consumidor es la nueva
  lambda **`Api_V1_Template_Combination-EAP-PDF`** (análoga al combinador DOCX): baja el HTML de la
  plantilla (del `documentPath` del registro `document` de la campaña), por cada destinatario sustituye
  `{{campo}}` con su fila del CSV, **renderiza el PDF** (mismo `html_to_pdf`), lo sube al prefijo
  **PRIVADO** `personalized/{campaignId}/{nombre}.pdf` (ver "Personalizados privados" abajo) y
  **re-emite a `Email_Send-batch-raw-EAP` preservando `nit`
  + `samples` + `documentFormat`** (el combinador DOCX los pierde — bug latente que este NO copia).
  **`Send-batch-template-EAP`** ahora usa `.pdf` (subtype `application/pdf`) cuando el mensaje trae
  `documentFormat=PDF`; la ruta DOCX queda intacta. El render es idéntico en ambas lambdas (copiado,
  sin imports compartidos, como `tenant_key`). Cubierto por `08_Pruebas/PruebasSeguridad/test_render_pdf.py`
  y `test_combination_eap_pdf.py`.
  - ⚠️ `[J]` (despliegue): crear la función `Api_V1_Template_Render-pdf` + ruta `/Template/Render-pdf`
    (authorizer + CORS); crear la función `Api_V1_Template_Combination-EAP-PDF` + la cola SQS
    `Template_Combination-EAP-PDF` + trigger; **layer con `xhtml2pdf` (+ reportlab, Pillow)** en ambas
    (como PyJWT en los Authorizers); IAM: S3 `GetObject/PutObject` (bucket del cliente), DynamoDB
    `Scan document`/`Scan+PutItem {tenant}_processDetail` y `GetItem messageTemplate` (Render-pdf),
    SQS `SendMessage` a `Email_Send-batch-raw-EAP` (combiner).
- **Plantillas PDF PERSISTIDAS en backend (jul 2026):** las plantillas del editor ya no viven solo
  en localStorage — se guardan en la tabla **`messageTemplate` con `channel=PDF`** (campo `html`),
  así se **comparten** entre usuarios/equipos. `MessageTemplate_Create` acepta `PDF` (exige `html`);
  `List` las devuelve (canal `PDF`); la lambda `Render-pdf` puede leerlas por `messageTemplateId`.
  El editor (`PdfTemplatesSection`): **Guardar** → `messageTemplatesService.create({channel:'PDF',
  name, html})` (+ espejo en localStorage como respaldo/offline); **Cargar** → lista del backend
  (`list(customerId,'PDF')`) y carga el `html`. El portal ya precarga `messageTemplate` (todos los
  canales) en `PortalDataContext`, así que aparecen sin recargar.
- **Form de campaña cableado a la plantilla del editor (jul 2026):** al crear una campaña **EAP**
  con **Tipo de documento = PDF**, `CampanasSection` ya no sube un `.pdf` estático: muestra un
  **selector de plantillas PDF** = las del **backend** (canal PDF, `c:{id}`) + borradores locales de
  respaldo (`l:{name}`). Al elegir una, sube su **HTML** a S3 (`documentType=attachment`, como
  `.html`) y usa esa ruta como `attachment:[{path}]` + `documentFormat:'PDF'`. Create-campaign guarda
  el `document.documentPath` (ese HTML) y el combinador EAP-PDF lo baja y renderiza por destinatario.
  EAU y EAP-DOCX siguen con la subida de archivo de siempre. Con esto el flujo EAP-PDF queda **de
  punta a punta** en el front (falta solo el despliegue `[J]` de abajo).
- **Programar envíos (jul 2026, FUNCIONAL — HORA EXACTA):** `ProgramarEnviosSection` (tab junto a
  Campañas, RBAC **owner/approver**) permite **agendar el envío real** de una campaña aprobada a una
  fecha/hora futura. Backend: tabla **`scheduledSend`** (PK `scheduleId` + GSI `customerId-index`).
  - **Disparo por HORA EXACTA (EventBridge Scheduler one-shot):** `Api_V1_Schedule_Create` valida
    (tenant, RBAC owner/approver, fecha futura, campaña aprobable) y crea (a) la fila `pending` con
    todo el contexto para refirir y (b) un **schedule de una sola vez** `at(fecha exacta UTC)`
    (`FlexibleTimeWindow OFF`, `ActionAfterCompletion DELETE`) cuyo target es **`Api_V1_Schedule_Fire`**
    con `Input={scheduleId}`. Si `create_schedule` falla → **rollback** de la fila (no queda un
    `pending` que nunca dispara). El nombre del schedule = `mc-send-{scheduleId}`.
  - **`Api_V1_Schedule_Fire`** (target, sin ruta): a la hora exacta EventBridge lo invoca; carga esa
    fila, la **reclama** (`pending→firing`, condicional/idempotente) e **invoca Prepare-batch** con el
    MISMO evento del envío on-demand (`/Email/Send-batch-template` + context) → reutiliza TODOS los
    gates (aprobación, saldo, RBAC, lock). Marca `sent`/`failed`. El schedule se autoelimina.
  - **`Api_V1_Schedule_Cancel`:** `pending→canceled` (atómico) + **`delete_schedule`** del one-shot.
    **`Api_V1_Schedule_List`:** los del tenant (GSI). El front convierte `datetime-local`→UTC ISO.
  - **`Api_V1_Schedule_Dispatch`** queda como **barrido de respaldo OPCIONAL** (cron de baja
    frecuencia): recoge `pending` vencidos cuyo one-shot no disparó. La reclamación + el lock de
    Prepare-batch evitan doble envío aunque coincida con el Fire. Estados:
    `pending|firing|sent|canceled|failed`. Cubierto por `08_Pruebas/PruebasSeguridad/test_schedule.py`.

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
- **Validación de contacto por canal + E.164 (fix jul 2026):** `Prepare-batch` validaba el
  contacto (col 2) **siempre como correo**, tanto en **muestras** (`preparar_muestras`) como en
  el **envío real** (`procesar_parte`). Para SMS/WSP/VOZ eso rechazaba el celular: las muestras
  daban 400 *"emails con error: 3502…"* y el envío real mandaba **todos** los contactos a estado
  11 (email inválido) sin encolar nada. Ahora `valid_contact(st.channel, contacto)` valida
  **por canal** (correo para EM/EAU/EAP · celular para SMS/WSP/VOZ) y **`normalize_phone`**
  convierte los celulares a **E.164** (Colombia `+57` por defecto, igual que el front con
  libphonenumber) antes de encolar — las lambdas de envío (SMS/Voz `DestinationPhoneNumber`,
  WhatsApp `to`) EXIGEN E.164. El canal viaja en `build_ctx` (`channel`) → mensajes de muestra
  y part-jobs. `_contact_key` (dedup/cobro) también normaliza el celular. Cubierto por
  `08_Pruebas/PruebasSeguridad/test_sms_channel.py`.
- **Front:** el form de campaña (`CampanasSection`) tiene el canal **SMS** con campo de texto
  (contador de segmentos) en vez del selector de plantilla SES.
- ⚠️ `[J]` ✅ (desplegado): crear la cola `Sms_Send-batch` + trigger, y configurar origen en End User Messaging.

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
- ⚠️ `[J]` ✅ (desplegado): crear la cola `Wsp_Send-batch` + trigger, registrar el número/WABA en End User
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
- ⚠️ `[J]` ✅ (desplegado): crear la cola `Voice_Send-batch` + trigger y habilitar el origen de voz en End User
  Messaging (número con capacidad de voz).

### Registro por NIT + equipo del cliente (jul 2026, SEGURIDAD)
> **Bug crítico corregido:** antes `Register` **reutilizaba el `customerId`** si el NIT ya existía
> (`if exist_companyTin: customerId = get_customerId(...)`). Como **todo el aislamiento multi-tenant
> es por `customerId`/`nit` del token**, cualquiera que conociera el NIT de una empresa (semi-público)
> se registraba con un correo nuevo y quedaba **dentro de ese tenant como `owner`**: veía campañas,
> saldo, bases, plantillas y podía **enviar a nombre de la empresa gastando su saldo**. El flag
> `realSendEnabled` no protegía (la víctima activa ya lo tenía en `true` y el intruso heredaba el
> mismo `customerId`).
- **Fix:** `Register` ahora **rechaza (409)** el auto-registro bajo un NIT ya registrado
  (`CompanyAlreadyRegistered`). Un NIT = una empresa = un solo auto-registro (el que registra queda
  `owner`). Cubierto por `test_seguridad.py::test_registro_nit_existente_409`.
- **Equipo del cliente (provisioning por el dueño):** el `owner` suma usuarios de SU empresa desde el
  portal — lambdas `Api_V1_User_{Create,List,Delete}` (rutas cliente, **owner-only** por `tenantRole`):
  - `Create`: crea el usuario con `tenantRole` **operator** (funcional: prepara/prueba) o **approver**
    (aprueba/envía), **tope `MAX_TEAM_USERS`=2** (sin contar al owner), correo único. Queda **activo**
    pero con contraseña **no usable** (hash aleatorio + `mustSetPassword`): define su clave con
    "¿Olvidaste tu contraseña?" (OTP) → el front dispara ese correo tras crearlo (reutiliza el flujo
    de recuperación; el dueño nunca maneja contraseñas ajenas).
  - `List`: usuarios del tenant (+ `max`/`canAdd`). `Delete`: borra un usuario del tenant (no un owner
    ni a sí mismo). Auditado (`user.create`/`user.delete`). Cubierto por `test_user_team.py` (10).
  - **Front:** tab **"Usuarios"** (`UsuariosSection`, solo owner) — tabla del equipo + agregar (rol +
    tope) + eliminar + reenviar el correo de "definir contraseña". `usersService.ts`. `RegisterPage`
    muestra el 409 "empresa ya registrada".
  - ⚠️ `[J]`: desplegar `Api_V1_User_{Create,List,Delete}` (crear vacías) + rutas `/User/{Create,List,
    Delete}` (authorizer + CORS + mapping template con `customerId`/`nit`/`userId`/**`tenantRole`**).
    IAM: `Scan/GetItem/PutItem/DeleteItem` sobre `user`/`userData`, `PutItem` sobre `adminAudit`.
    Env `MAX_TEAM_USERS` (default 2). Estas rutas NO son admin (son del owner del tenant).

### Roles (admin/client) (jul 2026)
- **Modelo:** dos roles — **`admin`** (personal interno de MailConnect: gestiona clientes,
  tarifas, config global) y **`client`** (default, usuario de una empresa). Dentro de un cliente
  hay **sub-roles** (`tenantRole`): **owner** (dueño; suma usuarios, gestiona saldo, todo),
  **approver** (aprueba/envía real), **operator** (prepara/prueba).
- **Backend:** campo `role` en la tabla `user` (default `client` en `Register`). `Login` lo
  embebe en el JWT y lo devuelve en `data.role`; `Authorizer`/`Authorizer2` lo reenvían en el
  context (`event.requestContext.authorizer.role`); `Refresh-token` lo preserva. Los endpoints
  **admin** (`Customer_List`, `Customer_Update`) exigen `role=admin` (403 si no).
- **Front:** la sesión guarda `role`; `isAdmin(user)` en `authService`. `RequireAuth requireAdmin`
  protege `/admin` (un `client` autenticado se redirige a `/panel`).
- **Provisión de admins:** `Register` siempre crea `client`. Un admin se crea cambiando el campo
  `role` a `admin` en la tabla `user` (consola/script). ⚠️ `[J]` ✅ (desplegado): promover el/los usuarios admin.
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
- ✅ **WhatsApp (jul 2026):** los recibos de entrega/lectura vienen de **Meta** (formato
  distinto, vía la SNS de `socialmessaging`) y **solo traen el messageId**, sin nuestro
  context. Por eso `Api_V1_Wsp_Send-batch` guarda un índice global **`messageIndex`** (PK
  `messageId` → `{customer, processId, uniqueId}`) y la nueva lambda
  **`Api_V1_Wsp_ReceptionStatus`** (suscrita a la SNS de WhatsApp) lo consulta para ubicar
  el cliente/proceso y escribir el estado (`sent`→1, `delivered`→2, `read`→4, `failed`→3) en
  `{customer}_sendStatus` (+ `bump_send_summary`). Estadísticas de WhatsApp ahora reflejan
  entrega/lectura, no solo envío.
- ⚠️ `[J]` ✅ (desplegado): crear los **configuration sets** de SMS y Voz con **event destination → SNS**, y
  suscribir `Api_V1_Messaging_ReceptionStatus` a esa SNS. Env `SMS_CONFIGURATION_SET` /
  `VOICE_CONFIGURATION_SET` en los envíos para que emitan eventos.

### Límite de muestras y bloqueo de envíos por cliente (jul 2026)
- **Límite de muestras (5 por campaña):** cada operación de `Send-batch-template-samples`
  cuenta 1 en `campaign.samplesSentCount` (contador atómico); al llegar a `MAX_SAMPLE_SENDS`
  (5) Prepare-batch bloquea (429). `Create-campaign` inicializa el contador y `Campaign/List`
  lo devuelve. Front (`MuestrasSection`): chip "usados/quedan" y botón deshabilitado al límite.
- **Muestras EXCLUIDAS de reportes/estadísticas/facturación (jul 2026):** como en el resto del
  mercado (Mailchimp/HubSpot/SendGrid…), las **pruebas no cuentan** en las métricas de la
  campaña ni en el consumo. `insert_process` marca el proceso de muestra con **`isSamples=true`**
  (`st.is_samples` ya es True en `preparar_muestras`, False en el envío real). Los agregados
  **saltan** los procesos de muestra con `_is_sample_process(p)` (marca `isSamples`, o *fallback*
  `processState=='Muestras'` / nombre `-Samples` para procesos viejos): `Api_V1_Reports_Statistics`,
  `Api_V1_Admin_Dashboard` (KPIs, embudo **y reputación** rebote/queja), `Api_V1_Billing_Summary`
  (coherente: el monedero **no cobra** muestras) y `Api_V1_Agent_Reports`. Las muestras SÍ siguen
  visibles, separadas, en el **tab Muestras** (`samplesSentCount` + `campaign.sampleBatches`), en
  **Admin/Jobs** (procesos `processState='Muestras'`) y en el **reporte por proceso** (state-report,
  bajo demanda). El filtro es a **nivel de proceso** → no cambia `sendStatus`/`sendSummary`.
  Cubierto por `08_Pruebas/PruebasSeguridad/test_sample_exclusion.py`.
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
  - **Eliminar cliente (jul 2026):** botón papelera por fila + `Api_V1_Customer_Delete`
    (`/Customer/Delete`, admin). Borra `customer` + sus `user`/`userData` (best-effort → sin
    logins huérfanos); **no** purga el histórico (campañas/envíos/saldo se conservan). Guard: un
    admin **no** puede borrar su **propia empresa** (evita auto-bloqueo). Audita `customer.delete`.
    Servicio `customerService.delete`. ⚠️ `[J]` (nuevo): desplegar `Api_V1_Customer_Delete` + ruta
    `/Customer/Delete` (authorizer admin + CORS + mapping template de `role`/`customerId`) +
    permisos `dynamodb:GetItem/DeleteItem/Scan` sobre `customer`/`user`/`userData` y `PutItem`
    sobre `adminAudit`.
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

### Cobro PREPAGO / monedero (jul 2026)
- **Modelo:** saldo por cliente en **COP** en la tabla `customerBalance` (PK `customerId`).
  **Todo** movimiento de dinero deja un registro en el **ledger auditable** `walletTransaction`
  (PK `txId` + GSI `customerId-createdAt-index` para el historial; `type` ∈
  `topup_manual|topup_wompi|debit_send|refund_send|adjustment`, `amount` firmado, `balanceAfter`,
  `status` (`pending|approved|declined`), `reference`, `bank`, `proofS3Path`, `rejectReason`,
  `reviewedBy`, `processId/campaignId`, `actor`, `detail`, `createdAt`). Las operaciones de saldo
  son **atómicas y condicionales** (UpdateItem con ADD / ConditionExpression / TransactWriteItems),
  nunca leer-modificar-escribir.
- **Débito en el envío real** (`Prepare-batch`, rama `preparar_split`): orden **gate manual
  (realSendEnabled) → lock (`try_start_real_send`) → reserva de saldo → troceo**. La reserva
  (`reserve_balance`) debita con `ConditionExpression balance >= costo` (**bloqueo DURO**, sin
  cupo negativo); si no alcanza, **libera el lock** (la campaña vuelve a su estado previo) y
  lanza `InsufficientBalance` → el handler responde **402**. Si el troceo falla **tras** debitar,
  se **reembolsa** (`refund_balance`, compensación). **Las muestras NO cobran.**
  - **Base de cobro:** reserva sobre el **tamaño de la base** (`count_base_rows`, filas del CSV).
    La conciliación fina de fallidos/filtrados queda para una fase posterior.
  - **Costo:** misma fórmula/tarifas que `Api_V1_Cost_Estimate` (helper `_campaign_cost`
    replicado como en `Billing_Summary`). El débito es `debit_send`; el reembolso `refund_send`; el
    proceso guarda `chargedAmount`. ⚠️ **Sincronía:** si cambian `DEFAULT_RATES`/fórmula en
    Cost_Estimate, replicar en Prepare-batch/Billing/Pricing. No incluye recargo por MB de adjunto
    (igual que Billing) → el estimador del front es ≥ al débito (el gate de saldo nunca queda corto).
  - **Idempotencia:** el débito va **después** del lock; un reintento que choca con `AlreadySending`
    nunca vuelve a cobrar. **Fail-open de rollout:** si `customerBalance` aún no existe, no cobra
    (los envíos siguen); una vez creada la tabla, el bloqueo es duro.
- **Recarga MANUAL (comprobante + aprobación):** el cliente sube el comprobante a S3 (get-urlS3,
  documentType=document) y crea la solicitud con `Api_V1_Balance_Topup-manual-request` → queda
  `pending` (NO toca el saldo). El admin la revisa en `Api_V1_Admin_Topups` (con URL prefirmada del
  comprobante) y decide: `Api_V1_Admin_Topup-approve` (`pending→approved` + acredita en un
  `TransactWriteItems` atómico e idempotente) o `Api_V1_Admin_Topup-reject` (`pending→declined` +
  motivo, sin tocar el saldo). Auditado (`balance.topup.approve/reject`).
- **Ajuste directo (admin):** `Api_V1_Balance_Topup-manual` acredita saldo **directo** (tipo
  `adjustment`) para correcciones/cortesías, sin pasar por la bandeja de aprobación.
- **Consultas:** `Api_V1_Balance_Get` (cliente: saldo + historial por GSI, tenant del token) y
  `Api_V1_Admin_Balances` (admin: saldos de todos, menor primero + ledger global). El saldo se
  precarga junto al resto del portal (`PortalDataProvider`).
- **Front:** portal → sección **Saldo/Recargas** (saldo + historial + **Recargar con Wompi** +
  **Registrar transferencia** con comprobante) y aviso de **saldo insuficiente** junto al
  `CostEstimate` (deshabilita "Enviar campaña real" si saldo < costo). Admin → sección **Saldos**
  (**bandeja de solicitudes** con ver-comprobante/Aprobar/Rechazar + saldos + ajuste directo + ledger).
- **Recarga WOMPI (Fase 2):** `Api_V1_Balance_Topup-init` firma la integridad y crea el intento
  `pending`; `Api_V1_Wallet_Wompi-webhook` (público/proxy, sin authorizer) verifica la firma del
  evento y acredita **idempotente** por `reference` (condición `pending→approved`, con
  `TransactWriteItems`: marca la txn + suma el saldo en una sola operación atómica). **Nunca** se
  acredita desde el redirect del navegador. Llaves Wompi por env var
  (`WOMPI_PUBLIC_KEY`/`WOMPI_PRIVATE_KEY`/`WOMPI_INTEGRITY_SECRET`/`WOMPI_EVENTS_SECRET`;
  pendiente moverlas a Secrets Manager). Montos sugeridos 50/100/200 mil, mínimo 20.000 COP.

### Plantillas multicanal: SMS / DOCX / WhatsApp (jul 2026)
- Las plantillas de **correo HTML** siguen en **SES** (`Template/Create-template`, `Template/List`).
  Los otros 3 canales usan una tabla nueva **`messageTemplate`** (PK `messageTemplateId`) y las
  lambdas `Api_V1_MessageTemplate_{Create,List,Delete}` (multi-tenant: `customerId` del context).
- **Modelo por canal** (campo `channel` = `SMS|WSP|DOCX`):
  - **SMS:** `name` + `body` (texto con `{{variables}}`).
  - **WSP:** `name` + `hsmName` (plantilla HSM de Meta) + `language` (default `es`) + `params`
    (etiquetas de `{{1}},{{2}}…`). El contenido real vive en Meta; aquí solo el mapeo.
  - **DOCX:** `name` + `s3Path` (.docx subido a S3 con `get-urlS3` documentType=document) +
    `params` (campos de combinación, **opcional/legado**). La combinación real la hace el backend
    al enviar (EAP). ⚠️ **`params` NO se usa en la combinación:** `Template_Combination` reemplaza
    `{{header}}` recorriendo los **encabezados del CSV** (`key = '{{' + headers[i] + '}}'`), no la
    lista `params`. Por eso el selector "Campos de combinación" se **quitó del portal**
    (`DocxTemplatesSection`, jul 2026): confundía (parecía que definía el merge). El cuadro azul
    ahora indica escribir los datos variables como `{{campo}}` con el **nombre exacto de la columna**
    de la base. El campo `params` se conserva en el esquema para plantillas viejas.
- **Gotcha `_get_payload` en Create:** el canal SMS trae un campo `body` que **colisiona** con
  la convención Lambda-proxy (`event['body']`=JSON string). El helper solo trata `event['body']`
  como proxy si **parsea a un dict**; si es texto plano (SMS), `event` ES el payload.
- **Front:** services `messageTemplatesService.ts`; secciones del portal **Plantillas SMS**,
  **Plantillas WhatsApp** (componente genérico `MessageTemplatesSection`) y **Plantillas DOCX**
  (`DocxTemplatesSection`, sube el .docx y registra la metadata) — reemplazan el placeholder PDF.
  Al crear campaña SMS/WSP hay un selector "Usar plantilla guardada" que prellena el campo.

### Bases de datos: vista previa persistente + fix de carga Excel (jul 2026)
- **Vista previa persistente ("ver detalle"):** al registrar una base, el front envía
  **`previewRows`** (las primeras 5 filas de datos) junto a `columns` (encabezados);
  `Database/Register-file` las guarda (acotadas: máx. 5 filas × 40 cols, celdas a 500 chars) y
  `Database/List` las devuelve. Así "ver detalle" muestra **encabezado + primeras filas** aunque
  la base NO se haya cargado en esta sesión (antes la vista previa solo existía en memoria de la
  sesión). Bases viejas sin `previewRows` muestran solo las columnas (o el aviso). Cubierto por
  `test_database.py`.
- **Fix carga de Excel (.xlsx):** `read-excel-file` v9 devuelve `[{sheet, data:[[...]]}]` (array
  de hojas), NO un array plano de filas; `readSpreadsheet` (`csv.ts`) asumía filas planas → el
  `.map` producía filas vacías → "faltan las columnas obligatorias" al subir cualquier Excel.
  Ahora `readSpreadsheet` soporta ambas formas y toma la 1ª hoja. (Reproducido y verificado con
  la lib real.)

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

### Bucket ÚNICO por cliente con prefijos (jul 2026)
> **Antes:** un bucket S3 por cliente **y por tipo** (`mailconnect-{nit}-database`,
> `mailconnect-{nit}-document`). **Ahora:** UN SOLO bucket por cliente `mailconnect-{tenant_key(nit)}`
> con los **tipos como PREFIJOS de la key** (no buckets separados):
> - `database/` — bases (CSV) de los envíos. **Privado.**
> - `document/` — archivos del cliente (comprobantes de transferencia). **Privado** (se ve con
>   URL prefirmada; p. ej. la bandeja admin de recargas `Admin/Topups`).
> - `resources/` — imágenes de las plantillas. **Público.**
> - `attachment/` — plantillas docx/pdf, docx combinados y adjuntos. **Público.**
- **`tenant_bucket(nit, doc_type=None)`** ahora devuelve `{prefix}-{tenant_key(nit)}` en las 8
  lambdas (el `doc_type` se conserva por compat de firma y **se ignora**). La **key** lleva el
  prefijo del tipo: `Api_V1_Campaign_Prefirm-url` genera `Key = {tipo}/{fecha}/{nombre}` y lo
  devuelve como `path` (`s3Path`). Tipos válidos: `database|document|resources|attachment`.
- **Provisión en `Register`:** al registrar la empresa se crea el bucket único + **CORS**
  (GET/PUT/HEAD) + **política de lectura pública** SOLO para `attachment/*` y `resources/*`
  (con `put_public_access_block` que permite la política pero bloquea ACLs). `database/`,
  `document/` y `personalized/` quedan privados.
- **Personalizados privados (jul 2026):** los adjuntos **personalizados por destinatario** (docx
  combinado y **pdf** personalizado, que traen **datos personales**) NO van a `attachment/` (público)
  sino al prefijo **PRIVADO** `personalized/{campaignId}/{nombre}.{docx|pdf}`. `Send-EAP` los adjunta
  por `get_object` (IAM) — EAP siempre adjunta (ONFILE), nunca sirve el personalizado por URL pública,
  así que el cambio no afecta el envío. Escriben ahí `Template_Combination` (docx) y
  `Template_Combination-EAP-PDF` (pdf); lee `Send-batch-template-EAP`. El adjunto **único** de EAU y
  las **imágenes** siguen en `attachment/`/`resources/` (públicos, los usa ONLINE / el cliente de correo).
- **Internos:** el adjunto **personalizado** (Combination→Send-EAP) va bajo `personalized/{campaignId}/…`;
  los **part-files** del troceo siguen en `_parts/{processId}/N.json` (privados, raíz del bucket).
  Los lectores que sacan el basename del `documentPath` usan `split('/')[-1]` (la key tiene 3
  segmentos ahora). Los readers construyen `tenant_bucket(nit)` (único) + la key **almacenada**
  (que ya trae el prefijo) → no cambian su lógica.
- **Front:** `campaignsService.tenantBucket(nit)` (único) y `publicUrl(nit, path)` (la `path` ya
  trae el prefijo). Cada carga usa su `documentType`: imágenes→`resources`, adjuntos de campaña
  y plantillas DOCX→`attachment`, comprobante→`document`, CSV→`database`.
- **⚠️ Migración (`[J]`):** este cambio **renombra** los buckets y **reubica** las keys. Los datos
  bajo `mailconnect-{nit}-{tipo}` quedan huérfanos → recrear/mover al bucket único con prefijos.
  En dev basta con volver a registrar (crea el bucket) y volver a subir. Aplicar CORS/política a
  los buckets ya existentes si no se recrean.

### Estandarización del naming por cliente: NIT (`tenant_key`) (jul 2026)
> **Antes:** los **buckets** S3 se nombraban por **NIT** (`tenant_bucket`) pero las **tablas**
> por cliente por **nombre de empresa** (`{customer}_sendStatus`, `_sendDetail`, `_blackList`,
> `_unsubscribe`, `_processDetail`, `_sendSummary`, `_sendState`). Inconsistente y frágil (el
> nombre de empresa puede cambiar/colisionar y no siempre es DynamoDB-safe).
> **Ahora:** TODO recurso por cliente (tablas **y** buckets) usa la **misma llave**: el **NIT
> saneado** `tenant_key(nit) = re.sub(r'[^a-z0-9]', '', str(nit).lower())` (companyTin). El NIT
> es inmutable y único. `tenant_bucket(nit)` = `{prefix}-{tenant_key(nit)}` (bucket ÚNICO con
> prefijos por tipo — ver "Bucket ÚNICO por cliente con prefijos" arriba).
- **`tenant_key` es idempotente** (`tenant_key(tenant_key(x)) == tenant_key(x)`), así que aplicarlo
  a un valor ya saneado es inocuo. Está copiado en cada lambda que nombra tablas por cliente
  (mismo patrón que `tenant_bucket`; no hay import compartido entre lambdas).
- **El NIT viaja por todo el pipeline** para poder nombrar la tabla del cliente en cada etapa:
  - **JWT** (`Login` claim `nit`) → **Authorizer/Authorizer2** context `nit` → **mapping template**
    (`$context.authorizer.nit`, ver `routes.json`/`sync_api.py`) → lambdas de cliente/admin.
    `Refresh-token` preserva `nit`.
  - **SQS** (Prepare-batch → Send-batch): el mensaje ya llevaba `nit` (`build_ctx`).
  - **SES tag `nit`** (Send-EM/EAU/EAP → `Email_ReceptionStatus`), **EUM `Context.nit`**
    (SMS/Voz → `Messaging_ReceptionStatus`), **`messageIndex.nit`** (WSP → `Wsp_ReceptionStatus`),
    **token de desuscripción `n`** (Send → `Unsubscribe`). Los lectores aplican `tenant_key` (con
    fallback defensivo al nombre saneado para eventos/tokens viejos en vuelo).
  - **`process.companyTin`** se guarda ahora en el registro de proceso (Prepare-batch) para que
    los lectores admin (`Admin/Jobs`) obtengan el NIT sin re-mapear el nombre (con fallback a un
    mapa nombre→NIT desde la tabla `customer`).
- **`process`/`sendStatus`/etc. — el filtro sigue por nombre:** el `Scan`/filtro de la tabla
  **`process`** usa `customerName` (nombre de empresa, que es lo que guarda el proceso). Solo las
  **tablas por cliente** (`{tenant}_sendStatus`, …) pasan a llave por NIT. No confundir ambos.
- **Guard anti-fuga:** Prepare-batch usa `require_tenant(nit)` (falla si el cliente no tiene NIT):
  sin esto, todos los clientes sin NIT compartirían la tabla `_sendStatus` (fuga entre tenants).
- **⚠️ Migración (`[J]`):** este cambio **renombra** las tablas por cliente. Los datos de
  desarrollo bajo `{nombreEmpresa}_*` quedan huérfanos → **recrear** (o migrar) las tablas al
  esquema `{tenant_key(nit)}_*`. En dev basta con volver a enviar (Prepare-batch crea las tablas).
  El **nombre de la plantilla SES** (`{customer}_{consecutivo}_{canal}_{campaña}`) **NO** cambia
  (es otro namespace, lo crea el builder del front) — sigue por nombre de empresa.

### Multi-tenant y refresh (jul 2026)
- **Claims en el JWT:** `Login` embebe `customerId`, `customer`, **`nit` (companyTin)** y `userId`
  en el token. El `Authorizer`/`Authorizer2` los reenvían en el **context** de la policy. El `nit`
  es la **llave de los recursos por cliente** (tablas/buckets vía `tenant_key`, ver arriba).
- **Enforcement:** las read-lambdas (`Campaign_List`, `Template_List`, `Database_List`,
  `Reports_Statistics`) **prefieren el `customerId`/`customer` del context del Authorizer**
  (`event.requestContext.authorizer.*`) sobre el body → un cliente no puede consultar datos
  de otro. ⚠️ Para que el context llegue en integración **no-proxy**, el mapping template de
  esas rutas debe inyectar `$context.authorizer.customerId` (y `customer`) al body, o pasarlas
  a **proxy**. En proxy ya funciona directo. Sin eso, cae al body (comportamiento legacy).
- **Refresh token:** `Api_V1_Security_Refresh-token` valida el token vigente y reemite uno con
  los mismos claims y `exp` fresco (sesión deslizante). El front lo renueva en segundo plano
  (`RequireAuth`) cuando el usuario está activo y al token le queda < 1 h.

### Endurecimiento de autenticación: bloqueo de login, revocación de tokens, 2ª barrera admin, PBKDF2 600k (jul 2026)
- **Bloqueo progresivo de intentos de login** (`Api_V1_Security_Login`): contador
  atómico `failedLoginAttempts` + `lockUntil`/`lockStage` en la tabla `user`. Al 2º
  fallo el 404 avisa *"te queda 1 intento"*; al 3º → **429** y bloqueo **5 min**; al
  expirar, UN nuevo fallo escala a **1 h** y el siguiente a **24 h** (se mantiene).
  Login correcto con la cuenta DESBLOQUEADA resetea contador y escalera; con bloqueo
  vigente ni la clave correcta entra. Audita `security.lockout`. El front muestra la
  descripción del backend en 404/429 (`LoginPage`).
- **Revocación real de tokens (claim `sid`)**: `Login` crea la sesión ANTES de emitir
  el token (ahora es OBLIGATORIA: sin registro de sesión no hay token) y embebe su
  `sessionId` como claim **`sid`**. `Authorizer`/`Authorizer2` validan que la sesión
  exista y esté ACTIVA (GetItem a `session`, fail-closed; tokens sin `sid` = formato
  viejo → denegados, basta re-loguear). `Logout` ya desactivaba las sesiones (ahora sí
  revoca de verdad); `Change-password` también las desactiva (`_revoke_sessions`).
  `Refresh-token` exige sesión activa y **preserva `sid` y `tenantRole`** — fix de
  seguridad: antes el refresco PERDÍA `tenantRole` y el Authorizer aplicaba su default
  `owner` → un operator quedaba ESCALADO a owner al renovar. ⚠️ La revocación es
  efectiva al expirar el **cache del Authorizer** en API Gateway (bajar TTL a 60–300 s).
  ⚠️ `[J]`: IAM `dynamodb:GetItem session` en ambos Authorizers y Refresh-token;
  `Scan/UpdateItem session` en Change-password; al desplegar, los tokens vigentes (sin
  `sid`) quedan inválidos → re-login de todos los usuarios.
- **Front — sesión por pestaña**: el token/usuario pasan de localStorage a
  **`sessionStorage`** → cerrar la pestaña/ventana/navegador elimina la sesión del
  cliente. Para no perderla al abrir una pestaña nueva, las pestañas se comparten la
  sesión con un **handshake efímero** por localStorage (`mc_session_req`/`_share`,
  storage events; `RequireAuth` espera ese handshake antes de redirigir al login) y el
  logout se **difunde** a las demás pestañas (`mc_logout_broadcast`).
- **Segunda barrera del gate admin**: las 21 lambdas admin (`Admin_*`, `Customer_*`,
  `Pricing_*`, `Config_*`, `User_SetRole/SetTenantRole`, `Billing_Summary`,
  `Balance_Topup-manual`) revalidan la **FIRMA del JWT** (HS256 con `SECRET_KEY`,
  verificación manual con stdlib — sin layer PyJWT) y exigen claim `role=admin`; el
  context del Authorizer solo ya NO basta (falsificable si una ruta no-proxy queda sin
  mapping template). El token llega por el header (proxy) o por el campo **`authToken`**
  que el mapping template ahora inyecta (`$input.params('Authorization')`,
  `scripts/sync_api.py`). Sin la env `SECRET_KEY` la lambda cae al modo "solo context"
  (rollout compatible). ⚠️ `[J]`: configurar `SECRET_KEY` en las 21 lambdas admin +
  correr `deploy-api.yml`. Guard: `test_mapping_template.py`; helper de pruebas
  `helpers_auth.make_token` (los tests admin ahora firman su token).
- **PBKDF2 600.000 iteraciones** (default OWASP) en Login/Register/Change-password/
  User_Create. Compatibilidad: el formato `pbkdf2$<iter>$<hex>` es auto-descriptivo →
  los hashes viejos (100k o sha256) verifican igual y se **re-hashean transparente** en
  el siguiente login exitoso (`_needs_rehash`). En pruebas la env `PBKDF2_ITERATIONS`
  baja el costo; el default real lo verifica `test_pbkdf2_default_600k`.
- **Cobertura**: `test_login_lockout.py` (progresión 5min→1h→24h, aviso del intento
  restante, reset por login correcto, bloqueo aunque la clave sea correcta),
  `test_seguridad.py` (revocación end-to-end login→logout→401, change-password revoca,
  authorizer sin sid/sesión inactiva deniega), `test_listados_stats.py` (refresh
  preserva sid+tenantRole, 401 con sesión revocada/sin sid), `test_customer_admin.py`
  (context admin falsificado sin token → 403; token role=client → 403).

### Paridad lienzo↔PDF del Estudio (2ª tanda, jul 2026)
Fixes de fidelidad en `sketch_translator.py` + `pdf_engine` (motor estándar):
- **Grosores en mm**: el editor captura trazos/bordes en mm (`ShapeProps`/`LineProps`)
  y `border_renderer` espera mm, pero el traductor los trataba como pt (×`MM_PER_PT`)
  → bordes ~2.8× más delgados que el lienzo. Ahora pasan por `self.mm()` (unidad del
  doc) directo.
- **Líneas diagonales**: antes se aproximaban con el bounding box RELLENO (un bloque);
  ahora se emiten como rectángulo DELGADO centrado en el segmento (`points` relativos
  al x/y del elemento) y ROTADO su ángulo.
- **Rotación para TODOS los tipos**: `page_renderer._with_rotation` rota texto,
  contentarea, tabla y QR/barcode alrededor de su centro (misma convención
  `rotate(-rot)` que shape/image, que ya rotaban solos).
- **Alineación con variables**: el traductor emite `<p style="text-align:…">`, el
  `html_parser` la parsea (`Paragraph.alignment`) y `contentarea_renderer` la aplica
  (antes `TA_LEFT` fijo: un título centrado con `{{nombre}}` salía a la izquierda).
- **`font-family` por fragmento**: `_span_html` la emite, el parser la lee
  (`InlineStyle.font_family`) y el renderer la resuelve por run
  (`StyleRegistry.font_for`).
- **Alias de fuentes** (`font_manager._FAMILY_ALIASES`): JetBrains Mono/Consolas/
  Menlo→Courier (monoespaciada se mantiene monoespaciada), Arial→Helvetica,
  Times New Roman→Times, Courier New→Courier (antes TODO caía a Helvetica).
- **Estilos POR CELDA de tabla**: el traductor conserva `align`/`bold`/`color`/
  `background` de cada celda y `table_renderer` los aplica (estilo por celda +
  comandos `BACKGROUND` puntuales que pisan banda/cebra).
- **Cobertura**: 8 pruebas nuevas en `test_render_engine.py` (bordes en mm, diagonal
  rotada, alineación, celdas con estilo, font-family por span, alias de fuentes,
  parser, render con rotación).
- ⚠️ Lo que SIGUE pendiente del Estudio (ver `PENDIENTES.md` Bloque 3): opacidad/crop
  de imágenes, `fallback` del dataField. (Usarlas en campañas EAP-PDF ✅ 4ª tanda ·
  vista previa con datos ✅ 6ª tanda · flowable/paginación/bases JSON ✅ 7ª tanda ·
  `pen` eliminado del editor.)

### Estudio PDF (3ª tanda, ago 2026): UI del tamaño, líneas punteadas, viñetas, párrafo, color
Cinco correcciones reportadas sobre el editor del **Estudio PDF** (nivel medio):
- **Selector de tamaño de fuente** (`FormatToolbar.tsx`, `SizeCombo`): se ensanchó el
  input del número (no se veía) y se le dio aire a la flecha del `<select>` de unidad
  (quedaba pegada a la unidad).
- **Líneas punteadas** ahora funcionan en lienzo y PDF. Lienzo (`LineLikeElement.tsx`):
  el `dash` se ESCALA a px (`d * s`) — antes `[4,4]` px se veía casi continuo al hacer
  zoom. PDF (`sketch_translator._line`): la línea discontinua se emite como **un rect por
  cada guion** (segmentos rotados), porque el motor no tiene stroke discontinuo para
  formas rellenas; `translate_element` puede devolver **una LISTA** de elementos y
  `add_page` la aplana.
- **Viñetas** (listas): en el lienzo (`richText.ts`) el marcador se dibuja en una
  **canaleta a la izquierda** del texto (antes caía ENCIMA cuando `leftIndent`=0 →
  "sobrepuestas"). En el PDF, las listas **numeradas y de letras** ya pintan su marcador
  (antes solo las de viñeta): el traductor emite `<ul data-bullet>` / `<ol data-list=
  numbered|letter data-format>`, el `html_parser` lee el tipo/formato + numera los ítems
  (`list_index`), y `contentarea_renderer._list_marker` arma `1.`/`a)`/`•` según
  corresponda.
- **Párrafo con sangría + espacio antes/después** en el PDF (`text_renderer`): el
  contenido se parte en **un párrafo por línea** (`\n`) aplicando `spaceBefore`/
  `spaceAfter`/`firstLineIndent` (antes era UN solo `Paragraph` → el texto salía "todo
  seguido"). El traductor emite `firstLineIndent` en el `paragraphStyle`.
- **Color de texto desde el contenedor** (`FormatToolbar.tsx`): al cambiar el color con
  el ELEMENTO seleccionado (sin editar), se **limpia el color de los spans** para que
  tomen el color del elemento (en el render `span.color ?? el.color`, un span con color
  propio ignoraba el del elemento → "no hacía nada").
- **Cobertura**: pruebas nuevas en `test_render_engine.py` (parser de listas numeradas/
  letras, `_list_marker`, render smoke, `firstLineIndent`, multipárrafo, dash a
  segmentos, línea continua) + ajuste de `test_paridad_estilos.py`.

### Estudio PDF (7ª tanda, ago 2026): flujo de la hoja (paginación), bases JSON con arrays, flowable, adiós pen
- **Paginación del FLUJO (motor):** una tabla con `repeatBy` (dataSource) cuyo contenido
  NO cabe en su alto ya no se encoge (antes `KeepInFrame mode='shrink'` la volvía
  ilegible): las filas sobrantes **FLUYEN a hojas nuevas** — como en "Plantillas PDF
  profesionales". `page_renderer._page_instances(page, ctx, registry)` mide el alto real
  de cada fila (`table_renderer.measure_dynamic_rows`, `Table.wrap` de ReportLab) y
  trocea el dataSource en chunks voraces que sí caben; cada chunk es una **instancia**
  de la página (`$pageCount`/`$totalPages` cuentan el total expandido). El **encabezado
  de la tabla se repite** en cada hoja y los demás elementos (título, logos, formas) se
  repiten como **membrete**. El render recibe el chunk vía `rows_override`
  (`_render_elements` → `render_table(..., rows_override=...)`, claves por `id()` del
  elemento). Mínimo 1 fila por hoja (una fila más alta que la tabla la encoge
  KeepInFrame, que queda como red de seguridad); si nada desborda, `[None]` = render
  idéntico al de antes. Sin `dataSource` o con filas explícitas no hay paginación.
- **Bases de datos .json (front):** la carga de bases acepta ahora **JSON** además de
  CSV/Excel (`csv.ts`: `isJsonFile` + `jsonToRows`; `BasesDatosSection` suma `.json` al
  input). Formatos: array de objetos `[{...}]` o envoltorio `{data|rows|records|items:
  [...]}`. Se convierte a CSV EN EL NAVEGADOR (el backend no cambia): las columnas
  obligatorias se reordenan a las posiciones del backend (1 Identificación · 2 contacto ·
  3 Nombre, por sinónimos) y los campos ANIDADOS (arrays/objetos — p. ej. los
  movimientos de un extracto) se serializan como **JSON dentro de la celda**.
- **CSV MULTIREGISTRO (sin encabezado) (ago 2026):** la carga acepta también el layout
  clásico donde **la columna 1 de cada línea es el TIPO de registro** y no hay fila de
  encabezado: el tipo de la PRIMERA línea es el **principal** (el destinatario, con
  contrato `tipo;identificación;contacto;nombre;extras…`) y las líneas siguientes de
  otros tipos (`ingresos`, `egresos`, …) son sus sub-registros hasta la próxima línea
  principal. `csv.ts`: `detectMultiRecord` (heurística: el valor de la columna 1 de la
  línea 1 se repite en otras líneas → es etiqueta, no encabezado),
  `analyzeMultiRecordTypes` (inventario de tipos + nombres de columna por defecto:
  Identificacion/Correo|Celular/Nombre + Campo1…N) y `multiRecordToRows` (conversión al
  modelo interno: cada tipo hijo → UNA columna con el array JSON de sus líneas → alimenta
  las tablas `repeatBy` del Estudio). `BasesDatosSection`: detección automática + switch
  manual "Archivo multiregistro" (corrige la detección en ambos sentidos, p. ej. un solo
  destinatario). Sube el CSV generado (`-registros.csv`, `;`); el backend no cambia.
- **Asistente de mapeo multiregistro (`MultiRecordWizard`, ago 2026):** el mapeo por
  texto separado por comas se reemplazó por un **wizard de 3 pasos** (MUI Stepper):
  (1) **Detección** — selector "¿En qué columna está el tipo de registro?" (posición
  configurable, `tagCol`; default Columna 1) + chips de las etiquetas detectadas en la
  muestra (primeras 20 líneas); (2) **Alias** — una tarjeta por canal con su volumen
  (`ingresos • 4 líneas en la muestra`) y un "Nombre amigable" (para los hijos = el
  nombre de la columna de la lista); (3) **Nombres de columna** — un input por columna
  física (`Nombre del Campo N`) con placeholders sugeridos (Identificacion/Correo|
  Celular/Nombre) y validación en vivo (vacíos → `Campo N`; repetidos dentro de un canal
  → bloquean la subida). **Vista previa en tiempo real** de los encabezados mapeados. La
  config se estructura en un mapa indexado por posición física (`buildMultiRecordMap`:
  `{tagColumn, channels:{<tag>:{alias, isMaster, columns:{<pos 1-based>:<nombre>}}}}`).
  `csv.ts` suma `MULTIRECORD_SAMPLE_LINES`, `maxColumns`, `suggestFieldName`,
  `buildMultiRecordMap` y el parámetro `tagCol` a `detect`/`analyze`/`multiRecordToRows`;
  `MultiRecordType` gana `alias` y `sampleCount`.
- **Celdas JSON → tablas con repetición:** el combinador EAP-PDF (`row_mapping` +
  `_coerce_json_cell`) parsea las celdas que son JSON (`[`/`{`) → la variable llega como
  LISTA al motor y alimenta el `dataSource` de la tabla del Estudio **por destinatario**
  (con la paginación de arriba si desborda). En el camino HTML, `render_variables`
  sustituye las listas como JSON (no repr de Python). La **vista previa** hace lo mismo
  (`SketchStudio.coerceSampleCell` sobre la primera fila de `previewRows`).
  `Register-file` conserva las celdas JSON de `previewRows` hasta **4.000 chars** (las
  normales a 500, presupuesto total ~100 KB): truncar el JSON lo dejaba imparseable y
  la tabla de la vista previa salía vacía. **Especificación completa de los dos
  formatos de archivo: `FORMATO_BASES.md`** (raíz).
- **Flowable:** ya NO se omite con warning — se traduce como su **caja** (rect con borde
  discontinuo, igual que en el lienzo; el tinte `rgba()` decorativo no pasa al PDF). El
  vínculo flowable→flowable (continuar el flujo en otra sub-área) queda para una
  siguiente iteración; el desborde de tablas pagina a hoja nueva.
- **Pen ELIMINADO del editor** (decisión de producto: no se va a usar): fuera del union
  `Tool`, de `DrawTool`/`isDrawTool`, del draft y de `draftToElement` (no quedaba botón
  en el rail; era código muerto de creación). El TIPO `PenEl` y su render se conservan
  para ver documentos viejos (el PDF los omite con warning).
- **Motor vendorizado resincronizado** en `Api_V1_Template_Combination-EAP-PDF`
  (pdf_engine + sketch_translator).
- **Cobertura:** `test_render_engine.py` (tabla desbordada → varias hojas con la última
  fila presente y encabezado/membrete repetidos; tabla que cabe → 1 hoja; flowable →
  rect discontinuo sin warnings) y `test_combination_eap_pdf.py` (celda JSON → lista en
  `row_mapping` + HTML como JSON; E2E: extracto con 30 movimientos en celda JSON →
  PDF multipágina por destinatario con todo el contenido). Suite completo en verde.

### Estudio PDF (6ª tanda, ago 2026): variables RESUELTAS en vista previa y envío real
- **Causa raíz del "no salen los datos de la variable":** la vista previa
  (`SketchStudio.handlePreview`) llamaba a `/Template/Render-engine` **sin `data`** →
  el motor resuelve toda variable ausente a VACÍO (`resolve_var` → `''`) y el PDF salía
  sin la información de la base. El pipeline en sí estaba bien (verificado extrayendo el
  TEXTO de los PDFs generados: dataField y `{{campo}}` resuelven correctamente cuando
  llega `data`).
- **Fix vista previa:** `handlePreview` construye `data` con las columnas de la base
  seleccionada en el panel de Datos + su primera fila de `previewRows`
  (`buildPreviewData`); los bindings usados en el lienzo sin valor de muestra se envían
  como `{{campo}}` para que se VEAN como no resueltos (no en blanco).
- **Robustez del envío real** (`Combination-EAP-PDF`): el binding del editor sale de
  `databaseFile.columns` (front) pero los `headers` del mensaje salen del CSV CRUDO que
  lee Prepare-batch → pueden diferir en **BOM** (`﻿` en la 1ª columna, típico de
  Excel), espacios o mayúsculas. `row_mapping` quita el BOM y
  `augment_mapping_for_template` crea alias saneados para cada variable del template
  (data-var, QR por variable, dataSource de tablas); `render_variables` (camino HTML)
  también tolera case/espacios. La clave exacta siempre gana.
- **Pruebas endurecidas:** helper `_pdf_text` (descomprime los content streams
  Flate/ASCII85 de ReportLab) → los tests del Estudio verifican que el VALOR de la
  variable está DENTRO del PDF y que no quedan `{{tokens}}` (antes solo se miraba la
  cabecera `%PDF-`, que dejó pasar exactamente este bug).

### Estudio PDF (5ª tanda, ago 2026): selección en el lienzo + editores de estilos estilo Diseñador
- **Selección rotación-consciente** (`Canvas.tsx`): el `onMouseDown` decidía "¿el clic
  está sobre un elemento?" con el bbox SIN rotar → en un texto/forma girado, el clic
  dentro de su caja visual caía "fuera", arrancaba el marquee y LIMPIABA la selección
  (solo se podía seleccionar por el borde). Ahora `pointInElementMm` lleva el punto al
  espacio local del elemento (rotación inversa alrededor de su x,y — la convención de
  Konva) y el marquee interseca contra el AABB del elemento YA rotado (`rotatedAABBMm`).
- **Formas sin relleno seleccionables por el interior**: se quitaron los `hitFunc` de
  solo-borde de `Rect/Circle/Triangle/FrameElement` (con `fill: 'transparent'` Konva sí
  registra el interior en el hit canvas). El clic en cualquier parte de la caja
  selecciona; el marquee sigue arrancando solo FUERA de los elementos (decisión del
  Canvas por modelo, no por hit de Konva).
- **Editores de estilos con la anatomía del Diseñador** (`StyleEditorModal` — el de
  BORDES se dejó como estaba, por pedido de producto):
  - **Relleno** (tipo "Simple"): picker completo nuevo (`ColorPickerPanel.tsx`) — área
    SV grande + barra de matiz + muestras actual|Nuevo + HTML con **gotero**
    (EyeDropper API) + RGB + **CMYK** (conversión bidireccional) + opacidad. El HSV
    interno conserva el matiz al pasar por negro/blanco.
  - **Estilo de texto**: fila NOMBRE + preview "Ejemplo de texto — AaBbCc 123" + tabs
    Fuente/Reglas/Super-Sub/Líneas/**Relleno**/Contorno/Borde. Fuente: Familia
    (desplegable con las fuentes del editor), Peso, Tamaño (pt), **Fill** (selector de
    rellenos del documento; elegir uno copia su color), Color, Bold/Italic (sincronizados
    con `subFont`) y Small caps (→ `textTransform: uppercase`; el motor no tiene
    versalitas reales). Contorno/Borde son tabs informativos (paridad visual).
  - **Estilo de párrafo**: fila NOMBRE + preview de párrafo + tabs General/Listas/
    Tabuladores/Flujo/Borde/Avanzado. General: Alineación, **V. Alineación** (nueva,
    FUNCIONAL de punta a punta: `ParagraphStyle.vAlign` → `TextEl.vAlign` → canvas
    (`TextElement` desplaza el contenido) → traductor emite `verticalAlign` → el motor
    ya lo soportaba), sangrías izquierda/derecha/1ª línea (mm), espacios antes/después,
    tipo de interlineado + interlineado. **Fix de semántica**: `lineSpacing` es
    MULTIPLICADOR (default 1.2); el default viejo (5, pensado en mm) producía un
    interlineado ×5 al vincular el estilo.
- **Cobertura**: `test_render_engine.py::test_traductor_emite_vertical_align`; el motor
  vendorizado del combinador EAP-PDF se resincronizó con estos cambios.

### Estudio PDF (4ª tanda, ago 2026): flechas de tamaño, bordes punteados y USO EN CAMPAÑAS
- **Flechas ▲▼ del tamaño de fuente** (`FormatToolbar.SizeCombo`): ahora recorren SIEMPRE
  el tamaño del ELEMENTO (nueva prop `onStep`), aunque se esté editando. Antes, editando,
  aplicaban a la selección colapsada → no hacían nada y **no acumulaban** (el valor
  mostrado = `el.fontSize` no cambiaba). Además, en el editor (`TextEditorOverlay`),
  aplicar formato (color/tamaño/interletra) **sin selección** ahora afecta a TODO el texto
  del cuadro (antes se salía sin hacer nada).
- **Bordes discontinuos en el PDF**: el borde de las formas (rect/círculo/triángulo) toma
  su patrón de guiones del `BorderStyle` (`dash`, mm) o de la nueva casilla **"Borde
  discontinuo"** de `ShapeProps`. El traductor lo emite en el `unified.dash` del borde y
  el motor lo pinta con `canvas.setDash` — tanto en `border_renderer` como en
  `shape_renderer` (que dibuja forma+borde). Antes el PDF los mostraba sólidos.
- **Estudio/Diseñador USABLES en campañas EAP-PDF (cierre del Bloque 3 crítico):** el
  selector de plantilla PDF de `CampanasSection` ya no falla con las del lienzo — acepta
  `html` (editor básico), `sketchJson` (Estudio) y `templateJson` (Diseñador); sube el
  JSON del lienzo a S3 como `.json`. El combinador **`Api_V1_Template_Combination-EAP-PDF`**
  tiene ahora el motor **`pdf_engine` + `sketch_translator` VENDORIZADOS**: detecta el
  formato por el contenido (`parse_template_content`) y, si es lienzo, renderiza el PDF con
  el motor (`normalize` + `render_pdf`) **por destinatario** pasando su fila del CSV como
  `data` → las variables (`data-var`/`{{campo}}`) SE RESUELVEN. El HTML del editor básico
  sigue por xhtml2pdf. ⚠️ `[J]`: el **layer del combinador** debe sumar el motor
  (`reportlab`, `Pillow`, `qrcode`, `python-barcode`, `beautifulsoup4`, `lxml`) además de
  `xhtml2pdf`; el paquete incluye `pdf_engine/`, `sketch_translator.py` y `fonts/`.
- **Cobertura**: `test_render_engine.py` (bordes discontinuos → `unified.dash`, sólido sin
  dash, render smoke) y `test_combination_eap_pdf.py` (plantilla del Estudio renderizada
  con el motor real + `parse_template_content`).

### Fix de seguridad: RBAC de sub-rol (`tenantRole`) — cierre del bypass del maker-checker (jul 2026)
- **Problema (ALTO):** el mapping template no-proxy (`scripts/sync_api.py` `CONTEXT_TEMPLATE`) NO
  reenviaba `tenantRole`. Los gates RBAC de sub-rol —`Campaign_Approve`, `Campaign_Reject`,
  `Schedule_Create` y el **envío REAL** en `Prepare-batch`— leían `auth.get('tenantRole', 'owner')`:
  al no llegar el campo, el default `'owner'` trataba a **cualquier** usuario autenticado del
  tenant (incluido un `operator`) como owner → podía **aprobar/rechazar campañas y disparar envíos
  reales** (gastar saldo), anulando el control maker-checker.
- **Fix (2 partes, se despliegan juntas):**
  1. **Mapping template** reenvía ahora `"tenantRole": "$context.authorizer.tenantRole"` (junto a
     role/user/userId/customerId/customer/nit). Lo aplica `deploy-api.yml` (se dispara al cambiar
     `scripts/sync_api.py`).
  2. **Gates fail-CLOSED:** los 4 consumidores cambian su default de `'owner'` a `'operator'`
     (menor privilegio) → si `tenantRole` no llega, **deniegan** en vez de asumir owner. El
     `Authorizer`/`Login` **mantienen** el default `'owner'` para tokens **legacy** sin el claim
     (compatibilidad: el usuario original de una empresa ES owner), así que un owner/approver
     legítimo sigue pasando; solo cierra el caso de context ausente.
- ⚠️ **Orden de despliegue:** ambos workflows (`deploy-api.yml` + `deploy-lambdas.yml`) se disparan
  en el mismo push a `main`. Corren en paralelo; si las lambdas se actualizan antes que el template,
  hay una ventana breve en la que un owner recibe 403 al aprobar/enviar (**falla SEGURO**: deniega,
  nunca escala) que se auto-resuelve al terminar `deploy-api.yml`. Verificar que AMBOS terminen OK.
- **Cobertura:** `test_mapping_template.py` (guard: el template reenvía todos los claims, incl.
  `tenantRole`), `test_campaign_approval.py::test_approve_sin_tenantrole_403_failclosed` y
  `test_prepare_batch_integration.py::{test_split_operator_no_dispara_envio_real,
  test_split_sin_tenantrole_failclosed}`. Los tests de envío real ahora inyectan
  `authorizer.tenantRole='owner'` en el context (simulan el owner + template arreglado).

### Fix de seguridad: gate OWNER en la gestión de dominios (jul 2026)
- **Problema:** `Api_V1_Domain_Add`/`Domain_Delete` se documentaban como **RBAC owner** pero el
  backend **solo verificaba que hubiera sesión** (cualquier usuario del tenant); el "owner" estaba
  únicamente en el front (puenteable llamando la API directo). Un `operator` podía **registrar** o
  —peor— **borrar** un dominio de envío VERIFICADO (rompe la capacidad de envío de la empresa).
- **Fix:** ambos exigen ahora `tenantRole == 'owner'` (config de cuenta sensible: identidad de
  envío, DKIM, anti-spoofing) leído del context, **fail-CLOSED** (default menor privilegio si no
  llega). `Domain/List` (solo lectura) queda sin gate. Requiere el `tenantRole` del mapping template
  (ver arriba). Cubierto por `test_domains.py::{test_add_operator_403, test_add_sin_tenantrole_403_
  failclosed, test_delete_operator_403}`.

### Fix de seguridad/cumplimiento: filtro de lista negra FAIL-CLOSED (jul 2026)
- **Problema (LEGAL + reputación):** `_batch_get_emails` (el helper de `check_blacklist`/
  `check_unsubscribes` en `Prepare-batch`) hacía `except Exception: return set()` → ante CUALQUIER
  error (un **throttling** transitorio en un lote grande) devolvía "nadie está filtrado" y el envío
  seguía **a ciegas** hacia contactos en lista negra / desuscritos (viola Ley 1581 / habeas data y
  daña la reputación SES **compartida**).
- **Fix:** el `except` distingue causa. **Estructural** (`ResourceNotFoundException`/
  `ValidationException`: la tabla no existe o su esquema viejo no permite consultar) → vacío seguro
  (no hay entradas que filtrar). **Transitorio** (throttling, límite, 5xx, red) → **re-lanza**
  (fail-closed) para que la parte se REPROCESE, en vez de enviar sin filtrar.
- **Fix acoplado — el worker SQS ya no traga excepciones:** el branch SQS de `Prepare-batch`
  (`if 'Records' in event`) estaba dentro del `try/except Exception` del handler, que devolvía un
  500 → **para SQS eso es una invocación EXITOSA → ACKea y BORRA el mensaje** → la parte se perdía
  en silencio (incluido el re-lanzamiento del filtro). Ahora, si el evento es SQS, el `except`
  **propaga** (la invocación falla → SQS redelivery → reproceso idempotente por el claim de parte/
  chunk → DLQ tras agotar reintentos). La ruta API (proxy) sigue devolviendo el 500 al llamante.
  Es SEGURO propagar ahora porque el punto de idempotencia atómica ya hace el reproceso sin duplicar.
  ⚠️ Refuerza la necesidad de **DLQ** en las colas del CD (hoy solo en Terraform) para no reintentar
  un "mensaje veneno" hasta agotar la retención. Cubierto por `test_prepare_batch.py::
  {test_filtro_error_transitorio_falla_cerrado, test_worker_sqs_propaga_excepcion_no_ackea}`.

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
      - [x] **Plantillas HTML** → constructor drag-and-drop "pro" (tipo Topol/MailPro): 15 bloques
            (encabezado, texto, imagen, botón, logo, 2 columnas, redes sociales, HTML crudo,
            divisor, espaciador, **Imagen+Texto**, **Texto+Imagen**, **Texto+Botón**,
            **Botón+Texto**, **Productos**) en paleta agrupada (Contenido/**Combinados**/Estructura),
            reorden por
            arrastre + flechas, duplicar/eliminar, panel de propiedades, variables `{{nombre}}`.
            **Combos Imagen/Texto (jul 2026):** 2 celdas que apilan en móvil (`mc-col`) con imagen +
            título + texto + botón opcional. **Grilla de Productos (jul 2026):** N columnas (2/3)
            de {imagen, título, texto, enlace} con editor de items (agregar/quitar, subir imagen a
            S3 por producto); genera filas `mc-col` que apilan en móvil (como el "Nuestros últimos
            productos" de MailPro).
            **Arrastrar del panel al lienzo (jul 2026, tipo MailPro):** los bloques de la paleta
            son `draggable` y se **sueltan en una posición exacta** del lienzo con una **línea
            indicadora** de inserción (mitad superior/inferior de cada bloque); el lienzo vacío es
            zona de drop. Sigue el clic-para-agregar y el reorden por arrastre (DnD unificado
            `dragSource` = paleta|bloque + `insertAt(index)`).
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
      - [x] **Bases de datos** (`BasesDatosSection` + `csv.ts`): carga de **CSV o Excel .xlsx**
            (el Excel se lee en el navegador con `read-excel-file`, se convierte a **CSV** y se
            sube ese CSV a S3 → el backend sigue leyendo CSV, sin cambios; el `.xlsx` es solo
            comodidad de entrada. Aviso: formatear celular/identificación como **Texto** en Excel
            para no perder el `+`/ceros) con
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
- [x] `token/refresh` implementado. **`verify-code` eliminado** (era un stub sin uso; el flujo
      de verificación real usa create-otp/validate-otp y la activación por enlace).
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
- [x] Desplegar las lambdas nuevas y **crear sus rutas** en API Gateway
      (`/change-password`, `/logout`, `/create-otp`, `/validate-otp`, `/account-activation`).
- [x] **Habilitar CORS** en API Gateway para los endpoints que llama el navegador.
- [x] **Nuevas de esta sesión** `[J]`:
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
        `$context.authorizer.role` (y `customerId`/`customer`/**`nit`**). Sin eso la lambda ve el
        context vacío → 403 aunque el usuario SÍ sea admin. Alternativa: pasar esas rutas a
        **proxy**. El template de `sync_api.py` ya inyecta `nit` (llave de tablas por cliente).
      - **⚠️ NIT en el context (naming por cliente):** las read-lambdas de cliente
        (`Reports_Statistics`, `Portal_Bootstrap`, `Blacklist_*`, `state-report`) construyen las
        tablas por cliente con `tenant_key(nit)`. El `nit` DEBE llegar en el context (JWT + mapping
        template `$context.authorizer.nit`). Sin él caen a un lookup de `companyTin` por `customerId`
        (Blacklist) o devuelven vacío (Statistics/Bootstrap). Ver "Estandarización del naming" (§3).
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
- [x] **SES en PRODUCCIÓN** (fuera del sandbox, remitente/dominio verificados).
- [x] Configurar las **variables de entorno** de §3 en cada lambda.
- [x] Definir `VITE_API_BASE_URL` de producción en el front.

### Calidad / CI-CD
- [x] **CI con GitHub Actions:** `pytest` de `08_Pruebas/PruebasSeguridad` corre
      automáticamente en cada `push` y `pull_request` (Python 3.11) vía
      `.github/workflows/tests.yml`, para evitar regresiones.
- [ ] (Opcional) Añadir al CI el build del frontend (`npm ci && npm run build`).
- [x] **CD de lambdas:** `.github/workflows/deploy-lambdas.yml` despliega a AWS solo las
      lambdas cambiadas en cada push a `main` (o manual). Requiere los secrets
      `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (+ `AWS_REGION`) y opcional
      `04_Backend/lambdas/deploy-map.json` si el nombre AWS difiere del de la carpeta.
- [x] **CD de lambdas — crea la función si NO existe (jul 2026):** ya no hace falta "crear la
      función vacía" antes del CD. Si la función no está en AWS, el workflow la **crea en
      Python 3.13** (`lambda_function.lambda_handler`, timeout 60 s, 256 MB) con su **rol por
      convención**: nombre `Lambda[_DynFull][_SES][_SQS][_S3][_SNS][_Scheduler][_Bedrock][_EUM]
      [_Social][_Invoke]` **auto-detectado** de los `boto3.client/resource(...)` del código
      (sin servicios → `Lambda_Basic`; override manual en `04_Backend/lambdas/role-map.json`,
      ver `role-map.example.json`). Si el rol no existe en IAM lo crea: siempre
      `AWSLambdaBasicExecutionRole` (ejecución + logs) + política **full** por token
      (DynFull→DynamoDB, SES, SQS, S3, SNS, Scheduler→EventBridge Scheduler, Bedrock; EUM
      `sms-voice:*`, Social `social-messaging:*` e Invoke `lambda:InvokeFunction` como inline).
      Roles ya existentes se usan tal cual (no se les tocan políticas).
- [x] **CD de lambdas — reconciliación del rol en CADA despliegue (jul 2026):** antes de tocar los
      triggers, el workflow asegura que la función use su **rol de convención** (crea el rol si
      falta y **cambia el de la función si difiere**), tanto al crear como al **actualizar**. Antes,
      la rama de actualizar solo tocaba el código → una función vieja con un rol sin permiso SQS
      fallaba al crear el trigger (*"execution role does not have permissions to call ReceiveMessage
      on SQS"*). Solo actúa en carpetas con trigger `sqs`. **No toca** el rol si ya concede SQS (su
      nombre incluye el token `SQS`, p. ej. `Lambda_DynFull_SQS_Messaging`) → evita churn. Reconcilia
      (crea el rol de convención + cambia el de la función) si el rol actual es de convención sin SQS
      (`Lambda_*`), el **auto-generado por AWS** al crear la función en consola (`{fn}-role-xxxx`), o
      ninguno. Un rol **personalizado deliberado** (nombre no reconocido) NO se pisa (se avisa; usa
      `role-map.json`). Al crear un rol nuevo espera la propagación IAM **antes** de asignarlo (si no,
      *"The role ... cannot be assumed by Lambda"*), y el `update-function-configuration` + la creación
      del event source mapping **reintentan** los errores transitorios de propagación.
      ⚠️ La función nace SIN
      env vars, SIN layers y SIN triggers (eso sigue manual, ver `DESPLIEGUE.md`). El input
      manual `force_runtime313` migra también las funciones EXISTENTES a python3.13 (ojo:
      layers con binarios de otra versión, p. ej. reportlab/Pillow, dejarían de funcionar).
      El usuario IAM de CI necesita además `lambda:CreateFunction/GetFunctionConfiguration/
      UpdateFunctionConfiguration` e `iam:GetRole/CreateRole/AttachRolePolicy/PutRolePolicy/
      PassRole` (sobre los roles `Lambda_*`).
- [x] **CD de lambdas — triggers y colas SQS (jul 2026):** en cada despliegue de una carpeta el
      workflow asegura (idempotente: solo crea lo que falte, lo existente no se toca) los
      triggers declarados en **`04_Backend/lambdas/trigger-map.json`**:
      - `sqs`: crea la **cola** si no existe (VisibilityTimeout 360 s + long polling; override
        `visibilityTimeout`) y el **event source mapping** cola→lambda (`batchSize` default 10).
        La lambda con trigger `sqs` recibe además el token **`_SQS`** en su rol auto-detectado
        (el poller de Lambda lee la cola con el rol de la FUNCIÓN, aunque su código no use SQS).
        **DLQ (jul 2026):** crea también la cola de mensajes muertos `{cola}-dlq` (retención 14 días)
        y le pone a la cola una **redrive policy** con `maxReceiveCount` 5 (override `maxReceiveCount`).
        Misma convención que Terraform (`infra/terraform/sqs.tf`) → convergen. Una cola EXISTENTE
        sin redrive recibe la DLQ (best-effort, requiere `sqs:SetQueueAttributes`); las de Terraform
        (ya con redrive) se dejan intactas. Sin DLQ, un "mensaje veneno" (fallo persistente) se
        reintenta hasta agotar la retención (4 días) y se pierde en silencio — crítico ahora que el
        worker SQS de Prepare-batch **propaga** los fallos (ver fix del filtro fail-closed).
      - `sns`: crea el **tópico** + permiso de invocación + suscripción (apuntar el config set
        SES/EUM al tópico sigue siendo manual, por eso no viene pre-llenado).
      - `schedule`: regla **EventBridge** `{funcion}-cron` con `rate()`/`cron()` + permiso + target.
      Pre-llenado con las **9 colas reales del pipeline** (batchSize 1 — cada mensaje ya es un
      lote): `Email_Prepare-batch-part`→Prepare-batch (worker de partes),
      `Email_Send-batch-template-EM`→Send-EM, `Email_Send-batch-raw-EAU/-EAP`→Send-EAU/EAP,
      `Template_Combination-EAP`→Template_Combination, `Template_Combination-EAP-PDF`→ídem-PDF,
      `Sms/Wsp/Voice_Send-batch`→sus workers. El usuario de CI necesita además
      `sqs:GetQueueUrl/CreateQueue/GetQueueAttributes` y `lambda:ListEventSourceMappings/
      CreateEventSourceMapping/AddPermission` (+ `sns:CreateTopic/Subscribe/
      ListSubscriptionsByTopic` y `events:PutRule/PutTargets` si se usan esas llaves; y
      `sqs:SetQueueAttributes` para la DLQ de colas existentes) —
      **agregar esos permisos ANTES del próximo push** que toque lambdas con trigger.

### Fix: EAP registra los fallos de envío por destinatario (no más pérdida silenciosa) (jul 2026)
- **Problema:** `Send-EAP` (canal de adjunto PERSONALIZADO por destinatario — docx/pdf, típicamente
  documentos importantes) enviaba cada correo en un `try/except` que solo hacía `print(e)`. Un fallo
  (throttle, dirección inválida, adjunto corrupto) se **tragaba**: sin estado en `sendStatus` y sin
  evento SES (el envío nunca llegó a SES → no hay messageId) → el destinatario quedaba **invisible**
  (ni enviado ni rechazado) y sin reintento (EAP "termina" la parte igual).
- **Fix:** en el `except` por destinatario, `_record_send_failure` escribe una fila **state=3
  (Reject)** en `{tenant}_sendStatus` con un **messageId sintético DETERMINISTA** por `(part, uniqueId)`
  — necesario porque `Reports_Statistics` agrega **por messageId y descarta las filas sin él**. Así el
  fallo se **cuenta como rechazo** en el reporte. El ÉXITO NO se registra aquí (lo reporta SES por
  evento con el messageId real → registrarlo duplicaría). Clave determinista → un reproceso sobrescribe
  (no duplica). Cubierto por `08_Pruebas/PruebasSeguridad/test_eap_send_failure.py`.
- **Bug latente corregido de paso:** en EAP la variable `part` se **reasigna a `MIMEApplication`**
  dentro del bucle, así que el `_mark_part(...,"Terminado")` (idempotencia, jul 2026) usaba una clave
  basura. Se captura `part_id = part` antes del bucle y se usa en el claim/mark/registro de fallos.
  (El **claim** de idempotencia ya era correcto — se hace ANTES del bucle, con `part` aún = id.)

### Seguridad (URGENTE)
- [x] Scripts `prueba genera JWT.py` / `prueba jwt.py` limpios: leen `SECRET_KEY` de env (jul 2026).
- [x] **`SECRET_KEY` ROTADA** (32+ bytes) — la clave vieja del historial git ya no está en uso.
- [x] **Aislamiento multi-tenant desplegado** — `API_ID`/`AUTHORIZER_ID`/`STAGE`/`PREFIX`
      configuradas + `deploy-api.yml` corrido (mapping template de context en todas las rutas).
- [x] Hacer el repo **privado** (o limpiar el historial con BFG/filter-repo).
- [ ] Mover `SECRET_KEY` a **AWS Secrets Manager** (ya rotada; hoy es env var).
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
- **Definición de los archivos de bases (CSV con encabezado, CSV MULTIREGISTRO sin
  encabezado con columna 1 = tipo de registro, y JSON; columnas obligatorias, celdas
  con arrays → tablas con repetición): `FORMATO_BASES.md`** (raíz).
- **Checklist de despliegue consolidado (panel admin + pendientes): `DESPLIEGUE.md`** (raíz).
  Todo lo `[J]` (tablas, lambdas, rutas, IAM, mapping template de rol) y lo `[C]` (código pendiente).
- **Plan de salida a producción (MVP) y canales SMS/WhatsApp/Voz: `PLAN_MVP.md`** (raíz).
- Arquitectura completa y catálogo: **`README.md`** (raíz).
- Contrato de la API: **`09_Herramientas/01-MailConnect.postman_collection.json`**.
- Base de la API (Test): `https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api`
- Marca: fuente **Nunito**; colores del logo cyan `#00c3ff` / azul `#0075be` / navy `#16233f`.
- Para correr las pruebas: `cd 08_Pruebas/PruebasSeguridad && pip install -r requirements.txt && pytest -v`
