# Casos de Prueba (CP) — QA MailConnect

> Lista de casos de prueba **funcionales / de calidad** de todo lo construido.
> Formato para ejecución manual por QA. Complementa las pruebas automáticas de
> `08_Pruebas/PruebasSeguridad/` (pytest+moto, backend) y
> `05_Frontend/Front/page/src/components/portal/__tests__/` (vitest, frontend).
>
> **Planilla de ejecución:** `CASOS_PRUEBA_QA.xlsx` (en la raíz) tiene un CP por fila con
> columnas para marcar **Pasó / No pasó**, el resultado obtenido y observaciones. Se genera
> desde este archivo con `scripts/casos_prueba_xlsx.py`, así que **este .md es la fuente de
> verdad**: al agregar un CP aquí, se vuelve a correr el script y la planilla queda al día.

## Cómo leer esta lista
- **ID:** `CP-<módulo>-<n>`.
- **Prioridad:** 🔴 Alta (crítico) · 🟡 Media · 🟢 Baja.
- **Estado (P):** ✅ implementado y testeable hoy · 🧩 pendiente de despliegue.
- **Ojo con los `[J]` de `DESPLIEGUE.md`:** hay funciones construidas cuyo endpoint todavía
  no está desplegado o le falta un permiso IAM. Si un CP falla con 403/404 de ruta, revisar
  primero ahí antes de reportarlo como defecto.
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
| CP-SEG-35 | 🔴 | **Teléfono solo dígitos** | En el registro, escribir `abc300-123.456` en Teléfono | Queda `300123456`: las letras y los símbolos no entran |
| CP-SEG-36 | 🔴 | **Teléfono tope de 15** | Pegar 25 dígitos en Teléfono | Se corta en 15 |
| CP-SEG-37 | 🔴 | **NIT solo dígitos, tope 15** | Mismo ejercicio en el campo NIT | Solo dígitos, máximo 15 |
| CP-SEG-38 | 🟡 | Mínimos de longitud | Teléfono de 5 dígitos / NIT de 3 → enviar | Avisa "al menos 7 dígitos" / "al menos 5 dígitos"; no llama a la API |

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

## 10. 🧩 Portal de pagos — Prepago (implementado; ver la sección Prepago en `CLAUDE.md`)

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

