# PLAN — Cascada omnicanal ("entrega garantizada al menor costo")

> **Diferenciador Opción A.** El cliente define **un mensaje lógico** y una **prioridad de
> canales**; la plataforma envía por el primer canal y **escala automáticamente** al siguiente
> (p. ej. WhatsApp → SMS → Voz, o Email → WhatsApp → SMS) hasta **confirmar** la entrega/lectura
> o **agotar** los canales, respetando **consentimiento** y **saldo**. "Defines el mensaje, no
> el canal."

## 1. Por qué (caso de uso)
Cobranzas/cartera, recordatorios de pago, citas, alertas y OTPs: el objetivo NO es "mandar un
correo", es **que el mensaje llegue** al menor costo. Hoy eso se arma a mano en 4 herramientas.
La cascada lo unifica sobre lo que MailConnect ya tiene (4 canales + recibos de entrega +
monedero prepago).

## 2. Concepto y contrato
Una **cascada** (`cascadeRun`) define:
- `steps`: lista ORDENADA de pasos `{ channel: EM|EAU|EAP|SMS|WSP|VOZ, ref }`. `ref` = el
  contenido por canal, reutilizando lo existente: nombre de plantilla SES (email),
  `messageTemplateId` (SMS/WSP) o texto (VOZ).
- `successCriterion`: `sent` | `delivered` | `read`. Define cuándo un contacto se considera
  **confirmado** (y por tanto NO se escala).
- `waitMinutes`: ventana de espera por paso. Si pasa sin confirmar, se escala.
- `budgetCap` (opcional): tope de gasto de la cascada (además del saldo del monedero).
- `dataPath`: la base (CSV) con los contactos. La col. 2 es el contacto del **primer** canal;
  para escalar entre email↔celular la base debe traer **ambos** (correo y celular) — ver §6.

**Motor de decisión** (`decide_next`, función pura y probada): dado el estado de un contacto
(paso actual, resultado del último envío, minutos transcurridos, saldo restante, consentimiento
por canal) devuelve la acción: `wait` · `done` · `send(nextChannel)` · `budget` · `exhausted`.

```
confirmado                      -> done
pendiente y elapsed < wait      -> wait
falló  ó (pendiente y venció)   -> siguiente canal permitido:
      sin canales               -> exhausted
      saldo < costo(canal)      -> budget
      sin consentimiento canal  -> saltar al siguiente
      else                      -> send(nextChannel)
```

## 3. Modelo de datos
- **`cascadeRun`** (PK `cascadeRunId`; GSI `customerId-index`): `customerId, customer, nit, name,
  steps[], successCriterion, waitMinutes, budgetCap, dataPath, processId, status
  (running|done|canceled), spent, counts{total,confirmed,exhausted,inFlight}, createdAt`.
- **`cascadeContact`** (PK `cascadeContactId`; GSI `cascadeRunId-index`): `cascadeRunId,
  customerId, contactKey, row[], stepIndex, status (awaiting|confirmed|exhausted|budget),
  lastChannel, lastUniqueId, lastSentAt, nextCheckAt, history[{channel,uniqueId,sentAt,outcome}]`.

## 4. Flujo
1. **Definir** (front `CascadaSection`): elegir base, orden de canales + contenido por canal,
   criterio de éxito, ventana. Ver **costo estimado** (mejor caso = todos confirman en el paso 1;
   peor caso = todos recorren toda la cascada).
2. **Lanzar** → `Api_V1_Cascade_Dispatch`: valida (tenant, saldo, consentimiento), crea el
   `cascadeRun` + un `cascadeContact` por contacto en el paso 0 (`awaiting`, `nextCheckAt = now +
   waitMinutes`), **encola** el envío del paso 0 por la cola del canal (mismo formato que
   Prepare-batch → lo consumen las lambdas Send-*) y **debita** el costo del paso 0.
3. Los **recibos** de entrega fluyen como siempre a `{tenant}_sendStatus` (ReceptionStatus por
   canal). Cada envío de cascada lleva `uniqueId = cascadeContactId` para poder correlacionar.
