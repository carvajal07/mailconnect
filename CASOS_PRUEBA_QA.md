# Casos de Prueba (CP) — QA MailConnect

> Lista de casos de prueba **funcionales / de calidad** para lo construido hasta ahora,
> incluido el **portal de pagos (prepago)** que está planificado (ver `PLAN_PREPAGO.md`).
> Formato para ejecución manual por QA. Complementa las pruebas automáticas de
> `08_Pruebas/PruebasSeguridad/` (pytest+moto).

## Cómo leer esta lista
- **ID:** `CP-<módulo>-<n>`.
- **Prioridad:** 🔴 Alta (crítico) · 🟡 Media · 🟢 Baja.
- **Estado (P):** ✅ implementado y testeable hoy · 🧩 planificado (portal de pagos — aún no existe).
- **Roles:** `cliente` (usuario de empresa) · `admin` (personal MailConnect).
- **Precondición** común salvo que se diga otra cosa: usuario válido, sesión iniciada con el rol indicado.

---

## 1. Seguridad / Autenticación  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-SEG-01 | 🔴 | Registro exitoso | Registrar con datos válidos + aceptar términos | 201; usuario creado **inactivo**; llega correo de activación; `role=client`; `realSendEnabled=false` (opt-in) |
| CP-SEG-02 | 🟡 | Registro email duplicado | Registrar con un email ya existente | 409, no se crea |
| CP-SEG-03 | 🟡 | Registro teléfono/datos inválidos | Teléfono no numérico / NIT vacío | 400 |
| CP-SEG-04 | 🔴 | Activación de cuenta | Abrir el enlace de activación del correo | Redirect a éxito; la cuenta queda activa |
| CP-SEG-05 | 🟢 | Activación con clave vencida/errada | Usar un `qs` inválido | Redirect a error/expirado |
| CP-SEG-06 | 🔴 | Login exitoso | Login con credenciales correctas de cuenta activa | 200; devuelve token, `role`, `customer`, `customerId`, `realSendEnabled` |
| CP-SEG-07 | 🔴 | Login contraseña incorrecta | Contraseña errada | 404 genérico ("usuario o contraseña incorrectos") |
| CP-SEG-08 | 🟡 | Login usuario inexistente | Email que no existe | 404 genérico; **tiempo de respuesta similar** al de contraseña errada (anti-enumeración) |
| CP-SEG-09 | 🟡 | Login cuenta inactiva | Cuenta sin activar | 423 |
| CP-SEG-10 | 🔴 | **Auditoría de seguridad — ingreso** | Login exitoso → revisar tab Auditoría | Aparece `security.login` "Ingreso exitoso (IP …)" y `security.token` "Token emitido" con el correo como actor |
| CP-SEG-11 | 🟡 | **Auditoría — contraseña incorrecta** | Login con clave errada → Auditoría | `security.login` "Contraseña incorrecta (IP …)" |
| CP-SEG-12 | 🟡 | **Auditoría — usuario inexistente** | Login con email inexistente → Auditoría | `security.login` "Intento con usuario inexistente" |
| CP-SEG-13 | 🟡 | **IP del usuario** | Tras configurar el mapping template del login, hacer login | La IP se guarda en sesión/auditoría (no "unknown") |
| CP-SEG-14 | 🟡 | Recuperación de contraseña | `forgot-password` con email existente y con uno inexistente | **Siempre 200 genérico**; al existente le llega OTP |
| CP-SEG-15 | 🔴 | Reseteo con OTP | Pantalla reset: OTP correcto + nueva clave fuerte | 200; puede loguear con la nueva clave |
| CP-SEG-16 | 🟡 | Reseteo clave débil no consume OTP | OTP válido + clave débil | 400 por clave débil; el OTP **sigue válido** |
| CP-SEG-17 | 🟡 | OTP expirado / inválido | Validar OTP vencido o errado | 410 (expirado) / 401 (inválido) |
| CP-SEG-18 | 🟡 | Cambio de contraseña logueado | Mi cuenta → cambiar con token válido | 200 |
| CP-SEG-19 | 🟡 | Refresh token deslizante | Sesión activa con token < 1h de vida | Se renueva en segundo plano; el rol se re-valida contra BD |
| CP-SEG-20 | 🟡 | Sesión expirada | Token vencido y pegar a la API | Limpia sesión y redirige a `/login` con aviso |
| CP-SEG-21 | 🟡 | Inactividad | Dejar el portal inactivo > VITE_IDLE_MINUTES | Cierre automático con aviso |
| CP-SEG-22 | 🔴 | Authorizer deniega token inválido | Llamar una ruta protegida con token adulterado/otra clave | 401/403 (deniega por defecto) |
| CP-SEG-23 | 🟢 | `verify-code` eliminado | Buscar la ruta/lambda `Verify-code` | No existe; no hay referencias en el front (`authService.verifyCode`) |

