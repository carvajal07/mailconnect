# Refactor de `Api_V1_Email_Prepare-batch-template` (y su ecosistema)

> Registro de la deuda técnica detectada en `Prepare-batch` y el plan de ataque por
> fases. La lambda es el corazón del envío (muestras + envío real, multicanal) y
> concentra los mayores riesgos del backend. Este documento es la fuente de verdad
> del refactor; se va marcando `[x]` a medida que se cierra.

_Contexto: la revisión se hizo en jul 2026. Autorizado reestructurar el manejo de
tablas en DynamoDB._

---

## Todos los puntos detectados (severidad)

### 🔴 Arquitectura / escala
1. **Una tabla DynamoDB por proceso** (`{customer}_sendStatus_{uuid}`). Cada envío real y
   cada envío de muestras **crea una tabla nueva** → proliferación (límite de cuenta ~2500),
   latencia de creación en cada envío, y los reportes deben "adivinar" el nombre por proceso.
   **Objetivo:** una sola tabla por cliente `{customer}_sendStatus` con **PK `processId` + SK
   `sendStatusId`** (query por `processId`).
2. **Sin idempotencia.** `process_id` es un uuid nuevo por invocación; un reintento (timeout /
   error) re-encola TODO → **envíos duplicados**. **Objetivo:** derivar/persistir el `processId`
   por (campaña + versión) para que un reintento reuse el mismo y no duplique.
3. **CSV grande en una sola invocación.** Descarga a `/tmp` y procesa sincrónico → riesgo de
   **timeout (15 min)** y de `/tmp` con bases de 100k+. **Objetivo:** trocear el archivo y
   encolar por partes (una lambda que reparte, otra que procesa cada parte).

### 🟠 Robustez
4. **Fallos de SQS silenciosos.** `send_sqs`/`send_sqs_batch` atrapan la excepción y solo hacen
   `print`; la campaña queda "Enviando"/"Procesando" aunque no se haya encolado nada. **Objetivo:**
   propagar el fallo, contar los mensajes realmente encolados y marcar Error si no se pudo enviar.
5. **`prepare_message` → posible `UnboundLocalError`.** Si el `try` interno falla, `json_string`
   nunca se asigna y el `return json_string` explota. **Objetivo:** construir el dict fuera de un
   `try` inútil y devolver siempre un JSON válido (o propagar).
6. **`scan` por todos lados** (campaña por `campaignName`, cliente por `customerId`). Costoso y
   `scan` por nombre **no garantiza unicidad**. **Objetivo:** usar `campaignId` cuando se tenga,
   validar unicidad, y a futuro índices/`query`.
7. **Estado global mutado en el handler** (`headers`, `sms_body`, `customer_name`, `count_register`
   …). En Lambda "caliente" los globals persisten entre invocaciones; frágil ante el próximo
   cambio. **Objetivo:** pasar el estado por parámetros/objeto de contexto, no por globals.

### 🟡 Mantenibilidad
8. **Handler de ~600 líneas con ifs muy anidados**, muestras + envío real mezclados y `except:`
   desnudos. **Objetivo:** partir en `preparar_muestras()` y `preparar_real()` + helpers testeables.
9. **`registers_to_send` cuenta los estructuralmente válidos, no los realmente encolados** (incluye
   los filtrados por lista negra / desuscritos). Métrica de reporte imprecisa.
10. **Código muerto** (`search_samples` con bugs: `line.replace` sobre lista, `DELIMITER` fijo).
11. **El handler grande no está testeado end-to-end** (las pruebas solo cubren helpers).

---

## Blast radius de la tabla única (punto 1) — lambdas que tocan `sendStatus`
- **Escriben:** `Prepare-batch` (crea la tabla), envíos `Email_Send-batch-template-{EM,EAU,EAP}`,
  `Sms_Send-batch`, `Wsp_Send-batch`, `Voice_Send-batch`, y las recepciones
  `Email_ReceptionStatus`, `Messaging_ReceptionStatus`.
- **Leen:** `Reports_Statistics`, `Reports_state-report`, `Agent_Reports`.
- Todas deben pasar de `{customer}_sendStatus_{proceso}` (scan) a `{customer}_sendStatus`
  (query por `processId`), con item que incluya **PK `processId` + SK `sendStatusId`**.

---

## Plan de ataque por fases (orden de ejecución)

- [x] **Fase 0 — Quick wins (bajo riesgo):** #5 `prepare_message`, #4 `send_sqs` propaga/marca
      Error, #10 borrar `search_samples`, #9 métrica `registers_to_send`. ✅
- [x] **Fase 1 — Tabla única `sendStatus`** (#1): `{customer}_sendStatus` PK `processId` + SK
      `sendStatusId`. Actualizados **escritores** (Prepare-batch `ensure_status_table` +
      `insert_mails_status`; Send SMS/Voice/WSP; ReceptionStatus Email + Messaging) y **lectores**
      (Statistics, state-report, Agent_Reports → `query` por `processId`). Pruebas: 118 en verde
      (incluye `test_sendstatus_single` que prueba que 2 procesos conviven en 1 tabla y el query
      los aísla). ✅
      - ⚠️ **Pendiente 1b:** `{customer}_sendDetail_{proceso}` sigue siendo tabla-por-proceso
        (mismo anti-patrón, menor impacto: solo lo escribe Prepare-batch y lo lee state-report).
        Colapsar con el mismo esquema en un commit aparte.
      - ⚠️ **Migración/`[J]`:** las tablas viejas `{customer}_sendStatus_{uuid}` quedan huérfanas
        (pre-prod = datos de prueba, no se migran). En AWS: dar a Prepare-batch permiso
        `CreateTable` para `{customer}_sendStatus` (llave compuesta) y a los lectores `Query`.
- [x] **Fase 2 — Idempotencia** (#2): `try_start_real_send()` hace una **transición atómica**
      (conditional update) de la campaña a `Enviando` SOLO si su estado permite iniciar el envío
      (Pendiente/Muestras/Error) y guarda el `sendProcessId` ganador. Si otra invocación ya tomó
      el lock (reintento de Lambda/API Gateway, doble clic, envío concurrente) → lanza
      `AlreadySending` → 200 limpio, **sin re-encolar**. Cierra la ventana de carrera entre leer el
      estado y marcarlo Enviando. Pruebas de idempotencia (gana/pierde lock, Terminada no reenvía,
      Error permite reintento). Suite 118→122. ✅
      - ⚠️ **Límite conocido:** si un envío falla A LA MITAD (ya encoló algunos lotes) y queda en
        `Error`, un reintento re-encola TODO → duplicados parciales de esos lotes. Cerrarlo del
        todo requiere idempotencia por-lote (dedup en SQS/consumidor); queda para Fase 4.
- [ ] **Fase 3 — Partir el handler** (#8, #7, #11): `preparar_muestras()`/`preparar_real()` +
      helpers, quitar globals, pruebas del flujo.
- [ ] **Fase 4 — CSV grande por partes** (#3): trocear + fan-out a otra lambda.
- [ ] **Fase 5 — scan → query / índices** (#6).

_Cada fase va en su propio commit con pruebas. Ante conflicto de prioridad, manda la severidad._
