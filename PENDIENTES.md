# PENDIENTES.md — Backlog por bloques

> **Propósito:** lista maestra de pendientes para trabajar POR BLOQUES, salida de la
> revisión profunda del proyecto (jul 2026). Complementa a `DESPLIEGUE.md` (checklist
> de consola) y a `PLAN_MVP.md` (plan de salida). Convención: `[J]` = despliegue/consola
> AWS · `[C]` = código · `[P]` = producto/decisión de negocio.
>
> Al cerrar un ítem, márcalo `[x]` y (si aplica) actualiza `DESPLIEGUE.md`/`CLAUDE.md`.

---

## BLOQUE 0 — Hecho en esta tanda (jul 2026) + su despliegue

Código YA implementado y probado (suite completo en verde). Lo único abierto de este
bloque son los pasos `[J]` de despliegue.

- [x] `[C]` **Bloqueo progresivo de login**: 2º fallo avisa "queda 1 intento"; 3º fallo
      → 5 min; reincidencia tras habilitarse → 1 h → 24 h (se mantiene). Login correcto
      (desbloqueado) resetea contador y escalera. Con bloqueo VIGENTE ni la clave
      correcta entra. (`Api_V1_Security_Login`; campos `failedLoginAttempts`/`lockUntil`/
      `lockStage` en `user`; respuesta 429; audita `security.lockout`.)
- [x] `[C]` **Revocación real de tokens**: el JWT lleva `sid` (id de sesión); los
      Authorizers deniegan tokens sin `sid` o con sesión inactiva; Logout y
      Change-password desactivan las sesiones; Refresh-token la valida y PRESERVA
      `sid` + `tenantRole` (fix: antes el refresco PERDÍA el sub-rol → escalación
      operator→owner). Front: la sesión pasa a `sessionStorage` (muere al cerrar
      pestaña/ventana/navegador) con handshake entre pestañas abiertas + logout
      difundido a todas las pestañas.
- [x] `[C]` **Segunda barrera admin**: las 21 lambdas admin revalidan la FIRMA del JWT
      (HS256, sin PyJWT) y exigen claim `role=admin`; el context solo ya no basta. El
      mapping template inyecta el header Authorization como `authToken`.
- [x] `[C]` **PBKDF2 a 600.000 iteraciones** (Login/Register/Change-password/User_Create)
      con re-hash transparente en el siguiente login (el formato `pbkdf2$iter$hex` es
      auto-descriptivo → sin migración).
- [x] `[C]` **Paridad lienzo↔PDF (Estudio PDF)**: bordes/trazos en mm (salían ~2.8×
      más delgados), líneas diagonales como línea real (rect rotado, no bloque),
      rotación de texto/contentarea/tabla/QR en el motor, alineación de párrafos con
      variables (`text-align` ya no se pierde), `font-family` por fragmento, alias de
      fuentes (JetBrains Mono→Courier, Arial→Helvetica, Times New Roman→Times) y
      estilos POR CELDA de tabla (align/bold/color/background).

**Despliegue de esta tanda (hacer JUNTO):**

- [ ] `[J]` Redesplegar `Api_V1_Security_{Login,Logout,Change-password,Refresh-token}`,
      `Authorizer` y `Authorizer2`.
- [ ] `[J]` IAM: permiso `dynamodb:GetItem` sobre la tabla **`session`** en los roles de
      `Authorizer`, `Authorizer2` y `Refresh-token`; `dynamodb:UpdateItem` sobre `user`
      en Login (contador de bloqueo) y `Scan`/`UpdateItem` sobre `session` en
      Change-password (revocación).
- [ ] `[J]` Redesplegar las 21 lambdas admin y **configurar la env `SECRET_KEY`** en
      TODAS (la misma del Login). Sin la env, el gate cae al modo "solo context"
      (compatibilidad de rollout) y la segunda barrera queda inactiva.
- [ ] `[J]` Correr `deploy-api.yml` (el mapping template ahora inyecta `authToken`).
      Orden seguro: primero API (template), luego lambdas — o el mismo push; la ventana
      intermedia falla CERRADA (403 admin), nunca escala.
- [ ] `[J]` **Aviso de corte:** al desplegar, TODOS los tokens vigentes quedan inválidos
      (no traen `sid`) → los usuarios deben volver a iniciar sesión una vez.
- [ ] `[J]` Bajar el **TTL del cache del Authorizer** en API Gateway a 60–300 s: la
      revocación es efectiva cuando expira ese cache.