---

## 2. Auditoría (admin)  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-AUD-01 | 🔴 | Solo admin | Abrir `/Admin/Audit` como cliente | 403 / no visible |
| CP-AUD-02 | 🟡 | Tabla sin datos | Cuenta sin acciones registradas | Lista vacía (no error) |
| CP-AUD-03 | 🔴 | **Tarifas: solo el campo cambiado** | Cambiar solo `baseEM` (el form reenvía todos) → Auditoría | Detalle muestra **solo** `baseEM: X → Y`, no los demás campos |
| CP-AUD-04 | 🔴 | **Tarifas: nombre de empresa** | Editar override de un cliente → Auditoría | Objetivo = **nombre de empresa** (o "Global"), no el `customerId` |
| CP-AUD-05 | 🔴 | **Rol: objetivo legible** | Promover/degradar un usuario → Auditoría | Objetivo = **correo** del usuario; detalle `rol_anterior → rol_nuevo` |
| CP-AUD-06 | 🟡 | Envíos por cliente | Toggle realSendEnabled desde la ficha → Auditoría | `customer.realSend` con empresa y `habilitados → deshabilitados` |
| CP-AUD-07 | 🟡 | Config | Cambiar `OTP_EXPIRATION_MIN` → Auditoría | `config.set` con `valor_anterior → nuevo` |
| CP-AUD-08 | 🟡 | Creación de campaña/plantilla | Crear campaña / plantilla HTML / SMS → Auditoría | `campaign.create` / `template.create` / `messageTemplate.create` con el actor |
| CP-AUD-09 | 🟡 | Envío de muestras / real | Enviar muestras y envío real → Auditoría | `send.samples` / `send.real` con quién y la campaña |
| CP-AUD-10 | 🟢 | Filtros | Filtrar por mes / acción / actor | La tabla filtra correctamente; dropdown de acciones se puebla solo |
| CP-AUD-11 | 🟢 | Fecha local | Revisar la columna Fecha | Se muestra en hora local (no UTC cruda) |

---

## 3. Panel admin  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-ADM-01 | 🔴 | Cliente no entra a `/admin` | Loguear como cliente e ir a `/admin` | Redirige a `/panel` |
| CP-ADM-02 | 🔴 | **Precarga de clientes** | Login admin → abrir Clientes/Facturación/Tarifas | La lista de clientes ya está lista (no re-pide `/Customer/List` al entrar a cada tab) |
| CP-ADM-03 | 🔴 | **Facturación no da timeout** | Abrir tab Facturación con varios clientes | Carga en tiempo razonable; **no** deja la página en blanco |
| CP-ADM-04 | 🔴 | **Trabajos no da timeout** | Abrir tab Trabajos | Carga; no queda en blanco |
| CP-ADM-05 | 🔴 | **ErrorBoundary** | Forzar respuesta malformada/parcial de un tab | Muestra aviso acotado con "Reintentar"; **el resto del panel sigue** |
| CP-ADM-06 | 🟡 | Tab "Envíos por cliente" eliminado | Revisar el sidebar | Ya no existe; el toggle vive en la ficha de Clientes |
| CP-ADM-07 | 🔴 | Ficha de cliente | Abrir ficha: datos + usuarios + toggle envíos + promover admin | Todo funciona; no degradar al **último** admin (409) |
| CP-ADM-08 | 🔴 | **Campañas admin: columna cliente** | Abrir tab Campañas (admin) | Se ven campañas de **todas** las empresas con su columna de cliente |
| CP-ADM-09 | 🔴 | **Campañas admin: filtros locales** | Aplicar filtros mes/estado/cliente/canal/búsqueda | Filtran al instante **sin** re-llamar al backend en cada cambio |
| CP-ADM-10 | 🟡 | Dashboard | Abrir Panel de control | KPIs, embudo, volumen por canal y salud por cliente (riesgo primero) |
| CP-ADM-11 | 🟡 | Tarifas global vs cliente | Editar global (`*`) y override de un cliente | Chips heredado/propio correctos; se guarda |
| CP-ADM-12 | 🟡 | Configuración | Cambiar `SENDER_EMAIL` y validar | Aplica sin redesplegar (las lambdas leen con fallback) |