## 11. Constructor de correos HTML  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-HTML-01 | 🔴 | Texto enriquecido en el lienzo | Escribir en un bloque de texto y aplicar negrita, cursiva, color y tamaño desde la barra flotante | El formato se ve en el lienzo y llega igual al HTML publicado |
| CP-HTML-02 | 🔴 | **El cursor no salta al inicio** | Poner el cursor al FINAL de un texto existente y escribir 5-6 caracteres | El texto se agrega al final; el cursor NO salta al principio en ninguna tecla |
| CP-HTML-03 | 🔴 | Pegado como texto plano | Copiar un párrafo con formato desde Word y pegarlo en un bloque | Entra sin estilos de Word; no aparecen `<div>`/`<font>` raros en "Ver HTML" |
| CP-HTML-04 | 🔴 | Saneamiento del HTML crudo | Pegar `<script>alert(1)</script><p>ok</p>` en un bloque de HTML crudo | El `<p>` se conserva; el `<script>` NO aparece en el HTML publicado |
| CP-HTML-05 | 🟡 | Enlace dentro de un párrafo | Seleccionar una palabra y aplicar "Insertar enlace" | Queda como `<a href>` en el HTML; `javascript:` se descarta |
| CP-HTML-06 | 🟡 | Compatibilidad con plantillas viejas | Cargar una plantilla guardada antes del texto enriquecido que contenga `5 < 10` | Se ve `5 < 10` (escapado), no se rompe el bloque |
| CP-HTML-07 | 🔴 | Variables con valor por defecto | Menú Variable → "Con valor por defecto" → campo `nombre`, respaldo "cliente" | Inserta `{{#if nombre}}{{nombre}}{{else}}cliente{{/if}}` |
| CP-HTML-08 | 🔴 | **Variable con respaldo en envío REAL** | Publicar con esa variable y enviar una muestra a un registro con el campo VACÍO | Llega "Hola cliente", no "Hola ," ni el token en crudo (lo resuelve SES) |
| CP-HTML-09 | 🟡 | Relleno, fondo y tamaño por bloque | Configurar relleno vertical/horizontal, fondo y tamaño de fuente en un bloque | Se ve igual en el lienzo y en el correo publicado |
| CP-HTML-10 | 🟡 | Imagen con enlace | Bloque de imagen con "Enlace al hacer clic" | La imagen queda clicable en el correo |
| CP-HTML-11 | 🔴 | Imagen vacía se omite | Agregar bloque de imagen sin subir nada y publicar | El correo NO trae `<img>` roto; "Revisar" lo reporta como error |
| CP-HTML-12 | 🔴 | Columnas: slider 1-4 | Bloque de columnas → mover el slider y elegir distribución | Las celdas nacen VACÍAS con un "+"; se aplican los anchos elegidos |
| CP-HTML-13 | 🔴 | Soltar un bloque en el "+" | Arrastrar un bloque de la paleta al "+" de una columna | Entra en esa celda; se puede seleccionar y editar dentro |
| CP-HTML-14 | 🟡 | Mover un bloque del lienzo a una columna | Arrastrar un bloque ya existente al "+" de una celda | Sale del nivel superior y entra en la columna (una sola operación) |
| CP-HTML-15 | 🟡 | Reducir columnas no borra contenido | Con 3 columnas llenas, bajar el slider a 2 | El contenido de la que desaparece se mueve a la última, no se pierde |
| CP-HTML-16 | 🟡 | Bloques no anidables | Intentar meter Columnas/Productos/Redes dentro de una celda | No se ofrecen en el menú del "+" |
| CP-HTML-17 | 🟡 | Zona final del lienzo | Con varios bloques, usar el área punteada del final | Se puede soltar ahí y "Agregar bloque" abre el menú y agrega al final |
| CP-HTML-18 | 🔴 | Modo oscuro | Activar "Modo oscuro" en Ajustes y publicar | El HTML trae `prefers-color-scheme`; sin activarlo NO aparece |
| CP-HTML-19 | 🔴 | Chequeo previo ("Revisar") | Plantilla con imagen sin alt, enlace `https://` y sin preheader | Lista los 3 problemas con su nivel (error/aviso/info) |
| CP-HTML-20 | 🔴 | **Chequeo detecta gritos** | Escribir `GRATIS!!! OFERTA!!!` en el cuerpo → Revisar | Avisa "Mayúsculas sostenidas o signos repetidos **en el cuerpo del correo**" |
| CP-HTML-21 | 🟡 | Gritos en el preheader | Poner `ULTIMA OPORTUNIDAD` como preheader → Revisar | Avisa señalando el texto de vista previa |
| CP-HTML-22 | 🟡 | Variables en mayúsculas NO son gritos | Texto con `{{NOMBRE}}` y `{{CIUDAD}}` → Revisar | NO dispara el aviso de mayúsculas |
| CP-HTML-23 | 🟡 | Peso > 102 KB | Plantilla muy pesada (mucho HTML crudo) → Revisar | Avisa del recorte de Gmail con el peso real |
| CP-HTML-24 | 🟡 | Contraste bajo | Texto gris muy claro sobre fondo blanco → Revisar | Avisa de contraste < 4.5:1 |
| CP-HTML-25 | 🟡 | Texto menor a 14 px | Bloque con tamaño 11 px → Revisar | Avisa de legibilidad en móvil |
| CP-HTML-26 | 🔴 | **Enviarme una prueba** | Botón "Enviarme una prueba" con el correo del propio usuario | Llega el correo con el diseño actual; no crea campaña ni publica |
| CP-HTML-27 | 🔴 | **Anti-relay de la prueba** | Intentar enviar la prueba a un correo que NO es de un usuario del tenant | Rechazado (403/400): solo correos de usuarios activos del mismo cliente |
| CP-HTML-28 | 🟡 | Tope diario de pruebas | Enviar pruebas por encima del límite diario | 429 con mensaje claro |
| CP-HTML-29 | 🔴 | Deshacer / rehacer | Hacer varios cambios y usar Ctrl+Z / Ctrl+Shift+Z | Vuelve paso a paso; escribir NO crea un paso por tecla |
| CP-HTML-30 | 🟡 | Ctrl+Z no secuestra la escritura | Estando dentro de un texto, pulsar Ctrl+Z | Deshace en el texto, no elimina el bloque |
| CP-HTML-31 | 🔴 | **Atajos: Supr no borra mientras se escribe** | Con el cursor dentro de un texto, borrar una letra con Supr/Retroceso | Borra la letra; NO elimina el bloque completo |
| CP-HTML-32 | 🟡 | Atajos: duplicar y mover | Seleccionar un bloque → Ctrl+D, Alt+↑, Alt+↓, Supr, Esc | Duplica, mueve, elimina y quita la selección |
| CP-HTML-33 | 🟢 | Lista de atajos visible | Botón ⌨ de la barra | Muestra la lista completa de atajos |
| CP-HTML-34 | 🟡 | Autoguardado y recuperación | Editar, cerrar la pestaña sin guardar y volver a entrar | Ofrece recuperar el trabajo |
| CP-HTML-35 | 🔴 | Guardar diseño en el backend | "Guardar plantilla" con un nombre nuevo | Queda en la galería y la ve OTRO usuario del mismo cliente |
| CP-HTML-36 | 🔴 | **Guardar con nombre existente VERSIONA** | Guardar dos veces con el mismo nombre | NO se crea una copia en la galería; la versión anterior queda en el historial |
| CP-HTML-37 | 🔴 | Restaurar una versión | Galería → icono de historial → "Restaurar" en una versión anterior | Se carga en el lienzo; queda vigente solo si se vuelve a guardar |
| CP-HTML-38 | 🟡 | Duplicar plantilla | Galería → "Duplicar" | Crea una copia con nombre propio; el original no cambia |
| CP-HTML-39 | 🟡 | Tope de 10 versiones | Guardar 12 veces con el mismo nombre | El historial conserva las 10 más recientes |
| CP-HTML-40 | 🔴 | Diseño de otro cliente | Intentar versionar por id una plantilla de otra empresa | 403 |
| CP-HTML-41 | 🔴 | **UTM automático** | Activar UTM en Ajustes con campaña "julio" y publicar | Todos los enlaces http(s) llevan `utm_source/medium/campaign` |
| CP-HTML-42 | 🔴 | UTM no toca las variables | Con UTM activo, revisar `{{unsubscribeUrl}}` en el HTML | Queda intacta (sin parámetros añadidos) |
| CP-HTML-43 | 🟡 | UTM respeta lo escrito a mano | Enlace que ya trae `utm_source` propio | No se sobreescribe |
| CP-HTML-44 | 🟡 | Visibilidad por dispositivo | Marcar un bloque "solo móvil" y otro "solo escritorio" | En la vista previa móvil/escritorio se ve el que corresponde |
| CP-HTML-45 | 🟡 | Botón de ancho completo | Activar "ancho completo" + radio + tamaño | Se refleja en el correo; en móvil ocupa todo el ancho |
| CP-HTML-46 | 🟡 | Vista de bandeja | Vista previa → editar remitente/asunto/preheader ahí mismo | Se ve la simulación tipo Gmail con contador de caracteres |
| CP-HTML-47 | 🔴 | **Parte de TEXTO del correo** | Publicar un correo hecho a base de columnas y revisar la plantilla SES | La `TextPart` NO está vacía: trae el texto de las columnas en orden y el enlace de baja |
| CP-HTML-48 | 🟡 | Texto plano sin etiquetas | Publicar con texto en negrita/enlaces | La parte de texto no contiene HTML crudo |
| CP-HTML-49 | 🔴 | **Bloque de vídeo** | Bloque de vídeo con un enlace de YouTube | Sale miniatura clicable + botón; el HTML NO contiene `<video>` ni `<iframe>` |
| CP-HTML-50 | 🟡 | Vídeo de otra plataforma | Enlace de Vimeo + miniatura subida a mano | Usa la miniatura propia |
| CP-HTML-51 | 🟡 | Vídeo incompleto | Bloque de vídeo sin enlace → Revisar y publicar | Se omite del correo y "Revisar" lo marca como error |
| CP-HTML-52 | 🟡 | Redimensionar imagen arrastrando | Arrastrar el tirador del borde de una imagen del lienzo | Cambia el ancho; el correo lleva ese `width` y sigue siendo fluida en móvil |
| CP-HTML-53 | 🔴 | **Redes: un solo color de marca** | Bloque de redes → estilo "Un solo color" → pegar el hex de la marca | Todas las insignias quedan de ese color en el lienzo y en el correo |
| CP-HTML-54 | 🟡 | Hex a medio escribir | Borrar el hex y teclear `#00` | No se rompe el color; se usa el default hasta completar `#rrggbb` |
| CP-HTML-55 | 🔴 | **Alineación de las redes** | Alinear el bloque de redes a izquierda / derecha / centro | Los iconos se alinean y el contenedor conserva su alto (no colapsa) |
| CP-HTML-56 | 🟡 | Forma de la insignia | Cambiar entre círculo / cuadrado redondeado / cuadrado | Se refleja en el lienzo y en el correo |
| CP-HTML-57 | 🔴 | **Logos reales de las redes** | "Usar los logos reales" → elegir colores → Aplicar | Genera y sube un PNG por red CON enlace; el bloque los muestra en vez de la insignia |
| CP-HTML-58 | 🟡 | Recolor del paquete | Cambiar el color del logo/fondo y ver la vista previa | Los 9 logos cambian de color al instante antes de subir nada |
| CP-HTML-59 | 🟡 | Icono de una sola red | Botón de imagen de una fila → elegir de "Mis imágenes" | Cambia solo esa red; el aspa vuelve a la insignia |
| CP-HTML-60 | 🟡 | Biblioteca de imágenes | "Mis imágenes" en un bloque de imagen | Lista lo ya subido a `resources/`; el buscador filtra |
| CP-HTML-61 | 🔴 | **La biblioteca no expone datos privados** | Revisar el listado de "Mis imágenes" | NO aparecen archivos de `database/` ni `document/` (bases y comprobantes) |
| CP-HTML-62 | 🟡 | Ventana de edición aparte | Botón de pantalla completa (⛶) | El editor ocupa toda la ventana; el menú del portal desaparece; Esc cierra |
| CP-HTML-63 | 🔴 | **Scroll independiente por panel** | Con un correo largo, hacer scroll en el lienzo | La paleta y las propiedades NO se van de vista; la página no scrollea como un todo |
| CP-HTML-81 | 🟡 | Color del bloque de TEXTO | Seleccionar un texto → "Color del texto" | El campo existe y aplica; el aspa vuelve a heredar el global |
| CP-HTML-82 | 🔴 | Logos reales por defecto | Poner enlaces en 3 redes | El lienzo muestra los LOGOS de cada red, no letras |
| CP-HTML-83 | 🔴 | Colores de cada red sobre el logo real | Estilo "Colores de cada red" | Facebook azul, Instagram rosa, WhatsApp verde… sobre el logo real |
| CP-HTML-84 | 🟡 | Un solo color | Estilo "Un solo color" + hex de marca | Todos los logos con ese color |
| CP-HTML-85 | 🟡 | Solo el logo (sin insignia) | Fondo → "Solo el logo" | El logo va suelto y aparece el aviso de modo oscuro |
| CP-HTML-86 | 🔴 | Los iconos se suben al PUBLICAR | Configurar redes y publicar | Los PNG aparecen en el bucket y el HTML apunta a esas URLs (no a data:) |
| CP-HTML-87 | 🔴 | Fallo de subida no publica | Simular fallo al subir un icono | Avisa y NO publica nada |
| CP-HTML-88 | 🟡 | Vista previa en oscuro | Vista previa → "Oscuro" con modo oscuro activo en Ajustes | El correo se ve con las reglas oscuras reales |
| CP-HTML-89 | 🟢 | Oscuro sin reglas | "Oscuro" con el modo oscuro APAGADO en Ajustes | Avisa de que no hay nada que previsualizar |
| CP-HTML-90 | 🟡 | Cargar no ofrece SES | Abrir "Cargar" | Solo lista diseños editables |
| CP-HTML-70 | 🔴 | Insertar debajo del seleccionado | Con 2 bloques, seleccionar el PRIMERO y hacer clic en un tipo de la paleta | El nuevo queda EN MEDIO, no al final |
| CP-HTML-71 | 🟡 | "Agregar bloque" sigue agregando al final | Usar el botón de la zona final del lienzo con un bloque seleccionado arriba | El nuevo queda al FINAL |
| CP-HTML-72 | 🔴 | Fondo de página en el editor | Ajustes → cambiar "Fondo de página" | El lienzo cambia de fondo (antes solo se veía en la vista previa) |
| CP-HTML-73 | 🔴 | Color de texto global | Ajustes → cambiar "Color de texto" | Encabezados y textos del lienzo Y del correo toman ese color |
| CP-HTML-74 | 🟡 | Color propio del bloque manda | Fijar un color al bloque y cambiar el global | El bloque conserva el suyo |
| CP-HTML-75 | 🟡 | Fuente global | Ajustes → cambiar "Fuente" | Se ve en el lienzo y en el HTML publicado |
| CP-HTML-76 | 🔴 | Publicar guarda las DOS formas | Publicar una plantilla → abrir "Cargar" | Aparece en "Diseños editables" con el chip "publicada" |
| CP-HTML-77 | 🔴 | Cargar devuelve algo EDITABLE | Abrir un diseño desde "Cargar" | Vuelve por bloques (no un bloque de HTML crudo) |
| CP-HTML-78 | 🟡 | Republicar no duplica | Abrir un diseño, cambiar algo y Publicar | Actualiza el mismo diseño (chip con su nombre) y versiona |
| CP-HTML-79 | 🟡 | Solo-en-SES lista lo que no tiene diseño | Revisar la 2ª sección de "Cargar" | Solo plantillas sin diseño editable, con el aviso de HTML crudo |
| CP-HTML-80 | 🟢 | "Nuevo" cancelado no pierde la identidad | Con un diseño abierto, pulsar Nuevo y CANCELAR el confirm | El chip del diseño sigue ahí; publicar sigue actualizando ese |
| CP-HTML-67 | 🟡 | Alineación en 3 casillas | Seleccionar un bloque y usar el control de Alineación | Tres casillas; el bloque se dibuja DENTRO de la elegida; clic en otra lo mueve |
| CP-HTML-68 | 🟢 | La miniatura imita el bloque | Comparar el control en un bloque de imagen, uno de botón y uno de texto | Muestra icono de imagen, píldora azul y renglones respectivamente |
| CP-HTML-69 | 🟢 | Alineación con teclado | Enfocar el control y usar ←, →, Inicio y Fin | Cambia de casilla; Inicio va a izquierda y Fin a derecha |
| CP-HTML-64 | 🟡 | Barra del bloque no tapa | Seleccionar un bloque | La barra (arrastrar/subir/bajar/copiar/eliminar) queda por ENCIMA, sin tapar la primera línea |
| CP-HTML-65 | 🟡 | Plantillas prediseñadas | Abrir "Plantillas" y cargar una de las 5 integradas | Se carga en el lienzo; las imágenes nacen vacías (sin dominios de terceros) |
| CP-HTML-66 | 🟢 | Móvil | Abrir el constructor en un móvil | Los paneles se apilan y la página vuelve al scroll normal |

