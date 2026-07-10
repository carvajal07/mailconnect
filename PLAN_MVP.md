# PLAN_MVP.md — Plan de salida a producción (MVP) y roadmap multicanal

> **Propósito:** definir qué falta para la **primera salida a producción (MVP)** de
> MailConnect, con un plan de trabajo por fases y el diseño de los canales
> **SMS, WhatsApp y Voz**. Este documento es el plan maestro; `CLAUDE.md` mantiene
> el estado de sesión a sesión y `README.md` la arquitectura.
>
> _Creado: julio 2026._

---

## 1. Definición del MVP (criterio de "listo para salir")

El MVP es: **un cliente puede completar solo, en producción, el ciclo completo de
email marketing sin intervención nuestra**:

```
registro → activación por correo → login → cargar base CSV → crear plantilla HTML
→ crear campaña → enviar muestras → aprobar → envío real (EM) → ver estados/reporte
→ (destinatario puede darse de baja) → recuperar contraseña
```

**Alcance de canales del MVP:** solo **Email**:
- `EM` (masivo sin adjunto) → **GA** (disponible para todos).
- `EAU` / `EAP` (adjuntos) → **beta controlada** (clientes acompañados; el flujo
  docx/PDF necesita más rodaje).
- SMS, WhatsApp y Voz → fases 2 y 3 (diseñados en §5, no bloquean la salida).

**Fuera del MVP:** facturación/cobro automático (se factura manual), estimador de
costos en pantalla, plantillas PDF, listas negras administrables desde UI, portal
admin de clientes, verify-code.

---

## 2. Estado actual (julio 2026 — resumen honesto)

### Lo que ya funciona
- **Seguridad backend:** register (+correo activación), login (devuelve token,
  customer, customerId, NIT), activación, change-password (token u OTP), logout,
  create/validate-otp, forgot-password, Authorizers validando JWT (HS256,
  fail-closed). 25 pruebas pytest+moto en verde con CI en cada push.
- **Portal del cliente (`/panel`):** builder HTML drag-and-drop (responsive +
  cross-client, imágenes a S3, 5 plantillas prediseñadas), campañas
  (create-campaign + subida CSV a S3), **muestras + aprobación + envío real**
  conectados a `Prepare-batch-template`, bases de datos con validación de
  estructura e **historial persistente** (`databaseFile` + 2 lambdas nuevas),
  reportes (state-report real), estadísticas (UI lista, datos demo), mi cuenta.
- **Infra/CI-CD:** dominio `api.mailconnect.com.co` con rutas `/V1/Módulo/Acción`,
  CORS habilitado en los endpoints principales, deploy automático de lambdas
  cambiadas en cada merge a main, pytest en CI.
- **Pipeline de envío (heredado, funcional):** Prepare-batch → SQS por canal →
  Send EM/EAU/EAP → SES → SNS → ReceptionStatus → tablas `{customer}_sendStatus_*`.

### Deuda/estado a verificar en AWS (de sesiones anteriores)
- El deploy masivo del 9 jul pudo dejar `Api_V1_Email_Send-batch-template` (función
  sin sufijo) con código stub. Verificar que **ninguna ruta/cola apunte a esa
  función** (el envío real debe apuntar a `Api_V1_Email_Prepare-batch-template`).
- Checklist de consola pendiente (rutas Database, GET de activación, env vars,
  tabla `databaseFile`) — ver §4 Fase 1.

---

## 3. Brechas para producción (análisis de gaps)

### 🔴 Bloqueantes — no salir sin esto