---

## 4. Portal cliente — Plantillas y Campañas  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PT-01 | 🔴 | Constructor HTML | Crear plantilla con bloques, ajustes, vista previa, publicar | Se publica en SES; HTML responsive/cross-client |
| CP-PT-02 | 🟡 | Plantillas SMS/WhatsApp/DOCX | Crear cada tipo con su modelo | Se guardan en `messageTemplate`; picker de variables funciona |
| CP-PT-03 | 🔴 | Crear campaña | Crear campaña (canal, plantilla, base del selector, from) | 201; aparece en la lista |
| CP-PT-04 | 🔴 | **Editar campaña no re-lista plantillas** | Abrir/cerrar el diálogo de editar varias veces (con DevTools abierto) | Las plantillas SMS/WSP salen del contexto; las SES se piden **una sola vez** (no en cada apertura) |
| CP-PT-05 | 🟡 | Editar solo estado Pendiente | Intentar editar una campaña no-Pendiente | Bloqueado (409) |
| CP-PT-06 | 🟡 | Selector de base | En crear/editar, elegir base del selector | Fija su `s3Path`; no hay texto libre |
| CP-PT-07 | 🔴 | **Consecutivo único (concurrencia)** | Crear 2 campañas del mismo cliente casi simultáneas | Consecutivos **distintos** (no duplicados) |
| CP-PT-08 | 🟢 | Consecutivo siembra legado | Cliente con consecutivo previo `0007` crea nueva | Siguiente = `0008` (no reinicia en `0001`) |

---

## 5. Portal cliente — Bases de datos (CSV + Excel)  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-BD-01 | 🔴 | Carga CSV válido | Subir CSV con estructura `id;contacto;nombre` | Preview OK; válidos/inválidos/duplicados correctos; 3 checks verdes; aparece en la tabla |
| CP-BD-02 | 🔴 | **Carga Excel .xlsx** | Subir un `.xlsx` plano (primera hoja) | Se lee la 1ª hoja, se convierte a CSV, sube el `.csv`; preview igual que CSV |
| CP-BD-03 | 🟡 | **Excel: delimitador fijo** | Con Excel cargado, revisar el selector de delimitador | Deshabilitado, fijo en `;` con aviso |
| CP-BD-04 | 🟡 | **Excel: número como texto** | Excel con celular guardado como número | Aviso visible; si pierde `+`/ceros, el contador lo marca inválido (auto-corrige formateando como Texto) |
| CP-BD-05 | 🟡 | Estructura inválida | CSV/Excel con columnas fuera de orden | Aviso de estructura; no deja subir hasta corregir |
| CP-BD-06 | 🟡 | Canal → tipo de contacto | Cambiar canal a SMS/WhatsApp/Voz | La columna 2 se valida como **celular E.164**; en EMAIL como correo |
| CP-BD-07 | 🟡 | Registro tras subir | Subir base | 3er check "registrar" verde; aparece en el tab y en selectores |
| CP-BD-08 | 🟡 | Fallo de registro visible | Simular fallo en `/Database/Register-file` | 3er check en rojo con detalle; diálogo no se cierra |
| CP-BD-09 | 🟢 | Eliminar base | Papelera en la tabla | Borra el registro (no el CSV en S3); verifica tenant |
| CP-BD-10 | 🟢 | Columns para variables | Subir base y abrir picker de variables | Los encabezados aparecen como `{{variables}}` |