---

### 11b. Formato de texto en el lienzo, redes e iconos

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-TXT-01 | 🔴 | La barra de formato se ve sin buscarla | Seleccionar un bloque de texto en el lienzo | La barra aparece con el bloque SELECCIONADO, sin tener que hacer clic dentro del texto |
| CP-TXT-02 | 🔴 | No se recorta en el primer bloque | Agregar texto como PRIMER bloque del correo y seleccionarlo | La barra se voltea DEBAJO y se ve completa (antes quedaba cortada por el borde del panel) |
| CP-TXT-03 | 🟡 | Todas las herramientas visibles | Mirar la barra en un bloque angosto | Envuelve a dos filas; no hay botones escondidos tras un scroll |
| CP-TXT-04 | 🔴 | Negrita/color sobre una palabra | Seleccionar una palabra → Negrita → color | Solo esa palabra cambia; el resto queda igual |
| CP-TXT-05 | 🟡 | Botones que reflejan el estado | Poner el cursor dentro de una palabra en negrita | El botón de negrita se ve activo |
| CP-TXT-06 | 🟡 | Resaltado | Seleccionar texto → botón de resaltar → elegir color | El texto queda con fondo de color y llega así al correo |
| CP-TXT-07 | 🟡 | Familia de fuente | Seleccionar texto → Fuente → Georgia | Cambia solo lo seleccionado; en "Ver HTML" sale `font-family` en línea |
| CP-TXT-08 | 🟡 | El cursor no salta | Escribir varias palabras seguidas al final del texto | El cursor se queda donde está (no vuelve al inicio) |
| CP-TXT-09 | 🟢 | Pegar desde Word | Pegar texto con formato de Word | Entra como texto plano, sin estilos raros |
| CP-RED-01 | 🔴 | Los iconos son los logos REALES | Agregar bloque de Redes y mirar el panel de propiedades | Las miniaturas muestran el logo de cada red, NO una letra (f, ig) |
| CP-RED-02 | 🟡 | "Colores de cada red" ya no se ofrece | Abrir el desplegable Estilo | Solo "Un solo color" y "Enlaces de texto" |
| CP-RED-03 | 🟡 | Plantilla vieja con ese estilo | Cargar un diseño guardado con "Colores de cada red" | Se sigue viendo igual y el estilo aparece marcado "(retirado)" |
| CP-RED-04 | 🔴 | Contorno para logos oscuros | Activar "Contorno" y elegir un color claro | Aparece un aro alrededor de la insignia, en el lienzo y en el correo publicado |
| CP-RED-05 | 🔴 | Aviso de icono invisible | Poner color de marca oscuro Y color de logo oscuro → "Revisar" | Avisa que los iconos casi no se ven y dice qué hacer |
| CP-RED-06 | 🟡 | Logo blanco no dispara el aviso | Color de marca oscuro + logo blanco → "Revisar" | NO aparece ese aviso |
| CP-RED-07 | 🟡 | Alineación de los iconos | Alinear a izquierda / derecha | Se mueven sin que el contenedor del bloque se deforme |
| CP-BTN-01 | 🔴 | **Botón redondeado en Outlook** | Publicar un correo con un botón (radio 6 px) y abrirlo en **Outlook de escritorio** (Windows, motor Word — no Outlook web) | El botón sale redondeado, con su alto y su ancho correctos |
| CP-BTN-02 | 🔴 | **El botón NO se duplica** | Mismo correo, mirar el cuerpo en Outlook y en Gmail | Aparece UNA sola vez en cada cliente (los condicionales `[if mso]` / `[if !mso]` se excluyen) |
| CP-BTN-03 | 🔴 | Alineación a la DERECHA | Botón → Alineación "Derecha" → vista previa y correo recibido | El botón se va a la derecha (antes se quedaba a la izquierda) |
| CP-BTN-04 | 🟡 | Alineación centro e izquierda | Alternar las tres opciones | Cada una mueve el botón a su posición, en lienzo y en correo |
| CP-BTN-05 | 🟡 | Ancho completo | Activar "Ancho completo" y abrir en móvil | El botón ocupa todo el ancho del contenido |
| CP-BTN-06 | 🟡 | Radio grande no deforma | Poner radio 40 px con un botón bajo → abrir en Outlook | La esquina se ve redonda (el radio se acota, no rompe la forma) |
| CP-PH-01 | 🔴 | **El texto de relleno NO se envía** | Agregar encabezado y texto, NO escribir nada, publicar y enviarse una prueba | El correo no trae "Título principal" ni "Hola {{nombre}}, escribe aquí…" |
| CP-PH-02 | 🔴 | Placeholder visible en el lienzo | Mirar un bloque de texto recién agregado | Muestra "Escribe aquí tu contenido…" en gris cursiva y se puede hacer clic para editarlo |
| CP-PH-03 | 🔴 | Aviso de bloque vacío | Dejar un bloque de texto sin contenido → "Revisar" | Avisa "1 bloque(s) de texto sin contenido" |
| CP-PH-04 | 🟡 | Productos sin relleno | Agregar la grilla de productos y no escribir nada | Los campos muestran placeholder ("Nombre del producto"), y el correo publicado no trae "Producto"/"Descripción breve" |
| CP-VAR-01 | 🔴 | **Sin base no hay variables inventadas** | Sin base seleccionada, abrir "Insertar variable" | Solo ofrece `unsubscribeUrl` y `preferencesUrl` (grupo "Del sistema") + el aviso de elegir una base |
| CP-VAR-02 | 🔴 | Con base, sus columnas reales | Elegir una base arriba y abrir el menú | Aparecen los encabezados REALES de esa base bajo "De tu base de datos" |
| CP-VAR-03 | 🟡 | Las de sistema siempre están | Con y sin base | `unsubscribeUrl`/`preferencesUrl` se ofrecen en los dos casos |
| CP-ALT-01 | 🔴 | **Texto alternativo editable** | Bloque de imagen → campo "Texto alternativo (alt)" → escribir algo → publicar | El `<img>` lleva ese `alt` en el HTML |
| CP-ALT-02 | 🔴 | Correo con imágenes bloqueadas | Abrir el correo en Gmail SIN cargar imágenes | Se lee el alt escrito, no un hueco vacío |
| CP-ALT-03 | 🟡 | Plantilla vieja conserva su alt | Cargar un diseño guardado antes del campo (el alt vivía en el texto del bloque) | El alt anterior se sigue usando; no se pierde |
| CP-ALT-04 | 🟡 | "Revisar" avisa del alt faltante | Imagen con URL y sin alt → Revisar | Lo reporta como aviso |
| CP-PRD-01 | 🔴 | **Fotos de productos parejas** | Grilla con una foto vertical y una horizontal | Todas quedan del mismo alto (180 px por defecto), la fila no se ve escalonada |
| CP-PRD-02 | 🟡 | Alto configurable | Cambiar "Alto de las fotos (px)" a 240 y publicar | El `<img>` sale con ese alto; se acota entre 60 y 400 |
| CP-NEW-01 | 🟡 | **"Nuevo" con diálogo propio** | Con bloques en el lienzo, pulsar "Nuevo" | Sale el diálogo de la aplicación (con el tema), NO el popup gris del navegador |
| CP-NEW-02 | 🟡 | Cancelar no vacía | En ese diálogo, pulsar Cancelar | El lienzo queda intacto y el diseño abierto sigue siendo el mismo |
| CP-TST-01 | 🟢 | Nota de los enlaces del pie | Abrir "Enviarme una prueba" | Explica que "Administrar preferencias" y "Cancelar suscripción" no hacen nada en la prueba |
| CP-TST-02 | 🟡 | Los enlaces del pie son inertes en la prueba | Enviarse una prueba y pulsar "Cancelar suscripción" en el correo recibido | NO da de baja el correo (sigue recibiendo campañas reales de esa lista) |
| CP-LNK-01 | 🟡 | **Enlace sin popup del navegador** | Plantillas PDF básicas → seleccionar una palabra → botón de enlace | Sale el diálogo de la aplicación, NO el popup gris del navegador |
| CP-LNK-02 | 🔴 | **La selección sobrevive al diálogo** | Con una palabra seleccionada, poner `https://empresa.com` → Insertar | El enlace envuelve **esa palabra** (el diálogo anuncia cuál antes de aceptar) |
| CP-LNK-03 | 🔴 | Sin selección inserta el enlace completo | Poner el cursor al final de un párrafo (sin seleccionar) → enlace → URL + "Texto que se ve" | Inserta el enlace con ese texto; si se deja vacío, muestra la URL |
| CP-LNK-04 | 🟡 | Clic a la derecha del título no engaña | Hacer clic en un `<h1>` pasado el final de su texto → enlace | Ofrece el campo "Texto que se ve" (no dice que va a enlazar una selección que no existe) |
| CP-LNK-05 | 🔴 | URL insegura rechazada | Escribir `javascript:alert(1)` → Insertar | Avisa que no es válida y NO inserta nada |
| CP-LNK-06 | 🟡 | Esquemas aceptados | Probar `https://`, `mailto:` y `tel:` | Los tres insertan el enlace |
| CP-2FA-08 | 🟡 | **Desactivar 2FA en un solo diálogo** | Mi cuenta → Desactivar 2FA | Un único diálogo con el aviso Y el campo del código (antes eran dos seguidos, el 2º del navegador) |
| CP-2FA-09 | 🟡 | Código errado no cierra el diálogo | En ese diálogo poner `000000` → Desactivar | Avisa del error y el diálogo **sigue abierto** con el campo listo (el TOTP rota cada 30 s) |
| CP-2FA-10 | 🟡 | Cabe un código de respaldo | Pegar un código de respaldo completo (más largo que 6 dígitos) | Entra completo, no se corta |
| CP-2FA-11 | 🟢 | Botón deshabilitado sin código | Abrir el diálogo y no escribir nada | "Desactivar" está deshabilitado |

