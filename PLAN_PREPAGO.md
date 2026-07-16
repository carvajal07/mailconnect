# PLAN MVP — Prepago (monedero) con recargas Wompi + manual y débito por envío

> **Estado:** propuesta de diseño (solo plan, sin implementar).
> **Objetivo:** cobrar **antes** de gastar. El cliente mantiene **saldo** (en COP); cada envío
> real **descuenta** de forma **atómica**; sin saldo, `Prepare-batch` **bloquea** el envío.
> Recargas por **Wompi** (automática) y **manual** (admin). Aprovecha lo ya construido:
> `Cost_Estimate` (cálculo de costo), `pricingRate` (tarifas), el gate `realSendEnabled`, los
> patrones atómicos (ADD condicional, lock de campaña) y la auditoría `adminAudit`.

---

## 0. Alcance del MVP

**Incluye**
- Monedero por cliente en **COP** (tabla `customerBalance`) + libro de movimientos (`walletTransaction`).
- **Recarga manual** por admin (consignación/transferencia → acredita saldo).
- **Recarga Wompi** (widget/checkout + **webhook firmado** que acredita el saldo).
- **Débito atómico por envío real** en `Prepare-batch` (reserva sobre el tamaño de la base).
- **Bloqueo por saldo insuficiente** (nueva excepción, análoga a `RealSendDisabled`).
- Portal: saldo visible + historial + botón "Recargar" + aviso "saldo insuficiente".
- Admin: ver saldos, recargar manual, ver movimientos.

**Fuera del MVP (fase 2+)**
- **Conciliación** fina (reembolso de filtrados/fallidos sobre el envío real).
- **Postpago con cupo** para corporativos (ya existe `Billing_Summary` como base).
- **Facturación electrónica DIAN** (integración con Alegra/Siigo/Factus…).
- Créditos por canal / paquetes; multi-moneda.

---

## 1. Estrategia de cobro (resumen)

- **Unidad = COP** (no créditos abstractos): el monedero guarda pesos; el débito es el **costo
  estimado en COP** del envío. Simplifica IVA/DIAN y el entendimiento del cliente.
- **Prepago por defecto** para todos. `realSendEnabled` se mantiene como **palanca manual**
  de bloqueo administrativo (override), independiente del saldo.
- **El hecho gravable (IVA/DIAN) es la RECARGA**, no cada envío → se factura al recargar
  (mucho más simple que facturar consumo). El débito por envío es consumo de saldo prepagado.
- **Las muestras siguen gratis** (máx. 5/campaña, ya implementado). Solo el **envío real** debita.
- **Base de cobro:** se **reserva** el costo estimado sobre el nº de registros de la base al
  iniciar el envío; la conciliación fina (cobrar solo lo realmente enviado/entregado) es fase 2.

---

## 2. Modelo de datos (tablas nuevas)

### `customerBalance` (PK `customerId` (S))
| Campo | Tipo | Notas |
|-------|------|-------|
| `customerId` | S (PK) | |
| `balance` | N | Saldo disponible en **COP** (entero). Nunca negativo (garantizado por la condición del débito). |
| `currency` | S | `COP`. |
| `updatedAt` | S | ISO. |

> El saldo es la **fuente de verdad** para autorizar envíos. Se crea "perezosamente" (saldo 0)
> en la primera recarga o en el primer intento de envío.