---

## 6. Portal cliente — Muestras, Envío real, Reportes, Estadísticas  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-MU-01 | 🔴 | Envío de muestras | Configurar 1–5 muestras (aleatorias/selectivas) y enviar | Llega a los correos de prueba; campaña queda en `Muestras` |
| CP-MU-02 | 🟡 | Límite de muestras | Enviar muestras 6 veces en la misma campaña | Bloquea al 6º (429); chip "usados/quedan" |
| CP-MU-03 | 🔴 | Aprobar y envío real | Aprobar → Enviar campaña real | Estado `Enviando`; se procesa la base completa |
| CP-MU-04 | 🔴 | Bloqueo por realSendEnabled | Cliente con `realSendEnabled=false` intenta envío real | 403 con aviso; muestras sí permitidas |
| CP-MU-05 | 🔴 | **Estimador de costo** | Ver `CostEstimate` antes de enviar | Muestra costo unit, subtotal, IVA, mínimo, por canal |
| CP-MU-06 | 🔴 | **Tarifa por cliente en el estimador** | Admin fija override para el cliente X; X abre su estimador | Aplica la tarifa de X (no la global); el `customerId` sale del **token**, no del body |
| CP-MU-07 | 🟢 | Reportes / estado por campaña | Exportar resumen CSV y reporte de estado | Descarga CSV; preview correcto |
| CP-EST-01 | 🟡 | Estadísticas | Abrir Estadísticas | KPIs, dona por estado, embudo, tabla por campaña con datos reales |

---

## 7. Envíos multicanal + estados de entrega  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-CH-01 | 🔴 | Correo EM | Enviar campaña EM real | Llega; pie con enlace de **desuscripción** funcional |
| CP-CH-02 | 🔴 | Correo EAU adjunto | Campaña EAU con adjunto | Llega con adjunto + headers `List-Unsubscribe`; `{{unsubscribeUrl}}` reemplazada |
| CP-CH-03 | 🔴 | **Correo EAP desuscripción** | Campaña EAP (adjunto personalizado) | `{{unsubscribeUrl}}` reemplazada por destinatario + headers List-Unsubscribe (antes llegaba el literal) |
| CP-CH-04 | 🔴 | Desuscripción end-to-end | Clic en el enlace de baja de un correo | Página de confirmación; el email entra a `{customer}_unsubscribe` |
| CP-CH-05 | 🔴 | Filtro de desuscritos | Enviar de nuevo a un desuscrito | Excluido en el envío real |
| CP-CH-06 | 🟡 | SMS | Campaña SMS con texto/variables | Llega; estado registrado; reportes reflejan |
| CP-CH-07 | 🟡 | WhatsApp (envío) | Campaña WSP con plantilla HSM | Llega; se registra estado `enviado` |
| CP-CH-08 | 🔴 | **WhatsApp recepción** | Simular recibo de Meta (delivered/read/failed) por la SNS | El estado se escribe en `sendStatus` vía `messageIndex`; estadísticas muestran entregado/leído |
| CP-CH-09 | 🟡 | WhatsApp recibo sin índice | Recibo con messageId no indexado | Se cuenta "sin índice", no rompe, no escribe estado |
| CP-CH-10 | 🟡 | SMS/Voz recepción | Eventos EUM por SNS | Estados 1/2/3 en `sendStatus`; estadísticas reflejan |
| CP-CH-11 | 🟡 | Voz | Campaña de voz (TTS) | Llamada con mensaje; estado registrado |
| CP-CH-12 | 🟡 | Lista negra | Contacto en `{customer}_blackList` | Excluido del envío real; gestión desde el portal (add/list/delete) |

---

