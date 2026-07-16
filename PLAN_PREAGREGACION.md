# Pre-agregación de contadores de envío (estadísticas O(1))

> **Objetivo:** que los reportes (Estadísticas, panel, Bootstrap) no tengan que
> **escanear millones de filas** de `{customer}_sendStatus` cada vez, sino leer un
> **resumen ya contado por proceso**. Convierte la lectura de O(nº de mensajes) a O(1)
> por proceso.

## Cómo funciona

**El reto:** la métrica no es un simple `+1` por evento. Un mensaje pasa por varios
estados (Enviado → Entregado → Abierto → Clic) y solo cuenta su **estado de mayor
prioridad**. Al avanzar, un mensaje puede **cambiar de bucket** (p. ej. Rebote → Entregado).
Por eso un contador ingenuo no sirve.

**La solución (transición-consciente):**
1. **`{customer}_sendState`** (PK `processId` + SK `messageId`): guarda el **estado actual**
   de cada mensaje. Se actualiza con un `update_item` **condicional atómico** que solo
   avanza si el nuevo estado tiene mayor prioridad, y devuelve el estado viejo (`ALL_OLD`).
2. **`{customer}_sendSummary`** (PK `processId`): el resumen `{enviados, entregados,
   abiertos, clics, rebotes, quejas}`. Ante cada avance de un mensaje se calcula el
   **delta de buckets**: `ADD` a los buckets ganados y `-1` a los perdidos.

Así el resumen es **exactamente igual** a la agregación por scan (probado en
`test_send_summary.py`, incluido el caso Rebote→Entregado).

**Dónde se escribe (SIEMPRE, sin env — jul 2026):** `Api_V1_Email_ReceptionStatus`,
`Api_V1_Messaging_ReceptionStatus` y `Api_V1_Wsp_ReceptionStatus` llaman `bump_send_summary(...)`
tras registrar cada estado — **por defecto, sin `SEND_SUMMARY_ENABLED`**. Es **best-effort**: si
las tablas no existen o algo falla, no rompe la recepción (los reportes caen al scan por proceso).

**Dónde se lee (SIEMPRE, sin env — jul 2026):** `Api_V1_Reports_Statistics`,
`Api_V1_Portal_Bootstrap`, `Api_V1_Billing_Summary` y `Api_V1_Admin_Dashboard` leen el resumen
por proceso **por defecto**; si un proceso **no** tiene resumen aún, caen al scan de **ese**
proceso (correcto y acotado). Resultado idéntico, solo más rápido.

## Sin interruptores (por defecto escalable)
Se quitaron los env `SEND_SUMMARY_ENABLED`/`SEND_SUMMARY_READ`: la pre-agregación se mantiene y
se lee **siempre**. La seguridad del rollout la da el **fallback por proceso** (un proceso sin
resumen se agrega por scan) y la escritura **best-effort** (si faltan las tablas, no rompe nada).

## Provisión de tablas
- `Api_V1_Email_Prepare-batch-template` **crea** (best-effort, en el envío real) las tablas
  `{customer}_sendSummary` (PK `processId`) y `{customer}_sendState` (PK `processId`+`messageId`),
  igual que ya crea `{customer}_sendStatus`. Así existen antes de que lleguen los eventos.
- **Permisos IAM** (`[J]`): a los ReceptionStatus, `UpdateItem` sobre `*_sendState`/`*_sendSummary`
  (+ `CreateTable`/`GetItem` para Prepare-batch); a los reportes, `GetItem` sobre `*_sendSummary`.
- **Backfill (`[J]`, opcional):** para procesos VIEJOS (anteriores a la pre-agregación) que no
  tengan resumen, correr el backfill por cliente; mientras tanto esos procesos se leen por scan.
  ```
  python scripts/backfill_send_summary.py --customer <empresa> --plan   # revisar
  python scripts/backfill_send_summary.py --customer <empresa>          # aplicar
  ```

## Notas / límites
- **Consistencia:** si la lambda de recepción se cae justo entre el `update` del estado y el
  `ADD` del resumen, ese único evento puede no reflejarse (deriva mínima). Aceptable para
  métricas; el backfill lo corrige si se re-ejecuta. (Billing NO usa este resumen: lee
  `sendStatus` directo.)
- **Tablas por proceso ya no se escanean** para estadísticas una vez activada la lectura.
- Cuando exista, el resumen podría alimentar también el panel admin (Dashboard) con el
  mismo patrón.