4. **Tick** `Api_V1_Cascade_Advance` (EventBridge cron, p. ej. cada 10–15 min): por cada
   `cascadeContact` `awaiting` cuya ventana venció, lee su último estado en `{tenant}_sendStatus`,
   clasifica el resultado (`confirmed|failed|pending`), llama a `decide_next` y actúa: marca
   `done`/`exhausted`, o **escala** (encola el siguiente canal + debita + actualiza `nextCheckAt`).
5. **Fin** por contacto: confirmado, canales agotados, o saldo/tope insuficiente.

## 5. Reutilización (no se reinventa el envío)
- **Envío**: las colas por canal (`URL_SQS_*`) y las lambdas Send-* existentes.
- **Recibos**: `{tenant}_sendStatus` + `*_ReceptionStatus` (email/SMS/voz/WhatsApp) ya escriben
  estados 1..11 y `delivered/read/failed`.
- **Cobro**: `customerBalance` + `walletTransaction` (débito por paso, tipo `debit_send`).
- **Consentimiento**: `{tenant}_blackList` + `{tenant}_unsubscribe`.
- **Costo**: misma tabla de tramos `VOLUME_TIERS` / `pricingRate` del estimador.
- **Llaves por cliente**: `tenant_key(nit)`.

## 6. Estado de esta entrega (v1) y lo que falta `[J]`
**Implementado y probado (backend):**
- ✅ **Motor `decide_next`** (puro) con pruebas exhaustivas (`08_Pruebas/PruebasSeguridad/test_cascade.py`).
- ✅ **`Api_V1_Cascade_Dispatch`**: crea `cascadeRun` + `cascadeContact`, filtra consentimiento del
  paso 0, encola el paso 0 por la cola del canal, debita el costo del paso 0 (monedero). Probado
  con moto (estado en DynamoDB + mensajes en SQS + débito).
- ✅ **`Api_V1_Cascade_Advance`**: tick del motor — escala/keeps/termina según el estado leído de
  `{tenant}_sendStatus`. Probado con moto (transiciones de estado + escalamiento + débito).
- ✅ **`Api_V1_Cascade_List`**: runs del tenant + progreso agregado.
- ✅ **Front**: `CascadaSection` (definir + costo estimado + lanzar + ver progreso) + `cascadeService`.
  Dos MODOS de definición (selector arriba): **Básico** (lista ordenada de canales) y **Flujo**
  (editor de nodos tipo React Flow — `@xyflow/react`: arrastrar-soltar desde la paleta, aristas
  animadas con dirección, nodos personalizados Inicio→canales→Confirmado). Ambos producen el mismo
  `steps[]` (`CascadaFlowBuilder.deriveSteps` sigue la cadena del grafo) → el backend no cambia.

**Pendiente de INTEGRACIÓN/DESPLIEGUE `[J]` (Fase 2 — no verificable sin AWS):**
- Correlación fina `sendStatus`→`cascadeContact`: las lambdas Send-* deben propagar el
  `uniqueId = cascadeContactId` y el `processId = cascadeRunId` (hoy la cascada ya los envía en el
  mensaje; falta confirmar que cada Send-* los persista en `sendStatus`).
- **EventBridge cron** que invoque `Api_V1_Cascade_Advance` cada 10–15 min.
- Tablas `cascadeRun` (+ GSI `customerId-index`) y `cascadeContact` (+ GSI `cascadeRunId-index`).
- Rutas API Gateway (authorizer + CORS): `/Cascade/Dispatch`, `/Cascade/List`, `/Cascade/Advance`.
- IAM: `dynamodb:*` sobre las 2 tablas + lectura de `{tenant}_sendStatus`/`_blackList`/
  `_unsubscribe`; `sqs:SendMessage` a las colas de canal; monedero (`customerBalance`,
  `walletTransaction`).
- Base con **contacto por canal**: para escalar email↔celular, la base debe traer correo Y celular
  (columnas). v1 usa la col. 2 como contacto del canal del paso; el mapeo de contacto por canal
  (una columna por tipo) es una mejora de la carga de bases (Fase 2).

## 7. Fases
- **Fase 1 (esta):** definición + motor + estado + costo + UI (arriba).
- **Fase 2:** wiring de recibos + cron + tablas/rutas/IAM; base con contacto por canal.
- **Fase 3:** métricas de cascada (¿en qué canal se confirmó cada contacto?), reglas por horario
  (no llamar de noche), y "mejor canal aprendido" por segmento.