- [ ] `[J]` Redesplegar `Api_V1_Template_Render-engine` (traductor + motor con los fixes
      de paridad). Si aún no existe, ver Bloque 2.

---

## BLOQUE 1 — Seguridad (lo que sigue abierto)

1. [x] `[J]` ✅ **`Api_V1_Security_Register`** desplegado (ago 2026): rechaza (409) el
       registro bajo un NIT ya existente. Cerrado.
2. [ ] `[J]` **Rate limiting/WAF** en los endpoints públicos: `/Assistant/Ask` (costo
       Bedrock ilimitado + jailbreak), `/Security/Register` y `/Security/Create-otp`
       (email bombing vía SES). Usage plan + regla rate-based + alarma de gasto Bedrock.
3. [ ] `[C]` **`realSendEnabled` fail-closed**: hoy `Prepare-batch`/`Login` asumen `True`
       si falta el campo o falla la lectura. Un control de bloqueo debe denegar ante error.
4. [ ] `[C]` **Blacklist Add/Delete**: eliminar el fallback al body (`nit`/`customerId`)
       — usar `_resolve_tenant` (ya existe, es código muerto). Igual en `Cost_Estimate`.
5. [ ] `[J]` **Secrets Manager** para `SECRET_KEY` y llaves Wompi (hoy env vars).
6. [ ] `[C]` **Anti-enumeración**: homogeneizar mensajes (Login 423 vs 404, Register
       email vs NIT, OTP 404) — decisión de producto: hoy priorizan UX.
7. [ ] `[C]` **Sanitizar `dangerouslySetInnerHTML`** (DOMPurify) en HtmlBuilder/designer
       — un XSS roba la sesión (mitigado en parte: el token ya no persiste al cerrar).
8. [ ] `[J]` **S3 público** (`attachment/`, `resources/`): migrar a URLs prefirmadas o
       CloudFront + OAC; acotar CORS a los orígenes del portal.
9. [ ] `[C]` **Carrera de registro por email**: `Register` usa Scan sin condición — dos
       registros concurrentes del mismo correo pueden duplicarse (usar GSI +
       `ConditionExpression`).
10. [ ] `[C]` **CAPTCHA** en registro y forgot-password (complementa el punto 2).

---

## BLOQUE 2 — Despliegues que desbloquean features YA construidas

El front está terminado y el backend probado; solo falta la consola AWS
(detalle exacto en `DESPLIEGUE.md` §3b–§3e):

1. [ ] `[J]` **Programar envíos**: tabla `scheduledSend`, rol
       `MailConnectSchedulerInvokeRole`, lambdas+rutas `Schedule_{Create,Fire,List,Cancel}`.
2. [ ] `[J]` **PDF nivel básico + envío EAP-PDF**: layer xhtml2pdf, `Template_Render-pdf`,
       `Template_Combination-EAP-PDF` + cola + trigger, redeploy `Send-batch-template-EAP`.
3. [ ] `[J]` **Motor estándar (Estudio/Diseñador)**: `Api_V1_Template_Render-engine` +
       ruta `/Template/Render-engine` + layer (reportlab, Pillow, qrcode, python-barcode)
       + IAM (`GetItem messageTemplate`, S3 PutObject). **Verificar el GSI
       `customerId-index` en `messageTemplate`** (sin él, List falla y el lanzador del
       Estudio queda vacío).
4. [ ] `[J]` **Cascada omnicanal**: tablas `cascadeRun`/`cascadeContact` (+GSIs), cron
       `rate(10 min)` → `Cascade_Advance`, rutas `/Cascade/{Dispatch,List}`, IAM.
5. [ ] `[J]` **Equipo del cliente**: `User_{Create,List,Delete}` + rutas + mapping
       `tenantRole` + env `MAX_TEAM_USERS`.
6. [ ] `[J]` **Copiloto IA**: lambda `Assistant_Copilot` + ruta + IAM Bedrock. `[C]`
       re-habilitar el tab (`PortalSidebar` + `case` en `PortalPage`) cuando producto lo pida.
7. [ ] `[P]` **Piloto E2E con cliente real** (gate final del MVP, `PLAN_MVP.md` Fase 1).

---

## BLOQUE 3 — Plantillas PDF avanzadas (Estudio): cerrar el ciclo