## 8. Trabajos — Reintentar / Reencolar  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-RQ-01 | 🔴 | Botón visible solo si aplica | Ver la columna Acciones en Trabajos | "Reintentar" solo en envíos troceados **no terminados** con partes pendientes |
| CP-RQ-02 | 🔴 | Reencola solo pendientes | Proceso con partes 1 hecha, 2 y 3 pendientes → Reintentar | Reencola **solo** 2 y 3; mensaje "Reencoladas 2 partes" |
| CP-RQ-03 | 🔴 | Idempotencia (no re-envía) | Reintentar dos veces | Las partes ya hechas se **saltan**; no se duplican envíos |
| CP-RQ-04 | 🟡 | Sin partes pendientes | Proceso completo → Reintentar | "No hay partes pendientes" (requeued=0) |
| CP-RQ-05 | 🟡 | Proceso viejo sin `resumeCtx` | Reintentar un proceso creado antes de la función | 409 "sin contexto de reanudación" |
| CP-RQ-06 | 🟡 | Solo admin | Llamar `/Admin/Requeue` como cliente | 403 |

---

## 9. Rendimiento / escalabilidad  ✅ (verificación técnica)

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PERF-01 | 🟡 | Login por GetItem | Login normal (tras convertir scans→GetItem) | Funciona; en CloudWatch, `select_client`/`select_name` sin Scan de tabla completa |
| CP-PERF-02 | 🟡 | Login GSI por email | Con `USER_EMAIL_GSI` y el GSI creado | Login usa Query O(1); sin el env, cae a Scan **paginado** (sigue funcionando) |
| CP-PERF-03 | 🟡 | GSI de campañas | Con `USE_GSI=true` + `customerId-index` en `campaign` | `Campaign/List` y `Portal/Bootstrap` usan Query; sin ellos, Scan paginado |
| CP-PERF-04 | 🟡 | Billing sin timeout a escala | Facturación con muchas campañas/procesos | 3 scans totales (no 1+2·C); responde sin timeout |
| CP-PERF-05 | 🟢 | sendSummary O(1) | Con `SEND_SUMMARY_READ=true` + backfill | Estadísticas/Billing/Jobs leen el resumen; sin él, caen al scan (mismo resultado) |
| CP-PERF-06 | 🟢 | Base grande (fan-out) | Envío real con base 100k+ | Se trocea en part-files; no hay timeout de 15 min; idempotente |

---

## 10. 🧩 Portal de pagos — Prepago (PLANIFICADO, ver `PLAN_PREPAGO.md`)

> CPs para cuando se implemente el MVP prepago. Hoy **no** existen estas pantallas/endpoints.

### 10.1 Saldo y visualización
| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PAY-01 | 🔴 | Ver saldo | Cliente abre sección Saldo | Muestra saldo actual (COP) + historial de movimientos |
| CP-PAY-02 | 🟡 | Saldo precargado | Login → entrar al portal | El saldo ya está disponible (precarga/bootstrap), sin espera |
| CP-PAY-03 | 🟡 | Historial (ledger) | Ver movimientos | Cada cambio de saldo tiene su `walletTransaction` (recarga/débito/reembolso) con saldo resultante |

### 10.2 Recarga manual (comprobante + revisión/aprobación)
| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PAY-04 | 🔴 | Cliente registra solicitud | Cliente: "Registrar recarga" → monto + banco/referencia + **subir comprobante** | Se crea solicitud `topup_manual` **pending** con `proofS3Path`; el saldo **no** cambia aún |
| CP-PAY-05 | 🔴 | Admin aprueba | Admin abre la bandeja, ve el comprobante, **Aprobar** | Saldo sube $X; tx `approved`; se audita `balance.topup.approve` |
| CP-PAY-06 | 🔴 | Admin rechaza | Admin **Rechazar** con motivo | Saldo **no** cambia; tx `declined` con motivo; se audita `balance.topup.reject` |
| CP-PAY-07b | 🔴 | Idempotencia aprobar | Aprobar la misma solicitud dos veces (doble clic) | Acredita **una sola vez** (condición `status='pending'`) |
| CP-PAY-08b | 🟡 | Cliente ve el estado | Cliente revisa su historial tras aprobación/rechazo | Ve pendiente → aprobada / rechazada (con motivo) |
| CP-PAY-09b | 🟡 | Solo admin aprueba | Cliente intenta aprobar/rechazar | 403 |
| CP-PAY-10b | 🟢 | Comprobante obligatorio / monto inválido | Solicitud sin comprobante o monto 0/negativo | 400 |