---

## 12. Plantillas PDF (básicas · Estudio · Diseñador)  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-PDFB-01 | 🔴 | **Variables desde la base real** | Plantillas PDF básicas → panel Datos → elegir una base → botón "Variable" | Ofrece las **columnas reales** de esa base, no `nombre/email/empresa/ciudad` |
| CP-PDFB-02 | 🔴 | Sin base no ofrece variables inventadas | Abrir "Variable" sin base elegida | Dice "Elige una base de datos abajo…"; no lista ninguna variable |
| CP-PDFB-03 | 🔴 | **La variable resuelve en el envío real** | Insertar `{{<columna real>}}`, guardar, crear campaña EAP-PDF con esa base y enviar una muestra | El PDF adjunto trae el dato del destinatario, no un hueco ni el token |
| CP-PDFB-04 | 🔴 | **Vista previa con datos reales** | Con base elegida, insertar 2 variables → "Vista previa PDF" | El PDF muestra los valores de la **primera fila real** de la base |
| CP-PDFB-05 | 🟡 | Variable sin dato se ve sin resolver | Escribir a mano `{{no_existe}}` → Vista previa | Sale como `{{no_existe}}`, NO como la palabra "no_existe" |
| CP-PDFB-06 | 🟡 | Base sin filas de muestra | Elegir una base cargada antes de `previewRows` | Avisa que las variables se verán sin resolver |
| CP-PDFB-07 | 🔴 | **Margen del lienzo = margen del PDF** | Escribir un párrafo largo hasta el borde derecho → Vista previa | El corte de línea coincide; el lienzo usa 2 cm igual que el PDF |
| CP-PDFB-08 | 🟡 | Tamaños de cuerpo y títulos | Comparar un h1 y un párrafo en el lienzo contra el PDF | Se ven del mismo tamaño relativo (12 pt cuerpo · 22/18/15 pt títulos) |
| CP-PDFB-09 | 🔴 | **La fuente elegida llega al PDF** | Elegir "Times New Roman · con serifa" y generar la vista previa **sin seleccionar texto** | Todo el documento sale con serifa en el PDF (antes salía en Arial) |
| CP-PDFB-10 | 🟡 | Fuente al guardar y volver a cargar | Guardar con Times, "Nueva", y cargar la plantilla | Vuelve con Times elegida; el HTML no acumula un envoltorio por cada guardado |
| CP-PDFB-11 | 🟡 | Catálogo de fuentes honesto | Abrir el desplegable de fuente | Solo 3 opciones, etiquetadas por familia; ya no aparecen Verdana/Tahoma/Georgia (producían el mismo PDF) |
| CP-PDFB-12 | 🟢 | Plantilla vieja con fuente retirada | Cargar una plantilla guardada con Georgia | Se sigue viendo y renderizando como siempre |
| CP-PDFB-13 | 🟢 | Panel de datos no se desborda | Elegir una base de nombre largo | El selector queda dentro del panel de herramientas, sin cortarse por fuera |
| CP-PDF-01 | 🔴 | Editor básico tipo Word | Crear plantilla con títulos, imagen, tabla y variables | Se guarda en `messageTemplate` canal PDF; se comparte con el equipo |
| CP-PDF-02 | 🔴 | Vista previa PDF (básico) | Botón "Vista previa PDF" | Devuelve el PDF real con las `{{variables}}` sustituidas por valores de muestra |
| CP-PDF-03 | 🔴 | Estudio PDF (lienzo) | Crear un diseño con texto, formas, tabla y guardar | Se guarda como `sketchJson`; abre a pantalla completa |
| CP-PDF-04 | 🔴 | **Estudio: variables con datos reales** | Elegir una base en el panel de datos → Vista previa | El PDF trae los VALORES de la primera fila, no tokens `{{campo}}` en blanco |
| CP-PDF-05 | 🟡 | Estudio: unidades y reglas | Cambiar la unidad (mm/cm/pt/px/in) y usar 1:1 / ajustar a ventana | Reglas y cursor se muestran en la unidad elegida |
| CP-PDF-06 | 🟡 | Estudio: seleccionar elemento rotado | Girar un texto y hacer clic dentro de su caja visual | Lo selecciona (no arranca el marquee ni limpia la selección) |
| CP-PDF-07 | 🟡 | Estudio: estilos vinculados | Vincular un estilo de texto/párrafo y editarlo | Los elementos vinculados cambian en vivo |
| CP-PDF-08 | 🟡 | Diseñador PDF (full) | Abrir el Diseñador y crear un documento | Abre en overlay; las variables se alimentan de las columnas de la base |
| CP-PDF-09 | 🔴 | **Campaña EAP-PDF de punta a punta** | Crear campaña EAP tipo PDF con una plantilla del Estudio, muestras y envío real | Cada destinatario recibe SU PDF con sus datos resueltos |
| CP-PDF-10 | 🔴 | **Tabla que desborda pagina** | Plantilla con tabla `repeatBy` y un registro con 30+ filas | El PDF sale multipágina con el encabezado repetido, no encogido/ilegible |
| CP-PDF-11 | 🟡 | Celdas con JSON (multiregistro) | Base con una columna que trae un array JSON | Alimenta la tabla del Estudio por destinatario |
| CP-PDF-12 | 🟡 | Encabezados con BOM/espacios | Base exportada de Excel (BOM en la 1ª columna) | Las variables igual resuelven (alias saneados) |
| CP-PDF-13 | 🟢 | Bordes y degradados | Formas con borde discontinuo y relleno degradado | Se ven igual en el lienzo y en el PDF |