1. [x] `[C]` ✅ **Usarlas en campañas (ago 2026)**: el selector EAP-PDF ya acepta las
       plantillas del Estudio (`sketchJson`) y del Diseñador (`templateJson`) — sube el
       JSON a S3 y el combinador `Combination-EAP-PDF` (con el motor `pdf_engine`
       vendorizado) lo detecta, lo traduce y renderiza el PDF **por destinatario**
       pasando la fila del CSV como `data` → las variables (`data-var`/`{{campo}}`) se
       resuelven. El HTML del editor básico sigue por xhtml2pdf. ⚠️ `[J]`: el layer del
       combinador debe sumar el motor (`reportlab`, `Pillow`, `qrcode`,
       `python-barcode`, `beautifulsoup4`, `lxml`) además de `xhtml2pdf`.
2. [x] `[C]` ✅ **Vista previa con datos de muestra (ago 2026)**: `handlePreview` ya envía
       `data` (columnas + primera fila de `previewRows` de la base seleccionada en el
       panel de Datos); los bindings sin muestra quedan visibles como `{{campo}}`. El
       envío real quedó además **tolerante a BOM/espacios/mayúsculas** entre el binding
       del editor y el encabezado crudo del CSV (alias saneados en el combinador). Las
       pruebas ahora verifican el CONTENIDO del PDF (texto extraído), no solo `%PDF-`.
3. [x] `[C]` ✅ **Flujo de la hoja + bases JSON (ago 2026)**: (a) la herramienta `pen`
       se ELIMINÓ del editor (fuera de alcance; los docs viejos con pen se siguen
       viendo en el lienzo y el PDF los omite con warning); (b) `flowable` ya se
       traduce al PDF como su caja (rect con borde discontinuo); (c) **paginación del
       flujo**: una tabla `repeatBy` cuyo contenido no cabe en su alto FLUYE a hojas
       nuevas (encabezado de tabla repetido, el resto de elementos como membrete) —
       antes KeepInFrame lo encogía hasta lo ilegible; (d) **bases .json**: la carga
       de bases acepta JSON (array de objetos → CSV en el navegador); un campo con un
       ARRAY (p. ej. movimientos de un extracto) queda como JSON dentro de la celda y
       el combinador/vista previa lo parsean para alimentar la tabla `repeatBy` por
       destinatario. Pendiente de esta línea (siguiente iteración): vínculo
       flowable→flowable (continuar el flujo en OTRA sub-área de la misma hoja, no
       solo en hoja nueva).
4. [ ] `[C]` Restos del traductor: opacidad/crop de imágenes, `fallback` del
       dataField, interletra por fragmento en contentarea, fondos de página no
       sólidos. (Líneas/bordes punteados y tabla `repeatBy` en vista previa: ✅ hechos.)
5. [ ] `[J]` Fuentes reales para cursivas de Inter (subir `Inter-Italic.ttf`/
       `Inter-BoldItalic.ttf` a `fonts/`) si se quiere cursiva fiel (hoy cae a
       Helvetica-Oblique).
6. [ ] `[C]` Validar el tamaño del diseño al guardar (límite 400 KB del item de
       DynamoDB) y aligerar la precarga del portal (List devuelve el `sketchJson`
       completo de TODAS las plantillas).

---

## BLOQUE 4 — Producto (brechas vs. mercado)

1. [ ] `[P]/[C]` **Segmentación de audiencias** (filtros sobre columnas de la base).
2. [ ] `[P]/[C]` **Pruebas A/B** de asunto/plantilla con ganador por apertura.
3. [ ] `[P]/[C]` **API pública + webhooks** para clientes (transaccional).
4. [ ] `[C]` **Higiene de listas**: verificación previa (sintaxis+MX) antes del envío real.
5. [ ] `[C]` **Centro de preferencias** del suscriptor (no solo desuscripción total).
6. [ ] `[C]` **Reporte por destinatario** buscable ("¿qué le llegó a X?").
7. [ ] `[C]` **2FA (TOTP)** para admins y owners (reutiliza la infraestructura OTP).
8. [ ] `[C]` **Notificaciones al cliente**: campaña terminada, saldo bajo, rebote alto.
9. [ ] `[P]` **Automatizaciones** (bienvenida/fechas) sobre el motor de la Cascada.
10. [ ] `[P]` Decisiones abiertas: proveedor SMS definitivo, tarifas reales calibradas,
        reembolso de fallidos, facturación fiscal DIAN (ver la sección Prepago en `CLAUDE.md`).

---

## BLOQUE 5 — Tableros

