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

**Dónde se escribe:** `Api_V1_Email_ReceptionStatus` y `Api_V1_Messaging_ReceptionStatus`
llaman `bump_send_summary(...)` tras registrar cada estado. Es **best-effort**: si las
tablas no existen o algo falla, no rompe la recepción (los reportes caen al scan).

**Dónde se lee:** `Api_V1_Reports_Statistics` y `Api_V1_Portal_Bootstrap` leen el resumen
por proceso si `SEND_SUMMARY_READ=true` y existe; si no, agregan por scan (comportamiento
actual). El resultado es idéntico, solo más rápido.

## Dos interruptores (env), para un rollout seguro
- **`SEND_SUMMARY_ENABLED`** (write-side, en los ReceptionStatus): empieza a mantener el resumen.
- **`SEND_SUMMARY_READ`** (read-side, en Statistics/Bootstrap): confía en el resumen.

Están separados a propósito: si activas la lectura **antes** de escribir + backfillear,
mostrarías números incompletos.

## Orden de despliegue (IMPORTANTE)
1. **Provisiona** por cliente las tablas `{customer}_sendState` (PK `processId`+`messageId`)
   y `{customer}_sendSummary` (PK `processId`), on-demand.
2. **Permisos IAM:** a los ReceptionStatus, `UpdateItem` sobre `*_sendState` y `*_sendSummary`;
   a Statistics/Bootstrap, `GetItem` sobre `*_sendSummary`.
3. Activa **`SEND_SUMMARY_ENABLED=true`** en `Api_V1_Email_ReceptionStatus` y
   `Api_V1_Messaging_ReceptionStatus`.
4. Corre el **backfill** por cliente (deja el resumen consistente con lo ya recibido):
   ```
   python scripts/backfill_send_summary.py --customer <empresa> --plan   # revisar
   python scripts/backfill_send_summary.py --customer <empresa>          # aplicar
   ```
5. Activa **`SEND_SUMMARY_READ=true`** en `Api_V1_Reports_Statistics` y `Api_V1_Portal_Bootstrap`.

Antes del paso 5 todo funciona por scan (correcto, solo más lento). Después, las
estadísticas —y por tanto el `Bootstrap`— son O(1) por proceso.

## Notas / límites
- **Consistencia:** si la lambda de recepción se cae justo entre el `update` del estado y el
  `ADD` del resumen, ese único evento puede no reflejarse (deriva mínima). Aceptable para
  métricas; el backfill lo corrige si se re-ejecuta. (Billing NO usa este resumen: lee
  `sendStatus` directo.)
- **Tablas por proceso ya no se escanean** para estadísticas una vez activada la lectura.
- Cuando exista, el resumen podría alimentar también el panel admin (Dashboard) con el
  mismo patrón.