### `walletTransaction` (PK `txId` (S)) — libro mayor (ledger)
| Campo | Tipo | Notas |
|-------|------|-------|
| `txId` | S (PK) | uuid. |
| `customerId` | S | GSI recomendado `customerId-createdAt-index` para el historial. |
| `type` | S | `topup_manual` · `topup_wompi` · `debit_send` · `refund_send` · `adjustment`. |
| `amount` | N | + para recargas/reembolsos, − para débitos (COP). |
| `balanceAfter` | N | Saldo tras el movimiento (trazabilidad/conciliación). |
| `status` | S | `pending` · `approved` · `declined` · `void`. |
| `reference` | S | Referencia única (para Wompi = idempotencia del webhook; en manual, la referencia bancaria). |
| `wompiTransactionId` | S | Id de la transacción en Wompi (si aplica). |
| `proofS3Path` | S | Ruta del **comprobante** en S3 (recarga manual). |
| `bank` | S | Banco/medio de la transferencia (recarga manual, opcional). |
| `rejectReason` | S | Motivo del rechazo (recarga manual rechazada). |
| `reviewedBy` | S | Admin que aprobó/rechazó la solicitud manual. |
| `processId` / `campaignId` | S | Para débitos/reembolsos de envío (traza al proceso). |
| `actor` | S | Quién (email/admin) originó el movimiento. |
| `detail` | S | Descripción legible. |
| `createdAt` | S | ISO. |

> **Recarga manual:** la solicitud nace con `status='pending'` (sin tocar el saldo) y solo al
> **aprobarse** pasa a `approved` + suma al `balance`. Si se rechaza, `declined` (nunca toca el saldo).

> **Regla de oro:** cada cambio de `balance` escribe **siempre** un `walletTransaction`. El saldo
> es un cache del acumulado del ledger; ante dudas, el ledger manda (auditable, conciliable).

---

## 3. Cálculo del costo (reusar la lógica de `Cost_Estimate`)

- El costo del envío se calcula con **la misma fórmula y tarifas** que `Api_V1_Cost_Estimate`
  (defaults embebidos + overrides de `pricingRate`, `max(subtotal, minCampaign)`, IVA 19%).