### 10.3 Recarga Wompi
| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PAY-07 | 🔴 | Iniciar recarga | Cliente pide recargar $X | Se crea tx `pending` + firma de integridad correcta para el Widget |
| CP-PAY-08 | 🔴 | Pago aprobado (webhook) | Wompi envía webhook `APPROVED` con firma válida | Acredita el saldo **una sola vez**; tx pasa a `approved` |
| CP-PAY-09 | 🔴 | Idempotencia webhook | Reenviar el mismo webhook aprobado | **No** vuelve a acreditar (condición `pending→approved`) |
| CP-PAY-10 | 🔴 | Firma inválida | Webhook con checksum errado | 401; **no** acredita |
| CP-PAY-11 | 🟡 | Pago rechazado | Webhook `DECLINED` | No acredita; tx `declined` |
| CP-PAY-12 | 🔴 | No confiar en el redirect | Manipular el redirect del navegador "como aprobado" | El saldo **no** cambia (solo el webhook/API server-to-server acredita) |
| CP-PAY-13 | 🟢 | Monto mínimo | Recargar por debajo del mínimo (20.000) | Bloqueado con aviso |

### 10.4 Débito por envío + bloqueo (en Prepare-batch)
| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PAY-14 | 🔴 | Débito con saldo suficiente | Envío real con saldo ≥ costo | Debita el costo (atómico); crea `debit_send`; encola el envío |
| CP-PAY-15 | 🔴 | Bloqueo por saldo insuficiente | Envío real con saldo < costo | `InsufficientBalance` → 402; **no** se trocea; el lock se libera; saldo intacto |
| CP-PAY-16 | 🔴 | UI bloquea + backend bloquea | Con saldo < costo, ver el botón "Enviar real" | Deshabilitado con aviso "saldo insuficiente" + enlace a Recargar; y si se fuerza la API, 402 |
| CP-PAY-17 | 🔴 | No doble cobro (idempotencia) | Reintento del mismo envío (AlreadySending) | **No** vuelve a debitar |
| CP-PAY-18 | 🔴 | Concurrencia sin saldo negativo | Dos campañas del mismo cliente casi simultáneas con saldo justo para una | Solo una debita/envía; el saldo **nunca** queda negativo |
| CP-PAY-19 | 🟡 | Compensación por fallo | Débito OK pero el troceo/encolado falla | Se **reembolsa** (`refund_send`); campaña en `Error` |
| CP-PAY-20 | 🟡 | Muestras no debitan | Enviar muestras | El saldo **no** cambia |
| CP-PAY-21 | 🟡 | Mínimo por campaña | Envío chico por debajo de `minCampaign` | Debita `max(costo, minCampaign)` (igual que el estimador) |
| CP-PAY-22 | 🟢 | Costo consistente con estimador | Comparar el débito con lo que mostró `CostEstimate` | Coinciden (misma fórmula/tarifas) |

---

## 11. Regresión / transversales

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-REG-01 | 🔴 | Aislamiento multi-tenant | Cliente A intenta ver datos de B (campañas/bases/stats) | Nunca ve datos de otro (tenant del token) |
| CP-REG-02 | 🟡 | Suite automática | Correr `pytest 08_Pruebas/PruebasSeguridad` | Todo verde |
| CP-REG-03 | 🟡 | Build del front | `npm run build` | Compila sin errores de TypeScript |
| CP-REG-04 | 🟢 | Tema claro/oscuro | Alternar tema en portal y admin | Legible en ambos; sin colores hardcodeados rotos |
| CP-REG-05 | 🟢 | Responsive | Portal/admin en móvil | Sin scroll horizontal roto; tablas con scroll propio |

---

### Notas para QA
- Los CP marcados 🧩 dependen de implementar el **MVP prepago** (`PLAN_PREPAGO.md`).
- Para los CP de **recepción** (WhatsApp/SMS/Voz) y **webhook Wompi**, usar payloads simulados
  (o `08_Pruebas/PruebasSeguridad/test_wsp_reception.py` como referencia del formato).
- Muchos CP tienen su equivalente automático en `08_Pruebas/PruebasSeguridad/`; esta lista cubre
  además el **flujo de UI end-to-end** que las pruebas unitarias no ejercen.