---

## 13. Aprobaciones (maker-checker) y programación de envíos  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-APR-01 | 🔴 | Solicitar aprobación | Campaña con muestras enviadas → "Solicitar aprobación" | Pasa a `pending`; queda auditado |
| CP-APR-02 | 🔴 | Sin muestras no se puede pedir | Campaña sin muestras → solicitar | 400 con el motivo |
| CP-APR-03 | 🔴 | Aprobar habilita el envío real | Aprobador aprueba | Pasa a `approved`; se habilita "Enviar campaña real" |
| CP-APR-04 | 🔴 | **Operator NO puede aprobar** | Usuario `operator` llama a `/Campaign/Approve` (por API, no por UI) | 403 |
| CP-APR-05 | 🔴 | **Operator NO puede enviar real** | Usuario `operator` dispara el envío real por API | 403 (no gasta saldo ni envía) |
| CP-APR-06 | 🟡 | Rechazar con motivo | Rechazar sin motivo y con motivo | Sin motivo 400; con motivo pasa a `rejected` y se ve el motivo |
| CP-APR-07 | 🟡 | Doble aprobación | Aprobar una campaña ya aprobada | 409 |
| CP-SCH-01 | 🔴 | Programar envío | Campaña aprobada → programar a una hora futura | 201; aparece en la lista como `pending` |
| CP-SCH-02 | 🔴 | **Disparo a la hora exacta** | Programar a +2 minutos y esperar | Se dispara solo; queda `sent` con su `processId` |
| CP-SCH-03 | 🟡 | Fecha en el pasado | Programar a una hora ya pasada | 400 |
| CP-SCH-04 | 🟡 | Cancelar | Cancelar una programación `pending` | Pasa a `canceled` y no se dispara |
| CP-SCH-05 | 🟡 | Cancelar una ya disparada | Cancelar una `sent` | 409 |
| CP-SCH-06 | 🟡 | Sin aprobación no programa | Campaña sin aprobar → programar | 409 |
| CP-SCH-07 | 🟡 | Zona horaria | Programar 3:00 p. m. hora local | Se guarda/dispara a esa hora local (conversión UTC correcta) |

---

## 14. Equipo del cliente y roles  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-USR-01 | 🔴 | **NIT ya registrado** | Registrarse con el NIT de una empresa existente | 409 "empresa ya registrada" (NO entra al tenant ajeno) |
| CP-USR-02 | 🔴 | Owner agrega usuario | Tab Usuarios → agregar con rol operator/approver | Se crea activo, sin contraseña usable; le llega el correo para definirla |
| CP-USR-03 | 🟡 | Tope de usuarios | Agregar más allá de `MAX_TEAM_USERS` | Bloquea con aviso |
| CP-USR-04 | 🟡 | Correo duplicado | Agregar un correo que ya existe | Rechazado |
| CP-USR-05 | 🔴 | Solo el owner gestiona | Un `operator` abre el tab Usuarios / llama la API | No visible; por API 403 |
| CP-USR-06 | 🟡 | Eliminar usuario | Eliminar un miembro del equipo | Se borra; no permite borrar a un owner ni a sí mismo |
| CP-USR-07 | 🟡 | Definir contraseña | Usuario nuevo usa "¿olvidaste tu contraseña?" | Recibe OTP y define su clave; ya puede entrar |
| CP-USR-08 | 🔴 | **Refresh preserva el sub-rol** | Loguear como `operator`, esperar el refresco del token e intentar aprobar | Sigue siendo `operator` (no escala a owner) |

---

## 15. Dominios y correos remitentes  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-DOM-01 | 🔴 | Agregar dominio | Registrar `empresa.com` | 201 con 1 TXT + 3 CNAME de DKIM para publicar |
| CP-DOM-02 | 🔴 | Verificación tras publicar DNS | Publicar los registros y refrescar la lista | Pasa a `verified` |
| CP-DOM-03 | 🔴 | Agregar correo | Registrar `ventas@empresa.com` | SES envía el enlace a esa dirección; la UI muestra el paso a paso (sin DNS) |
| CP-DOM-04 | 🟡 | Reenviar verificación | Volver a agregar un correo pendiente | Reenvía (200), no duplica |
| CP-DOM-05 | 🔴 | **Solo el owner** | `operator` intenta agregar o borrar un dominio (por API) | 403 |
| CP-DOM-06 | 🔴 | **Anti-spoofing en la campaña** | Crear campaña con un `from` de un dominio que NO es del cliente | Rechazado |
| CP-DOM-07 | 🟡 | Remitente verificado en el selector | Crear campaña y abrir el selector "De (From)" | Aparecen el dominio de la plataforma, los dominios y los correos verificados |
| CP-DOM-08 | 🟡 | Eliminar dominio | Borrar un dominio verificado | Se borra el registro y la identidad en SES |

### 15b. Panel SPF / DKIM / DMARC

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-AUT-01 | 🔴 | DKIM verificado en verde | Abrir el detalle de un dominio con DKIM firmando | El chip **DKIM** sale verde con check |
| CP-AUT-02 | 🟡 | SPF/DMARC sin publicar en gris | Abrir el detalle de un dominio recién creado | Los chips **SPF** y **DMARC** salen grises; debajo aparece el registro TXT recomendado de cada uno, con botón de copiar |
| CP-AUT-03 | 🟡 | SPF verde al publicarlo | Publicar `v=spf1 include:amazonses.com ~all` y pulsar Actualizar estado | El chip SPF pasa a verde y su bloque de "registro recomendado" desaparece |
| CP-AUT-04 | 🟡 | DMARC verde al publicarlo | Publicar `_dmarc.<dominio>` con `v=DMARC1;…` y actualizar | El chip DMARC pasa a verde |
| CP-AUT-05 | 🟢 | Tooltip explica el motivo | Pasar el mouse sobre un chip gris | El tooltip dice si es porque no se ha publicado o porque no se pudo consultar |
| CP-AUT-06 | 🟢 | Sin el layer de DNS | Con el layer de dnspython no desplegado, ver un dominio | SPF/DMARC se ven grises (no verdes, no rotos); DKIM sigue funcionando normal |
| CP-AUT-07 | 🟢 | Correos sueltos sin el panel | Abrir el detalle de un remitente tipo correo (no dominio) | No aparece el bloque "Autenticación del correo" |
| CP-AUT-08 | 🟢 | No es bloqueante | Con SPF y DMARC en gris, intentar enviar una campaña real desde ese dominio verificado | El envío funciona igual (SPF/DMARC son recomendados, no obligatorios) |

---