| # | Brecha | Detalle | Dónde se resuelve |
|---|--------|---------|-------------------|
| B1 | **SECRET_KEY expuesta en repo PÚBLICO** | `04_Backend/scripts/prueba genera JWT.py` y `prueba jwt.py` contienen la clave real de firma JWT y el repo `carvajal07/mailconnect` es público. Además la clave es débil (14 bytes; mínimo recomendado 32). Cualquiera podría forjar tokens válidos. | Rotar clave (32+ bytes aleatorios), actualizar env de Login/Authorizers/Change-password, limpiar los scripts (y el historial git o hacer el repo privado). |
| B2 | **SES fuera del sandbox** | Sin producción SES no se puede enviar a destinatarios no verificados. Incluye verificar dominio remitente, DKIM, SPF, DMARC. | Consola SES (solicitud de production access) + DNS en GoDaddy. |
| B3 | **Desuscripción inexistente** | No hay link de baja en las plantillas ni header `List-Unsubscribe` ni endpoint público de baja. Es requisito de SES (riesgo de bloqueo de cuenta por quejas) y de buenas prácticas/habeas data (Ley 1581). Las tablas `{customer}_unsubscribe` ya existen y Prepare-batch ya filtra: **falta la puerta de entrada**. | Lambda pública `Unsubscribe` + ruta GET, link automático en el builder y header en los Send. |
| B4 | **Expiración de sesión sin manejar en el front** | El JWT dura 1 día y no hay refresh; cuando vence, las llamadas del panel fallan sin mensaje claro. | `apiClient`: ante 401/403 limpiar sesión y redirigir a `/login` con aviso. |
| B5 | **Checklist de consola pendiente** | Rutas + CORS `/Database/*`, GET proxy de `/Security/Acount-activation`, env vars (`SECRET_KEY`, `SENDER_EMAIL`, `ACTIVATION_URL`, `OTP_EXPIRATION_MIN`, URLs de redirección), tabla `databaseFile`, permisos IAM. | Consola AWS (lista detallada en Fase 1). |
| B6 | **Ruta del envío real sin verificar** | Confirmar que `/Email/Send-batch-template` y `/Email/Send-batch-template-samples` invocan `Api_V1_Email_Prepare-batch-template` y que la función stub sobreescrita no está en uso. | Consola API Gateway. |

### 🟠 Altas — primeras 2-3 semanas (pueden salir en caliente)

| # | Brecha | Detalle |
|---|--------|---------|
| A1 | **Listar campañas del cliente** | No existe `POST /Campaign/List`. Sin esto, Muestras exige escribir el nombre a mano, Campañas solo muestra lo creado en la sesión y Estadísticas usa datos demo. Es la pieza que más destraba el portal. |
| A2 | **Estadísticas reales** | Endpoint de agregados por campaña (proceso + conteos por estado). La lógica ya existe en `Api_V1_Agent_Reports` (status_summary, open_rate…): exponerla como endpoint del portal. |
| A3 | **Multi-tenant real** | Las lambdas confían en el `customerName`/`customerId` del body: un cliente autenticado podría operar a nombre de otro. Meter `customerId` como claim del JWT y que las lambdas lo tomen del token (el Authorizer ya lo decodifica). |
| A4 | **Refresh token** | Implementar `/Security/Refresh-token` (hoy stub) o decidir vivir con relogin diario. |
| A5 | **Lista negra funcional** | Ya se unificó el nombre `{customer}_blackList`, pero la tabla tiene PK `blackListId` y la consulta es por `email` → crear **GSI por email** (o migrar PK a email) y ajustar `check_blacklist`. |
| A6 | **Monitoreo y alarmas** | CloudWatch: errores por lambda, DLQ en colas SQS (hoy no hay DLQ), tasa de rebote SES > 5% y quejas > 0.1% (umbrales de suspensión de SES), presupuesto mensual AWS. |
| A7 | **Backups** | PITR (point-in-time recovery) en tablas globales de DynamoDB (`user`, `customer`, `campaign`, `process`…). |
| A8 | **Hosting del frontend** | Definir y montar: build de producción a S3 + CloudFront en `www.mailconnect.com.co` (o Amplify Hosting), `VITE_API_BASE_URL` de prod, workflow de deploy del front. |

### 🟡 Medias — post-salida

- CSV grandes (>100k) por partes; validación asíncrona.
- Estimador de costos pre-envío (criterio ya definido en `CLAUDE.md` §5).
- Portal admin: gestión de clientes (listar/editar/desactivar), plantillas prediseñadas compartidas.
- Plantillas PDF; `verify-code` (si el flujo lo necesita); paginación/búsqueda en tablas del panel.
- Segmentar IPs SES por cliente (IP dedicada solo si el volumen lo justifica: >100k/mes sostenido).

---

## 4. Plan de trabajo por fases

> **Convención de responsables:** `[C]` = Claude (código en el repo, se despliega
> solo al mergear) · `[J]` = Jhon (consolas AWS/Meta/GoDaddy, decisiones).