- Como las Lambdas no comparten código fácilmente, se **replica** el helper de costo en
  `Prepare-batch` (igual que `Billing_Summary` ya replica `DEFAULT_RATES`).
  ⚠️ **Gotcha de sincronía:** si cambian las tarifas/fórmula en `Cost_Estimate`, actualizar
  también aquí (candidato #1 para mover a un **layer compartido** en fase 2).
- Entradas conocidas en `Prepare-batch` al iniciar: `channel`, nº de registros de la base
  (`registers_on_spool`), `documentFormat` (EAP). Se usan las **mismas aproximaciones** que hoy
  (SMS 1 segmento, Voz `avgMinutes`, sin recargo por MB de adjunto).

---

## 4. Débito atómico + bloqueo en `Prepare-batch` (el corazón)

**Dónde:** en `preparar_split` (rama del **envío real**), junto al bloqueo actual
(`is_real_send_enabled` → `RealSendDisabled`) y al lock de idempotencia (`try_start_real_send`).

**Orden (importa, evita doble cobro y cobros huérfanos):**

1. **Gate manual** (existente): `is_real_send_enabled` → si no, `RealSendDisabled` (403).
2. **Lock de campaña** (existente): `try_start_real_send` (compare-and-set a `Enviando`).
   Si **pierde** el lock → `AlreadySending` (200, no reencola) → **no debita**.
3. **Reserva de saldo (NUEVO)** — solo el que ganó el lock llega aquí, así que se debita **una
   sola vez** (los reintentos de SQS/API no doble-cobran):
   ```python
   costo = estimate_cost(customer_id, channel, registers_on_spool, document_format)  # COP, con mínimo
   try:
       table_balance.update_item(
           Key={'customerId': customer_id},
           UpdateExpression='SET balance = balance - :c, updatedAt = :t',
           ConditionExpression='attribute_exists(customerId) AND balance >= :c',
           ExpressionAttributeValues={':c': costo, ':t': now},
           ReturnValues='UPDATED_NEW')
   except ConditionalCheckFailed:
       release_lock(st)                 # revierte campaignState a 'Pendiente' (o 'SinSaldo')
       raise InsufficientBalance(...)   # -> el handler responde 402
   registrar_walletTransaction(debit_send, -costo, processId, ...)
   guardar_en_proceso(chargedAmount=costo)  # para conciliar en fase 2
   ```
4. **Troceo/encolado** (existente). Si **falla** (excepción) → **reembolsar** el débito
   (`ADD balance +costo` + `refund_send`) y marcar la campaña `Error` (patrón saga/compensación).

**Nueva excepción `InsufficientBalance`** (análoga a `RealSendDisabled`): el handler la atrapa y
responde **402 Payment Required** con mensaje claro ("Saldo insuficiente: necesitas $X, tienes $Y").

**Por qué es seguro:**
- El **lock** garantiza que el débito ocurre **una vez** por envío (idempotencia ante reintentos).
- El **`ConditionExpression balance >= costo`** hace el débito **atómico**: dos campañas
  concurrentes del mismo cliente nunca dejan el saldo negativo (DynamoDB serializa el `UpdateItem`).
- **Liberar el lock** al no haber saldo deja la campaña re-enviable tras recargar.
- **Compensar** (reembolsar) si el troceo falla evita cobrar sin enviar.

**Muestras:** `preparar_muestras` **no** debita (siguen gratis).

---

## 5. Recarga MANUAL (comprobante + revisión/aprobación) — MVP sin pasarela

> El cliente consigna/transfiere por fuera del sistema, **sube el comprobante** desde el
> portal y crea una **solicitud pendiente**; el admin la **revisa contra el extracto** y
> **aprueba o rechaza**. Recién al **aprobar** se acredita el saldo. Autoservicio (el cliente
> hace la captura) + control anti-fraude (el admin verifica antes de acreditar) + trazabilidad
> (el comprobante queda adjunto en S3). **No** requiere tabla nueva: se reusa el `status`
> (`pending`→`approved`/`declined`) de `walletTransaction`.

### 5.1 Cliente crea la solicitud
- **`Api_V1_Balance_Topup-manual-request`** (cliente): `{ amount, bank?, reference?, note? }`.
  - Sube el **comprobante** a S3 (imagen/PDF) reusando el `get-urlS3` que ya usan bases/adjuntos
    (`documentType=document`); guarda su ruta en `proofS3Path`.
  - Crea `walletTransaction(type='topup_manual', status='pending', amount, proofS3Path, actor=cliente)`.
  - **NO** toca el saldo todavía. El tenant sale del token (Authorizer).
- Ruta `/Balance/Topup-manual-request` (cliente, authorizer + CORS).

### 5.2 Admin revisa y decide
- **`Api_V1_Admin_Topups`** (admin): lista las solicitudes **pendientes** (y por estado/mes) con
  el enlace al comprobante (URL prefirmada de lectura), empresa, monto, banco/referencia y fecha.
- **`Api_V1_Admin_Topup-approve`** (admin): `{ txId }`
  - Condicional `status='pending' → 'approved'` (idempotente: si ya no está pendiente, no repite);
    **solo si esa transición pasó**, `ADD balance :amount` (atómico) y setea `balanceAfter`.
  - Audita `balance.topup.approve` (actor = admin, empresa, monto).
- **`Api_V1_Admin_Topup-reject`** (admin): `{ txId, reason }`
  - Condicional `status='pending' → 'declined'` con el motivo. **No** toca el saldo. Audita
    `balance.topup.reject`.
- Rutas `/Admin/Topups`, `/Admin/Topup-approve`, `/Admin/Topup-reject` (admin-only, authorizer + CORS).

### 5.3 Notas
- **Idempotencia:** aprobar/rechazar usa `ConditionExpression status = 'pending'`, así un doble
  clic o reintento no acredita/rechaza dos veces.
- **Sirve desde el día 1** sin depender de Wompi (elimina el riesgo de cartera ya), y deja el
  comprobante guardado para soporte/contabilidad.
- (Opcional) el cliente ve el **estado de su solicitud** (pendiente/aprobada/rechazada + motivo)
  en su historial de movimientos.

---

## 6. Recarga con WOMPI (automática)

> Wompi (Bancolombia) — pasarela colombiana. **Nunca** se acredita saldo desde el redirect del
> navegador: solo desde el **webhook firmado** (server-to-server) o consultando la transacción
> con la llave privada. El front solo refleja el estado en la UI.

### 6.1 Secrets / env (idealmente en Secrets Manager)
`WOMPI_PUBLIC_KEY` · `WOMPI_PRIVATE_KEY` · `WOMPI_INTEGRITY_SECRET` · `WOMPI_EVENTS_SECRET`
(y `WOMPI_ENV` sandbox/prod).

### 6.2 Flujo
1. **Iniciar recarga** — `Api_V1_Balance_Topup-init` (cliente):
   - Recibe `{ amount }` (COP). Genera `reference` única y crea `walletTransaction`
     (`type='topup_wompi'`, `status='pending'`).
   - Calcula la **firma de integridad** del Widget:
     `SHA256(reference + amount_in_cents + "COP" + WOMPI_INTEGRITY_SECRET)`.
   - Devuelve al front: `publicKey`, `reference`, `amountInCents`, `currency`, `signature` y
     (opcional) `redirectUrl`.
2. **Pago** — el front abre el **Widget/Checkout de Wompi** con esos datos; el cliente paga.
3. **Confirmación (fuente de verdad)** — `Api_V1_Wallet_Wompi-webhook` (**público, SIN
   authorizer**, integración proxy):
   - **Verifica la firma del evento**: `signature.checksum` =
     `SHA256(concat(valores de signature.properties, en orden) + timestamp + WOMPI_EVENTS_SECRET)`
     (típicamente `transaction.id + transaction.status + transaction.amount_in_cents`).
     Si no coincide → 401, no acredita.
   - Si `transaction.status == APPROVED` y la `reference` matchea una tx `pending`:
     **acredita** (`ADD balance +amount`) de forma **idempotente**:
     ```python
     # Marca la tx pending -> approved SOLO si estaba pending (evita doble crédito por reintentos del webhook)
     update_item(Key={'txId': tx_id}, UpdateExpression='SET #s=:appr, ...',
                 ConditionExpression='#s = :pending')
     # y solo si esa condición pasó, se hace el ADD al balance.
     ```
   - (Defensa en profundidad opcional) confirmar consultando `GET /transactions/{id}` con la
     llave privada antes de acreditar.
   - Responde 200 siempre que procese/ignore (para que Wompi no reintente en falso).
4. **UI** — el front, tras el redirect, llama `Balance/Get` para refrescar el saldo (o hace
   polling breve); el crédito real ya lo hizo el webhook.

### 6.3 Idempotencia y seguridad
- **Idempotencia:** la condición `status = 'pending'` en el `walletTransaction` evita
  acreditar dos veces si Wompi reintenta el webhook.
- **Anti-fraude:** el `amount` a acreditar sale de la **tx guardada** (por `reference`), no del
  payload crudo; se cruza con el `amount_in_cents` del evento verificado.
- **Nunca** confiar en parámetros del redirect del navegador para acreditar.

---

## 7. Endpoints / rutas nuevas (integración no-proxy salvo el webhook)

| Ruta | Lambda | Rol | Notas |
|------|--------|-----|-------|
| `/Balance/Get` | `Api_V1_Balance_Get` | cliente | Saldo + últimos movimientos/solicitudes (tenant del token). |
| `/Balance/Topup-init` | `Api_V1_Balance_Topup-init` | cliente | Crea tx pending + firma para el Widget Wompi. |
| `/Balance/Topup-manual-request` | `Api_V1_Balance_Topup-manual-request` | cliente | Sube comprobante a S3 + crea solicitud manual **pendiente**. |
| `/Wallet/Wompi-webhook` | `Api_V1_Wallet_Wompi-webhook` | **público (proxy, sin authorizer)** | Verifica firma → acredita. |
| `/Admin/Topups` | `Api_V1_Admin_Topups` | **admin** | Bandeja de solicitudes manuales (pendientes/por estado) + enlace al comprobante. |
| `/Admin/Topup-approve` | `Api_V1_Admin_Topup-approve` | **admin** | Aprueba una solicitud manual → acredita saldo. |
| `/Admin/Topup-reject` | `Api_V1_Admin_Topup-reject` | **admin** | Rechaza una solicitud manual (con motivo). |
| `/Admin/Balances` | `Api_V1_Admin_Balances` | **admin** | Lista saldos + movimientos por cliente. |

> El **débito** vive dentro de `Prepare-batch` (no es una ruta).

---

## 8. Frontend

**Portal (cliente)**
- Sección **"Saldo / Recargas"**: saldo actual (chip), historial de movimientos (de `Balance/Get`),
  y **dos formas de recargar**:
  - **Con tarjeta/PSE (Wompi):** botón que abre el Widget.
  - **Por transferencia (manual):** formulario "Registrar recarga" con monto + banco/referencia +
    **subir comprobante** (imagen/PDF) → crea la solicitud **pendiente** (`Topup-manual-request`).
- El historial muestra el **estado de cada solicitud manual**: pendiente / aprobada / rechazada
  (con motivo).
- Precargar el saldo en `PortalDataProvider` (o incluirlo en `/Portal/Bootstrap`) para tenerlo
  al instante tras el login.
- En **Muestras/Envío real**: junto al `Cost_Estimate` ya existente, mostrar
  "Costo estimado $X · Tu saldo $Y" y **deshabilitar "Enviar real"** si `saldo < costo`, con
  aviso y enlace a Recargar. El backend igual bloquea (defensa doble).

**Admin**
- Sección **"Saldos y recargas"**:
  - **Bandeja de solicitudes manuales pendientes** (`Admin/Topups`): empresa, monto, banco/referencia,
    fecha y **ver comprobante** (URL prefirmada); botones **Aprobar** / **Rechazar** (con motivo).
  - Tabla de **saldos por cliente** (`Admin/Balances`) + ver movimientos.
- Reusa el patrón de `ClientesSection`/auditoría y del visor de adjuntos.

---

## 9. Consideraciones

- **Concurrencia:** el débito atómico (`ADD` condicional) + el lock por campaña garantizan que
  no haya saldo negativo ni doble cobro, incluso con varias campañas del mismo cliente a la vez.
- **Compensación:** si algo falla tras debitar (troceo, encolado), se **reembolsa** (saga).
- **Aproximaciones de costo** (heredadas de `Cost_Estimate`): SMS 1 segmento, Voz `avgMinutes`,
  sin recargo por MB de adjunto. La **conciliación (fase 2)** ajusta al envío/entrega real
  (los estados ya llegan por `ReceptionStatus`; se puede **reembolsar** filtrados/fallidos).
- **Redondeo:** todo en **COP enteros** (Cost_Estimate ya redondea).
- **IVA/DIAN:** factura en la **recarga**; el débito no es hecho gravable. Integrar un proveedor
  de factura electrónica (Alegra/Siigo/Factus) queda para fase 2.
- **`SECRET_KEY`/llaves Wompi:** a **Secrets Manager** (hoy varias llaves son env var).
- **Mínimo por campaña** (`minCampaign`): el débito aplica `max(costo, minCampaign)` como el estimador.

---

## 10. Fases de implementación (orden sugerido)

1. **Fase 1 — Monedero + recarga manual (comprobante+revisión) + débito (núcleo, sin pasarela):**
   Tablas `customerBalance` + `walletTransaction`; `Balance/Get`, `Balance/Topup-manual-request`
   (cliente sube comprobante), `Admin/Topups` + `Admin/Topup-approve` + `Admin/Topup-reject`
   (bandeja de revisión), `Admin/Balances`; débito atómico + `InsufficientBalance` en
   `Prepare-batch`; UI portal (saldo, registrar recarga con comprobante, aviso) + admin (bandeja
   de solicitudes + saldos). **Ya elimina el riesgo de cartera.**
2. **Fase 2 — Wompi:** `Balance/Topup-init` + `Wallet/Wompi-webhook` (firma + idempotencia) +
   Widget en el portal.
3. **Fase 3 — Conciliación:** reembolso automático de filtrados/fallidos sobre el envío real
   (usa `sendStatus`/`ReceptionStatus`); mover el cálculo de costo a un **layer compartido**.
4. **Fase 4 — Fiscal/corporativo:** factura electrónica DIAN en la recarga; postpago con cupo
   para clientes grandes (reusa `Billing_Summary`).

---

## 11. Pruebas (pytest + moto)

- **Débito atómico:** saldo suficiente → debita y encola; saldo insuficiente → `InsufficientBalance`
  (402), **no** se trocea y el lock se libera; concurrencia (dos débitos) nunca deja saldo negativo.
- **Idempotencia:** reintento del mismo envío (AlreadySending) **no** doble-cobra.
- **Compensación:** fallo del troceo tras debitar → reembolso + campaña en Error.
- **Recarga manual (comprobante + revisión):** el cliente crea la solicitud `pending` (con
  comprobante) y el saldo **no** cambia; al **aprobar** el admin, acredita + `walletTransaction`
  `approved` + audita; al **rechazar**, `declined` sin tocar el saldo; aprobar/rechazar dos veces
  es idempotente (condición `status='pending'`); solo admin aprueba/rechaza.
- **Wompi webhook:** firma válida + status APPROVED → acredita una sola vez; webhook repetido →
  idempotente (no doble crédito); firma inválida → 401, no acredita; status DECLINED → no acredita.

---

## 12. Despliegue `[J]`

- Crear tablas **`customerBalance`** (PK `customerId`) y **`walletTransaction`** (PK `txId`
  + GSI `customerId-createdAt-index` para el historial). On-Demand.
- Crear las lambdas vacías: `Api_V1_Balance_Get`, `Api_V1_Balance_Topup-init`,
  `Api_V1_Balance_Topup-manual-request`, `Api_V1_Wallet_Wompi-webhook`, `Api_V1_Admin_Topups`,
  `Api_V1_Admin_Topup-approve`, `Api_V1_Admin_Topup-reject`, `Api_V1_Admin_Balances`.
- Rutas en `infra/api/routes.json` (el webhook = **proxy, sin authorizer**; el resto no-proxy
  con su rol). Permisos IAM:
  - `Prepare-batch`: `UpdateItem` sobre `customerBalance`; `PutItem` sobre `walletTransaction`.
  - `Balance_*`/`Admin_*`: `GetItem`/`PutItem`/`UpdateItem`/`Query` según corresponda.
  - `Topup-manual-request`: además, permiso de **subir el comprobante a S3** (reusa el bucket de
    documentos `{prefix}-{nit}-document` vía `get-urlS3`); `Admin_Topups` necesita **URL prefirmada
    de lectura** del comprobante.
  - `Wompi-webhook`: `UpdateItem` sobre `customerBalance`/`walletTransaction`.
- Secrets Wompi (`WOMPI_*`) en las lambdas de recarga; registrar la **URL del webhook** en el
  panel de Wompi (eventos).
- CORS en las rutas nuevas del navegador.

---

## 13. Decisiones abiertas (confirmar antes de codificar)

1. **Base de cobro del MVP:** ¿reserva sobre el **tamaño de la base** (con conciliación en fase 3)
   o esperamos a fase 3 para cobrar exacto? (Recomiendo reserva + conciliación después.)
2. **¿Bloqueo duro o "cupo negativo" tolerado** para clientes de confianza? (Recomiendo duro en
   MVP; el cupo negativo = postpago, fase 4.)
3. **Unidad:** COP directo (recomendado) vs. créditos.
4. **Monto mínimo de recarga** y montos sugeridos (ej. $50.000 / $100.000 / $200.000).
5. **¿Reembolsar fallidos/filtrados** desde el MVP o solo en fase 3? (Recomiendo fase 3.)