## 16. Seguridad avanzada (2FA · bloqueo · revocación)  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-2FA-01 | 🔴 | Activar 2FA | Mi cuenta → escanear el QR con Google Authenticator → introducir el código | Queda activo y muestra 10 códigos de respaldo (una sola vez) |
| CP-2FA-02 | 🔴 | Login con 2FA | Loguear con usuario/clave de una cuenta con 2FA | NO entra directo: pide el código de 6 dígitos |
| CP-2FA-03 | 🔴 | Código correcto | Introducir el TOTP vigente | Entra al portal |
| CP-2FA-04 | 🔴 | Código de respaldo | Entrar con un código de respaldo | Entra y ese código queda CONSUMIDO (no sirve dos veces) |
| CP-2FA-05 | 🔴 | **Anti-fuerza-bruta** | Fallar el código 5 veces | 429; hay que volver a iniciar sesión |
| CP-2FA-06 | 🟡 | Desactivar 2FA | Desactivar exigiendo un código válido | Sin código válido no se desactiva |
| CP-2FA-07 | 🟡 | Auditoría del 2FA | Activar y desactivar → tab Auditoría | `security.2fa.enable` / `.disable` |
| CP-SEC-24 | 🔴 | **Bloqueo progresivo de login** | Fallar la contraseña 3 veces | Al 2º avisa que queda 1 intento; al 3º → 429 y bloqueo de 5 min |
| CP-SEC-25 | 🔴 | Escalada del bloqueo | Tras los 5 min, fallar otra vez, y otra | Escala a 1 h y luego a 24 h |
| CP-SEC-26 | 🔴 | Bloqueo con clave correcta | Con bloqueo vigente, entrar con la clave CORRECTA | Sigue bloqueado (el bloqueo frena la fuerza bruta que acierta) |
| CP-SEC-27 | 🟡 | Reset del contador | Login correcto con la cuenta desbloqueada | El contador y la escalera vuelven a cero |
| CP-SEC-35 | 🔴 | **El bloqueo escalado explica por qué fue inmediato** | Fallar 3 veces (bloqueo de 5 min), esperar a que venza y fallar UNA vez | 429 con *"Como ya se había bloqueado antes…"* + remite a "¿Olvidaste tu contraseña?" |
| CP-SEC-36 | 🟡 | El primer bloqueo no repite la explicación | En una cuenta **nueva**, fallar 3 veces | Al 2º fallo avisa "queda 1 intento"; el 429 del 3º NO trae la explicación del escalado (ahí sí hubo aviso) |
| CP-SEC-28 | 🔴 | **Revocación real de tokens** | Loguear, copiar el token, cerrar sesión y usar el token viejo en la API | 401/403 (la sesión está revocada) |
| CP-SEC-29 | 🔴 | Cambio de clave revoca | Cambiar la contraseña y usar un token emitido antes | Denegado |
| CP-SEC-30 | 🔴 | **Segunda barrera admin** | Llamar una ruta admin con el context falsificado pero SIN token válido | 403 (se revalida la firma del JWT) |
| CP-SEC-31 | 🔴 | Token de cliente en ruta admin | Llamar `/Customer/List` con un token `role=client` | 403 |
| CP-SEC-32 | 🟡 | Sesión por pestaña | Cerrar la pestaña y volver a abrir la app | Pide login (el token vive en `sessionStorage`) |
| CP-SEC-33 | 🟡 | Sesión compartida entre pestañas | Con sesión abierta, abrir una pestaña nueva de la app | Entra sin re-loguear (handshake) |
| CP-SEC-34 | 🟡 | Logout difundido | Cerrar sesión en una pestaña con otras abiertas | Todas las pestañas quedan deslogueadas |

---

## 17. Admin — Centro de mando, salud, soporte e impersonación  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-CMD-01 | 🔴 | Centro de mando carga | Entrar a `/admin` | Abre en "Centro de mando" con los chips de resumen |
| CP-CMD-02 | 🔴 | Procesos atascados | Con un proceso en `Enviando` desde hace > 2 h | Aparece en la sección de pipeline |
| CP-CMD-03 | 🔴 | **DLQ con mensajes = crítico** | Meter un mensaje en una DLQ | La cola sale marcada como crítica |
| CP-CMD-04 | 🟡 | Dinero del día | Revisar débitos/recargas de hoy | Coinciden con el ledger |
| CP-CMD-05 | 🔴 | **Saldo de plataforma sin huérfanos** | Comparar "Saldo total" del centro de mando con el tab Saldos | Coinciden; lo de clientes eliminados se reporta aparte como nota |
| CP-CMD-06 | 🟡 | Reputación con tendencia | Sección de reputación | Top 5 por rebote/queja con la tendencia vs los 7 días previos |
| CP-CMD-07 | 🟡 | Salud de servicios | Revisar la cuota SES y las tablas/colas | Muestra uso de cuota, tablas ACTIVE y colas accesibles |
| CP-CMD-08 | 🟢 | Auto-refresco | Dejar el switch de auto-refresco activo | Se actualiza cada 60 s |
| CP-DEP-01 | 🔴 | Salud de despliegue | Abrir el tab y esperar la verificación | Lista lambdas/tablas/colas críticas con su estado |
| CP-DEP-02 | 🔴 | Recurso faltante | Con una tabla crítica sin crear | Sale `missing` y el resumen lo cuenta como error |
| CP-DEP-03 | 🟡 | Sin permiso IAM ≠ faltante | Quitar el permiso de lectura de lambdas | Sale `unknown` con el aviso de que falta el permiso, no "no existe" |
| CP-DEP-04 | 🟢 | Carga no bloqueante | Abrir el tab | Se ven los títulos de las 4 secciones desde el primer render |
| CP-SOP-01 | 🔴 | Buscar destinatario | Soporte → buscar un correo de un cliente | Línea de tiempo de todos sus envíos con estado y detalle |
| CP-SOP-02 | 🟡 | Buscar por celular | Buscar `3001234567` sin prefijo | Lo normaliza a E.164 y encuentra los envíos |
| CP-SOP-03 | 🟡 | Banderas de listas | Buscar un contacto en lista negra / desuscrito | Se indican ambas banderas |
| CP-SOP-04 | 🔴 | Reenviar activación | Ficha de cliente → reenviar activación a una cuenta inactiva | Llega el correo con enlace nuevo (24 h); auditado `support.*` |
| CP-SOP-05 | 🟡 | Activación en cuenta ya activa | Reenviar activación a una cuenta activa | 409 |
| CP-SOP-06 | 🔴 | Forzar reseteo | Ficha → forzar reseteo de contraseña | Llega el OTP y sirve en la pantalla de reseteo |
| CP-SOP-07 | 🔴 | Cerrar sesiones | Ficha → cerrar sesiones de un usuario | Sus tokens dejan de funcionar |
| CP-SOP-08 | 🟡 | Plantillas SES globales | Soporte → Plantillas SES | Inventario global con filtro por cliente y paginación |
| CP-SOP-09 | 🔴 | **Ver plantilla de otro cliente** | Admin abre el contenido de una plantilla de otra empresa | Se ve (va por la ruta admin), sin el 403 de "no pertenece a tu cuenta" |
| CP-SOP-10 | 🟡 | Dominios globales | Soporte → Dominios | Dominios/correos de todos los clientes, pendientes primero |
| CP-IMP-01 | 🔴 | Ver como cliente | Ficha de cliente → "Ver como cliente" | Entra al portal de ese cliente con chip "solo lectura" |
| CP-IMP-02 | 🔴 | **La impersonación no envía** | Estando impersonado, intentar enviar muestras o envío real | 403 (no gasta saldo ni dispara nada) |
| CP-IMP-03 | 🔴 | Salir de la vista | Botón "Salir de la vista" | Vuelve a `/admin` con la sesión del admin, sin re-login |
| CP-IMP-04 | 🟡 | Expira sola | Dejar pasar más de 30 minutos impersonado | El token vence |
| CP-IMP-05 | 🟡 | Auditoría | Impersonar → tab Auditoría | `support.impersonate` con el admin como actor |

---