### Fase 0 — Seguridad urgente (1–2 días) 🔴

- [ ] `[J]` Generar nueva `SECRET_KEY` (32+ bytes aleatorios, p. ej. `python -c "import secrets; print(secrets.token_urlsafe(48))"`).
- [ ] `[J]` Actualizarla en las env de: `Login`, `Authorizer`, `Authorizer2`, `Change-password`.
- [ ] `[C]` Eliminar del repo los scripts con la clave (`prueba genera JWT.py`, `prueba jwt.py`) o dejarlos leyendo de env.
- [ ] `[J]` Decidir: hacer el repo **privado** (recomendado) o limpiar historial git (BFG/filter-repo). Mientras el repo sea público, TODO lo commiteado es público.
- [ ] `[J]` Confirmar que las access keys IAM (`consumoSQS`, `consumoS3`) no estén expuestas y rotarlas si hay duda (el archivo `DatosTrabajo.txt` **no** está en el repo — verificado — pero la rotación es barata).

### Fase 1 — MVP correo en producción (1–2 semanas) 🔴🟠

**Backend/código:**
- [ ] `[C]` **Desuscripción end-to-end:** lambda `Api_V1_Email_Unsubscribe` (GET público con token firmado por destinatario/campaña → inserta en `{customer}_unsubscribe` → página/redirect de confirmación); el builder agrega el link de baja automáticamente al pie; los Send agregan header `List-Unsubscribe`.
- [ ] `[C]` **`POST /Campaign/List`** (por `customerId`, devuelve campañas con estado) + conectar Campañas/Muestras (selector en vez de texto libre) y Estadísticas.
- [ ] `[C]` **Manejo de 401 en `apiClient`** → limpiar sesión + redirect a `/login`.
- [ ] `[C]` **GSI de lista negra** (código `check_blacklist` por índice `email`).
- [ ] `[C]` Ampliar pruebas: unsubscribe, campaign-list, prepare-batch (muestras selectivas ya corregidas).

**Consola AWS `[J]`:**
- [ ] Crear tabla `databaseFile` (PK `databaseFileId`) + lambdas `Api_V1_Database_Register-file` y `Api_V1_Database_List` + rutas `/Database/*` con CORS + permisos DynamoDB.
- [ ] Crear tabla/GSI: índice `email` en `{customer}_blackList` (o definir al crear las tablas dinámicas — se crean desde código, así que `[C]` ajusta `check_and_create_table`).
- [ ] Método **GET** en `/Security/Acount-activation` (proxy, sin authorizer) + redeploy.
- [ ] Env vars: `SECRET_KEY` (nueva), `SENDER_EMAIL`, `ACTIVATION_URL`, `ACTIVATION_SUCCESS/ERROR/EXPIRED_URL`, `OTP_EXPIRATION_MIN`.
- [ ] Verificar mapeo de rutas `/Email/Send-batch-template(-samples)` → `Prepare-batch-template`; revisar que `Api_V1_Email_Send-batch-template` (stub) no esté en uso y restaurar versión si algo la usa.
- [ ] **SES production access** + dominio verificado + DKIM + SPF + DMARC (GoDaddy).
- [ ] Ruta pública `GET /Email/Unsubscribe` (cuando `[C]` entregue la lambda).
- [ ] DLQ para las 3 colas SQS + alarmas CloudWatch (errores lambda, bounce/complaint rate, presupuesto).
- [ ] PITR en tablas globales DynamoDB.
- [ ] Hosting del front: S3+CloudFront (o Amplify) en `www.mailconnect.com.co`, `VITE_API_BASE_URL=https://api.mailconnect.com.co/V1`, certificado ACM.
- [ ] Probar E2E con un cliente piloto real (base pequeña, campaña EM completa).

**Criterio de salida de Fase 1 = MVP en producción** ✅

### Fase 2 — Operación estable + primer canal nuevo: SMS (2–4 semanas post-salida) 🟠