1. [x] `[C]` ✅ **"Centro de mando" (admin) (ago 2026)**: tab nuevo (página de ENTRADA del
       admin, `CentroMandoSection` + `Api_V1_Admin_Control-center`): semáforo del pipeline
       (procesos atascados >2 h, schedules `failed`, profundidad de colas y DLQs), dinero
       del día (débitos/recargas + solicitudes pendientes + saldo plataforma), top 5 en
       riesgo de reputación CON tendencia (7d vs 7d, del rollup `sendSummary`), **salud de
       servicios** (cuota SES con barra de uso + envío habilitado, tablas DynamoDB núcleo,
       colas SQS accesibles) y últimas 10 de auditoría. Auto-refresco 60 s. ⚠️ `[J]`: ruta
       `/Admin/Control-center` (ya en routes.json) + IAM (sqs:GetQueueUrl/GetQueueAttributes,
       ses:GetSendQuota/GetAccountSendingEnabled, dynamodb:DescribeTable + Scans).
2. [ ] `[C]` **Series temporales** (30 días) en cliente y admin vía la preagregación
       `sendSummary` (pre-agregación, ver `CLAUDE.md`): sparklines + área de
       envíos/entregas/aperturas. De paso elimina los avisos de "datos parciales".
3. [ ] `[C]` **"Salud de mi base"** (portal): crecimiento de válidos, rebotados
       acumulados, desuscritos, heatmap día×hora de aperturas (alimenta la hora óptima
       del Copiloto).

---

## BLOQUE 6 — Panel admin (funciones faltantes)

1. [x] `[C]` ✅ **Listado global de plantillas SES (ago 2026)**: `Api_V1_Admin_Templates`
       (`ListTemplates` paginado, prefijo de cliente derivado del nombre) + tab
       Soporte → "Plantillas SES" con filtro y paginación.
2. [ ] `[C]` **"Ver como cliente"** (impersonación auditada) para soporte.
3. [x] `[C]` ✅ **Acciones de soporte en la ficha (ago 2026)**: `Api_V1_Admin_User-support`
       (reenviar activación — solo inactivos, enlace nuevo 24 h; forzar reseteo — OTP
       hasheado compatible con Validate-otp; **cerrar sesiones** — desactiva `session`,
       revocación efectiva por `sid`). Auditadas (`support.*`); botones por usuario en
       la ficha de Clientes. También **"¿qué le llegó a X?"**: `Api_V1_Admin_Recipient-lookup`
       + tab Soporte → "Buscar destinatario" (línea de tiempo por contacto con estado por
       envío + banderas de lista negra/desuscrito).
4. [ ] `[C]/[J]` **Colas/DLQ**: ver/redrive de DLQs desde la UI (la PROFUNDIDAD ya se ve
       en el Centro de mando; falta operar).
5. [ ] `[C]` **Límites por cliente**: tope diario/por campaña y tasa máxima (hoy solo
       existe el interruptor `realSendEnabled`).
6. [x] `[C]` ✅ **Dominios remitentes globales (ago 2026)**: `Api_V1_Admin_Domains` (scan
       `senderDomain` + nombre de empresa) + tab Soporte → "Dominios remitentes"
       (pendientes primero).
7. [ ] `[C]` **Paginación/búsqueda server-side** en las tablas admin (adiós al patrón
       `truncated`; se apoya en el Bloque 5.2).
8. [x] `[C]` ✅ **Export de auditoría (ago 2026)**: filtros `dateFrom`/`dateTo` en
       `Admin/Audit` + botón "Exportar CSV" en la sección (exporta lo filtrado).
9. [ ] `[C]` **Panel de salud de despliegue**: verificación de qué rutas/lambdas/tablas
       del checklist `[J]` existen realmente en AWS.

---

## BLOQUE 7 — Calidad / CI / limpieza

1. [ ] `[C]` **Build del frontend en CI** (`npm ci && npx tsc -b && npm run build`):
       hoy una regresión de TypeScript pasa el CI en verde.
2. [ ] `[C]` Quitar el botón "Ver datos de ejemplo (demo)" de `ReportesSection` y los
       endpoints placeholder muertos de `config/api.ts:40-73`.
3. [ ] `[C]` Guard de CI para `VITE_AUTH_MOCK=false` en builds de producción.
4. [ ] `[J]` Checklist post-deploy de `DESPLIEGUE.md` §7 (6 ítems sin marcar).