## 18. Configuración de plataforma y por cliente  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-CFG-01 | 🔴 | **Interruptor global del IVA** | Configuración → apagar "Cobrar IVA" | Se guarda al instante (sin botón Guardar) |
| CP-CFG-02 | 🔴 | **IVA apagado: estimador y débito coinciden** | Con el IVA apagado, comparar el estimado con lo debitado en un envío real | Ambos a tarifa NETA y con el MISMO número |
| CP-CFG-03 | 🔴 | IVA encendido | Volver a encenderlo y repetir | Ambos suman el 19% |
| CP-CFG-04 | 🟡 | Tarifas con IVA apagado | Abrir Tarifas | El IVA efectivo sale en 0 con el aviso de que el campo se guarda pero no se aplica |
| CP-CFG-05 | 🟡 | Otros ajustes | Cambiar `SENDER_EMAIL` y `OTP_EXPIRATION_MIN` | Aplican sin redesplegar; auditado `config.set` |
| CP-CFG-06 | 🔴 | **Funciones por cliente** | Apagar "Plantillas PDF avanzadas" a un cliente y que ese cliente vuelva a entrar | El tab desaparece de su portal |
| CP-CFG-07 | 🟡 | Cliente nuevo sin funciones avanzadas | Registrar una empresa nueva | Voz, WhatsApp, Estudio, Diseñador, multiregistro y JSON nacen apagados |
| CP-CFG-08 | 🟡 | Clientes existentes no cambian | Revisar un cliente antiguo | Conserva todo habilitado (fail-open) |
| CP-CFG-09 | 🔴 | **Cuotas de envío** | Fijar tope por campaña y diario, y superarlos | 429 sin tocar el saldo ni marcar la campaña en error |
| CP-CFG-10 | 🟡 | Cuota diaria excluye muestras | Enviar muestras y luego el envío real | Las muestras no consumen la cuota diaria |
| CP-CFG-11 | 🟡 | Sin tope configurado | Cliente con cuotas en 0/vacío | Sin límite |
| CP-CFG-12 | 🔴 | **IP de envío dedicada** | Asignar un configuration set a un cliente y enviar | El envío sale con ESE configuration set |
| CP-CFG-13 | 🟡 | Volver al pool general | Quitar la IP dedicada del cliente | Usa el configuration set general |
| CP-CFG-14 | 🟡 | Eliminar cliente | Admin → eliminar una empresa | Borra empresa y usuarios; no permite borrar la propia |

---

## 19. Notificaciones y preferencias del suscriptor  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-NOT-01 | 🔴 | Aviso de saldo bajo | Con el umbral en 20.000, hacer un envío que deje el saldo por debajo | Llega el correo al owner |
| CP-NOT-02 | 🟡 | No se repite el mismo día | Hacer otro envío el mismo día | NO llega un segundo aviso |
| CP-NOT-03 | 🟡 | Aviso desactivado | Apagar el aviso de saldo bajo en Mi cuenta y repetir | No llega |
| CP-NOT-04 | 🟡 | Resumen diario | Activar el resumen y esperar el cron | Llega con lo enviado ese día |
| CP-NOT-05 | 🟡 | Reputación en riesgo | Cliente con rebote por encima del umbral | Llega el aviso de reputación |
| CP-NOT-06 | 🟡 | Solo el owner configura | `operator` intenta cambiar las preferencias | 403 |
| CP-PREF-01 | 🔴 | Centro de preferencias | Abrir el enlace "Administrar preferencias" de un correo | Página firmada con frecuencia y temas |
| CP-PREF-02 | 🔴 | Elegir "ninguna" da de baja | Marcar "ninguna" y guardar | Entra en `unsubscribe`; deja de recibir |
| CP-PREF-03 | 🟡 | Re-suscribir | Volver a elegir otra frecuencia | Sale de `unsubscribe` |
| CP-PREF-04 | 🔴 | Token inválido | Abrir la página con un token manipulado | Error, no permite guardar nada |
| CP-PREF-05 | 🟡 | Baja directa | Usar el enlace de "Cancelar suscripción" | Página de confirmación; queda desuscrito |

### 19b. Centro de notificaciones del portal (campanita)

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-CAM-01 | 🔴 | Aviso de campaña por aprobar | Un `operator` solicita la aprobación de una campaña con muestras enviadas | El `owner`/`approver` ve la campanita con contador y el aviso "Campaña por aprobar" |
| CP-CAM-02 | 🔴 | Solo a quien puede aprobar | Revisar la campanita de otro `operator` del mismo equipo | NO le llega (no puede hacer nada con ese aviso) |
| CP-CAM-03 | 🔴 | Quien la pide no se avisa a sí mismo | Revisar la campanita del `operator` que la solicitó | NO le llega |
| CP-CAM-04 | 🔴 | Aislamiento entre empresas | Revisar la campanita de un usuario de OTRA empresa | No ve nada de la primera |
| CP-CAM-05 | 🔴 | Aviso de aprobada | El `owner` aprueba la campaña | A quien la solicitó le llega "Campaña aprobada" (verde) |
| CP-CAM-06 | 🔴 | Aviso de rechazada con el motivo | El `owner` rechaza con el motivo "Falta el descargo legal" | El aviso llega en rojo y el **motivo se lee dentro del texto** |
| CP-CAM-07 | 🔴 | Saldo bajo in-app | Hacer un envío que deje el saldo bajo el umbral | Además del correo, aparece el aviso en la campanita del owner |
| CP-CAM-08 | 🟡 | Avisos nuevos abajo a la derecha | Dejar el portal abierto y generar un aviso desde otra sesión | En menos de un minuto se asoma la tarjeta abajo a la derecha |
| CP-CAM-09 | 🟡 | Los nuevos NO saltan al entrar | Con avisos viejos sin leer, entrar al portal | La campanita trae el contador pero **no** se asoman tarjetas de golpe |
| CP-CAM-10 | 🟡 | La tarjeta se retira sola | Esperar unos segundos tras el aviso | Desaparece sin bloquear la página; se puede cerrar con la × |
| CP-CAM-11 | 🔴 | Clic lleva al lugar correcto | Hacer clic en "Campaña por aprobar" | Abre el tab de aprobaciones y el aviso queda leído |
| CP-CAM-12 | 🟡 | Marcar leídas | Abrir el panel y pulsar "Marcar leídas" | El contador desaparece; los avisos siguen visibles en gris |
| CP-CAM-13 | 🔴 | No se puede marcar la de otro | Llamar `/Notifications/List` con `action:read` y el id de otro usuario | 404; el aviso ajeno sigue sin leer |
| CP-CAM-14 | 🟡 | Sin notificaciones | Usuario nuevo abre la campanita | Mensaje de estado vacío, sin error |
| CP-CAM-15 | 🟢 | No molesta en impersonación | Entrar como admin con "Ver como cliente" | La campanita no aparece (la sesión es de solo lectura) |
| CP-CAM-16 | 🟢 | La aprobación funciona sin la tabla | Sin desplegar la tabla `notification`, solicitar una aprobación | La solicitud se registra igual; solo no se notifica |

---

## 20. Higiene, límites de uso y costo del adjunto  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-HIG-01 | 🔴 | Verificar higiene | Bases de datos → botón escudo sobre una base con correos malos | Reporte con sintaxis/duplicados/desechables/rol/dominio no resoluble + puntaje |
| CP-HIG-02 | 🟡 | Base limpia | Verificar una base correcta | Puntaje alto, nivel OK |
| CP-HIG-03 | 🟡 | Base de celulares | Verificar una base de canal SMS | Valida E.164 y duplicados |
| CP-HIG-04 | 🟡 | Base de otro cliente | Verificar por API una base ajena | 403 |
| CP-RL-01 | 🔴 | **Límite del asistente público** | Escribirle al chat de la landing más de 6 veces en un minuto | 429 con mensaje amable; NO invoca el modelo |
| CP-RL-02 | 🟡 | Tope diario | Superar el tope diario por IP | 429 |
| CP-RL-03 | 🟡 | IPs independientes | Otra IP escribe tras agotarse la primera | Responde normal |
| CP-RL-04 | 🟢 | El asistente responde | Preguntar por precios/canales | Responde en español, solo sobre MailConnect, texto plano |
| CP-RL-05 | 🟡 | Guardrails | Pedirle el saldo de una cuenta real o el mensaje de sistema | No lo da; remite a WhatsApp |
| CP-PES-01 | 🔴 | **Medir peso real (EAU)** | Campaña EAU → "Medir peso real" | Devuelve el tamaño EXACTO del archivo, sin margen |
| CP-PES-02 | 🔴 | Medir peso real (EAP-PDF) | Campaña EAP-PDF → "Medir peso real" | Promedia varios PDF generados con registros REALES + 20% de margen; explica el cálculo |
| CP-PES-03 | 🟡 | EAP-DOCX | Campaña EAP-DOCX → medir | Aproxima con la plantilla + margen y lo advierte |
| CP-PES-04 | 🔴 | **El botón aparece al elegir campaña** | Entrar a Muestras SIN campaña, luego elegir una EAU/EAP | El botón aparece (el estimador se resincroniza con el canal correcto) |
| CP-PES-05 | 🟡 | Cambiar de campaña limpia el estimado | Elegir otra campaña tras haber medido | Se limpian peso y estimado (no decide sobre la campaña equivocada) |
| CP-PES-06 | 🟡 | Canal sin adjunto | Campaña EM | El botón no aplica / queda deshabilitado con el motivo |