- [ ] `[C]` `POST /Security/Refresh-token` real + auto-refresh en `apiClient`.
- [ ] `[C]` Claims `customerId`/`customer` en el JWT + lambdas leyendo el cliente del token (multi-tenant).
- [ ] `[C]` Estadísticas con datos reales (endpoint de agregados reutilizando `Agent_Reports`).
- [ ] `[C+J]` **Canal SMS** (diseño en §5.2): lambda Send-SMS + cola + estados + front (form campaña con canal SMS y validación de celular en CSV).
- [ ] `[C]` Estimador de costos (email + SMS) según criterio de `CLAUDE.md` §5.
- [ ] `[J]` Decidir proveedor SMS definitivo con costos reales (AWS vs local) tras piloto.

### Fase 3 — WhatsApp y Voz (según demanda comercial) 🟡

- [ ] `[J]` Verificación del negocio en Meta + WABA + número dedicado (§5.3 — trámite lento: iniciarlo temprano).
- [ ] `[C+J]` Canal WhatsApp (plantillas HSM + envío + estados).
- [ ] `[C+J]` Canal Voz (TTS con Polly vía AWS End User Messaging Voice).
- [ ] CSV grandes por partes; portal admin de clientes; plantillas PDF.

---

## 5. Diseño de canales: SMS, WhatsApp y Voz

### 5.1 Patrón común multicanal (reusar lo que ya existe)

El pipeline actual de email **ya es el patrón correcto** para cualquier canal:

```
campaign (channel=XXX) → Prepare-batch (lee CSV de S3, filtra, divide)
  → SQS {canal}_Send-batch → Lambda Send-{canal} (llama la API del canal)
  → estados del proveedor → Lambda ReceptionStatus-{canal} → {customer}_sendStatus_{proceso}
```

Cambios comunes (una sola vez, habilitan todos los canales):
- **Tabla `channel`:** agregar `SMS`, `WSP`, `VOZ` con su tamaño de lote (SMS/WSP ~100 por mensaje SQS; VOZ ~50).
- **CSV:** mismas 3 primeras columnas (`Identificación;Contacto;Nombre`); para SMS/WSP/Voz la columna 2 es **celular E.164** (`+573001234567`). `csv.ts` del front valida email o celular según el canal elegido.
- **Prepare-batch:** ramificar la cola destino por canal (hoy solo enruta email); el filtrado de blacklist/unsubscribe se reusa igual.
- **Front:** selector de canal en el form de campaña limitado a los canales contratados por el cliente (nuevo atributo en `customer`).
- **Opt-in:** para SMS/WSP es obligación legal y de plataforma tener consentimiento demostrable de cada destinatario. Añadir al contrato del cliente la declaración de que su base tiene opt-in.

### 5.2 SMS

**Recomendación: empezar con AWS End User Messaging SMS** (antes Amazon Pinpoint SMS) — misma cuenta, misma facturación, sin contrato nuevo.

| Aspecto | Detalle |
|---|---|
| API | `pinpoint-sms-voice-v2` → `SendTextMessage` (boto3: cliente `pinpoint-sms-voice-v2`) |
| Remitente en Colombia | Sender ID dinámico (verificar reglas vigentes en la consola; Colombia históricamente no exige registro previo). Sin two-way en MVP. |
| Estados | Event destinations → CloudWatch Logs/SNS → lambda `Api_V1_Sms_ReceptionStatus` (mismo patrón que SES). Estados: enviado, entregado, fallido. |
| Costo aprox | ~USD $0.01–0.03 por SMS a Colombia (por segmento de 160 chars GSM-7 / 70 unicode). **Confirmar en la consola** — cambia por operador. |
| Infra nueva | Cola `Sms_Send-batch` + lambda `Api_V1_Sms_Send-batch` + ruta `/Sms` (ya existe en API Gateway, hoy sin backend en el repo). |

**Alternativa (plan B / costo):** proveedor local colombiano — **Hablame, Masiv (Masivian), Aldeamo, Infobip o Twilio**. Suelen tener mejor tarifa en COP y soporte local. La arquitectura no cambia: solo el cliente HTTP dentro de `Send-batch-SMS`. Decidir tras comparar el costo real por SMS del piloto AWS.

**Plantillas SMS:** texto plano de ≤160 caracteres con variables `{{nombre}}` (el builder HTML no aplica); pantalla simple de "Plantillas SMS" en el portal.

### 5.3 WhatsApp

**Recomendación: AWS End User Messaging Social** — integración nativa de la
WhatsApp Business Platform en AWS (disponible desde finales de 2024): se vincula la
cuenta de WhatsApp Business (WABA) desde la consola AWS, se envía con
`SendWhatsAppMessage` y los estados/mensajes entrantes llegan por SNS.

**Requisitos indispensables (cualquier proveedor) — trámites lentos, iniciar temprano:**
1. **Verificación del negocio** en Meta Business Manager (días a semanas).
2. **WABA** (WhatsApp Business Account) + **número dedicado** (no puede estar registrado en la app normal de WhatsApp).
3. **Plantillas de mensaje (HSM) pre-aprobadas por Meta** para todo envío saliente de marketing — texto con variables `{{1}}`, `{{2}}`, opcional imagen/botones. Meta las aprueba/rechaza en horas-días.
4. **Opt-in demostrable** de cada destinatario. Meta banea números por quejas.
5. Calidad del número (rating de Meta): empezar con volúmenes bajos; el límite diario crece con la reputación (1k → 10k → 100k destinatarios/día).

| Aspecto | Detalle |
|---|---|
| Costo | Tarifas de Meta por mensaje de plantilla de marketing (Colombia ~USD $0.01–0.03 por mensaje; **confirmar tarifario vigente de Meta**, cambió a cobro por mensaje en 2025) + fee pequeño de AWS por mensaje. |
| Alternativas | Meta Cloud API directo (gratis el API, pagas solo tarifas Meta) o un BSP: Twilio, Infobip, 360dialog, Gupshup. |
| Infra nueva | Cola `Wsp_Send-batch` + `Api_V1_Wsp_Send-batch` + `Api_V1_Wsp_ReceptionStatus` (SNS) + pantalla "Plantillas WhatsApp" en el portal (las plantillas viven en Meta; el portal guarda nombre + variables para mapear el CSV). |

### 5.4 Voz (llamadas con mensaje)

**Recomendación MVP de voz: AWS End User Messaging Voice** (antes Pinpoint Voice):
`SendVoiceMessage` reproduce un mensaje **TTS con Amazon Polly** (voces en español:
es-US "Lupe/Pedro", es-MX "Mia" — no hay es-CO; Lupe suena bien para Colombia) o un
**audio pregrabado** (SSML). Requiere comprar un **número de origen** en AWS
(verificar disponibilidad de números colombianos en la consola; si no hay,
evaluar Twilio para la originación).

| Aspecto | Detalle |
|---|---|
| Uso típico | Recordatorios de pago, avisos masivos, encuestas simples (con DTMF sería fase posterior). |
| Costo aprox | ~USD $0.013–0.05 por minuto saliente a Colombia (fijo vs móvil) + costo del número (~USD $1–3/mes). **Confirmar en consola.** |
| Infra nueva | Cola `Voice_Send-batch` + `Api_V1_Voice_Send-batch` + estados por event destinations. |
| Escalada futura | Si se necesita IVR/agentes/marcador predictivo → **Amazon Connect** (campañas salientes). Mucho más completo y más costoso; no para MVP. |
| Alternativa | Twilio Programmable Voice (madura, buena documentación, números CO disponibles). |

### 5.5 Orden recomendado de canales

1. **SMS** primero: trámite cero (AWS directo), demanda comercial típica alta, reusa el 90% del pipeline.
2. **WhatsApp** segundo: el trámite Meta es lento → **iniciar la verificación del negocio ya** aunque el desarrollo venga después.
3. **Voz** tercero: nicho más específico; validar demanda con clientes antes de construir.

---

## 6. Resumen ejecutivo (qué hacer ya)

1. **Hoy:** rotar `SECRET_KEY` + repo privado o limpieza de scripts (Fase 0).
2. **Esta semana:** checklist de consola AWS (rutas/env/tabla `databaseFile`) + solicitud de **producción SES** (demora ~24-48h) + empezar desuscripción y Campaign/List en código.
3. **Próximas 2 semanas:** cerrar Fase 1 → piloto con un cliente real → **salida MVP**.
4. **En paralelo (trámite lento):** iniciar verificación del negocio en **Meta** para tener WhatsApp listo en Fase 3.
5. **Post-salida:** SMS (Fase 2) con AWS End User Messaging y comparar costos con proveedor local.