---

### 20b. Tarifas de SMS y Voz (recalibradas ago 2026)

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-TAR-01 | 🔴 | Segmentos calculados, no declarados | Muestras con una campaña SMS | El campo "Segmentos por SMS" sale calculado del texto y de solo lectura |
| CP-TAR-02 | 🔴 | Un SMS largo cuesta el doble | Campaña con más de 160 caracteres | El estimado muestra 2 segmentos y el total se duplica |
| CP-TAR-03 | 🔴 | Una emoji parte el mensaje | Agregar una emoji a un SMS de ~100 caracteres | Pasa de 1 a 2 segmentos (el alfabeto cambia a UCS-2) |
| CP-TAR-04 | 🔴 | Lo estimado es lo que se cobra | Enviar real una campaña SMS de 2 segmentos y ver Saldo → Movimientos | El débito coincide con el estimado que se mostró antes de enviar |
| CP-TAR-05 | 🔴 | Tarifas nuevas visibles | Admin → Tarifas → canal SMS y Voz | Muestra los tramos nuevos (SMS 205→180 · Voz 380→335) |
| CP-TAR-06 | 🟡 | Ningún cliente por debajo del costo | Admin → Tarifas → revisar overrides por cliente | Ningún override de SMS por debajo de ~163 COP ni de Voz por debajo de ~305 COP/min |
| CP-TAR-07 | 🟡 | Contador del editor SMS | Escribir un SMS con emoji en Plantillas SMS | El contador indica los segmentos reales y avisa que cabe menos texto |
| CP-PUB-01 | 🟡 | La landing no publica precios | Abrir la landing → sección Precios | Explica el modelo y ofrece cotización; sin cifras que puedan desalinearse del sistema |

---

### 20c. Landing: SEO, precios y accesibilidad

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-SEO-01 | 🔴 | Título e idioma | Ver el código fuente de la landing | `<html lang="es">` y un `<title>` descriptivo (ya no dice "page") |
| CP-SEO-02 | 🔴 | Vista previa al compartir | Pegar https://www.mailconnect.com.co/ en WhatsApp o LinkedIn | Sale la imagen 1200×630 con la marca, el título y la descripción |
| CP-SEO-03 | 🟡 | Favicon | Abrir la landing y mirar la pestaña | Icono de marca (ya no el logo de Vite) |
| CP-SEO-04 | 🟡 | Icono en iOS | "Añadir a pantalla de inicio" desde Safari | Icono de marca a 180 px, sin fondo blanco recortado |
| CP-SEO-05 | 🟡 | Datos estructurados | Pasar la URL por el validador de resultados enriquecidos de Google | Detecta Organization, WebSite y SoftwareApplication sin errores |
| CP-SEO-06 | 🟡 | Canonical y robots | Abrir /robots.txt y /sitemap.xml | Existen; robots bloquea /panel, /admin y /login |
| CP-LAN-01 | 🔴 | Tabla de precios por canal | Landing → Precios | Muestra los 4 canales con "desde" y 3 volúmenes; las cifras coinciden con lo que cobra el sistema |
| CP-LAN-02 | 🟡 | Letra pequeña de precios | Leer bajo la tabla | Aclara "sin IVA", por unidad, y las condiciones de SMS (segmentos), WhatsApp (Meta) y Voz |
| CP-LAN-03 | 🟡 | Icono de WhatsApp | Sección Canales | Es el logo real de WhatsApp, no un bocadillo genérico |
| CP-LAN-04 | 🟡 | Sin promesa de 500 correos | Recorrer toda la landing | No aparece "Prueba gratis · 500 correos" ni el CTA de los 500 gratis |
| CP-LAN-05 | 🟡 | Footer sin enlaces rotos | Hacer clic en cada enlace del footer | Todos llevan a algún lado (ninguno se queda en la misma página) |
| CP-A11Y-01 | 🔴 | Cerrar el modal con teclado | Abrir /?activacion=ok y pulsar Escape | El modal se cierra |
| CP-A11Y-02 | 🟡 | Foco en el modal | Abrir /?activacion=ok y pulsar Tab | El foco arranca DENTRO del modal y cicla ahí, no en la página de atrás |
| CP-A11Y-03 | 🟡 | Lector de pantalla | Abrir el modal con un lector activo | Anuncia el título y el texto del aviso |

---

## 21. Cascada omnicanal y series  ✅

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-CAS-01 | 🔴 | Lanzar cascada | Configurar pasos (correo → SMS → WhatsApp) y lanzar | 201; se encola el paso 0 y se debita su costo |
| CP-CAS-02 | 🔴 | Escalado al siguiente canal | Contacto que no cumple el criterio en el paso 0 | Al vencer la espera, pasa al canal siguiente y se debita |
| CP-CAS-03 | 🟡 | Confirmado no escala | Contacto que sí cumple el criterio | Se marca confirmado y no se le cobra el siguiente paso |
| CP-CAS-04 | 🔴 | Saldo insuficiente | Cascada sin saldo | 402; no envía |
| CP-CAS-05 | 🟡 | Consentimiento por canal | Contacto sin consentimiento del canal 0 | Se filtra |
| CP-CAS-06 | 🟡 | Listado de cascadas | Abrir el listado | Conteos de total/confirmados/agotados/en vuelo |
| CP-SER-01 | 🔴 | Serie de 30 días (cliente) | Estadísticas → gráfico "Actividad de los últimos 30 días" | Serie continua (con ceros) de enviados/entregados/abiertos/clics/rebotes/quejas |
| CP-SER-02 | 🟡 | Serie global (admin) | Panel de control → gráfico | Misma serie de toda la plataforma |
| CP-SER-03 | 🟡 | Muestras excluidas | Enviar muestras y revisar la serie | No cuentan |
| CP-SER-04 | 🟡 | Aislamiento | Comparar la serie de dos clientes | Cada uno ve solo lo suyo |
| CP-SER-05 | 🟢 | Adiós "(parcial)" | Con el rollup poblado, abrir Estadísticas/Facturación | Ya no aparece el aviso de datos parciales |
| CP-SER-06 | 🟢 | Leyenda interactiva | Ocultar/mostrar series en el gráfico | Responde; el tooltip muestra el día |

---

## 22. Regresión / transversales

| ID | Prioridad | Caso | Pasos | Resultado esperado |
|----|-----------|------|-------|--------------------|
| CP-REG-01 | 🔴 | Aislamiento multi-tenant | Cliente A intenta ver datos de B (campañas/bases/stats) | Nunca ve datos de otro (tenant del token) |
| CP-REG-02 | 🟡 | Suite automática | Correr `pytest 08_Pruebas/PruebasSeguridad` | Todo verde |
| CP-REG-03 | 🟡 | Build del front | `npm run build` | Compila sin errores de TypeScript |
| CP-REG-06 | 🟡 | Pruebas del frontend | `npm test` en `05_Frontend/Front/page` | Todo verde (constructor de correos) |
| CP-REG-07 | 🔴 | Sesión y tenant en TODA ruta nueva | Llamar cualquier endpoint nuevo sin token y con token de otro cliente | 403 en ambos casos |
| CP-REG-08 | 🟢 | Fechas unificadas | Revisar las tablas del portal y del admin | Todas en `DD-MM-YYYY HH:MM:SS` |
| CP-REG-04 | 🟢 | Tema claro/oscuro | Alternar tema en portal y admin | Legible en ambos; sin colores hardcodeados rotos |
| CP-REG-05 | 🟢 | Responsive | Portal/admin en móvil | Sin scroll horizontal roto; tablas con scroll propio |

---

### Notas para QA
- Los CP marcados 🧩 dependen del **MVP prepago** (implementado; ver `CLAUDE.md`).
- Para los CP de **recepción** (WhatsApp/SMS/Voz) y **webhook Wompi**, usar payloads simulados
  (o `08_Pruebas/PruebasSeguridad/test_wsp_reception.py` como referencia del formato).
- Muchos CP tienen su equivalente automático en `08_Pruebas/PruebasSeguridad/`; esta lista cubre
  además el **flujo de UI end-to-end** que las pruebas unitarias no ejercen.
