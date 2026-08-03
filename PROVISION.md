# PROVISION.md — Memoria, timeout y costos (bajo demanda vs aprovisionado)

> **Qué es esto:** cómo debería quedar configurada cada lambda (memoria y timeout) y qué
> cuesta de verdad la plataforma. Complementa a `DESPLIEGUE.md` (qué crear) diciendo **con
> qué números**.
>
> Precios de referencia: **us-east-1, arquitectura x86**, tomados de las listas públicas de
> AWS. Son órdenes de magnitud para decidir, no una cotización — verifica en la calculadora
> de AWS antes de comprometer presupuesto.

---

## 0. El resumen, por si no lees el resto

1. **Hoy las 121 lambdas están en 256 MB / 60 s** (el default que pone el CD al crearlas).
   Para la mayoría está bien, pero **cuatro del pipeline están en riesgo real de timeout**:
   `Send-batch-template-EAP`, `Template_Combination-EAP-PDF`, `Template_Combination` y
   `Prepare-batch-template`. Ver §2.
2. **La concurrencia aprovisionada (Provisioned Concurrency) no tiene sentido aquí.**
   Cuesta **~$331/mes** poner una sola unidad en cada lambda; el cómputo de una campaña de
   100.000 correos cuesta **$0,02**. Ver §4.
3. **DynamoDB debe quedarse bajo demanda.** Aprovisionar sale 7× más barato *solo si*
   mantienes >15% de utilización sostenida; el perfil real es una ráfaga cada varios días.
   Ver §5.
4. **El costo de esta plataforma es SES, no la infraestructura.** En una campaña de 100.000
   correos, SES es el **98%** de la factura. Optimizar lambdas es optimizar el 2%.
5. Lo que sí conviene y **es gratis**: poner **concurrencia reservada** (que es un TOPE, no
   una reserva de pago) en los workers, para que una campaña grande no se coma la
   concurrencia de la cuenta y deje el portal sin responder. Ver §4.3.

---

## 1. Cómo se decide la memoria en Lambda

Dos cosas que cambian la intuición:

- **La CPU va atada a la memoria.** No se configura aparte. A ~1.769 MB se obtiene 1 vCPU
  completa; por debajo, una fracción. Para trabajo limitado por CPU (renderizar un PDF,
  parsear un JSON grande) **subir la memoria suele salir más barato**: se paga por GB-segundo,
  así que si el doble de memoria hace el trabajo en la mitad del tiempo, el costo es idéntico
  — y si lo hace en menos de la mitad, es más barato *y* más rápido.
- **Para trabajo limitado por red** (esperar a SES, a DynamoDB, a la API de Twilio) subir la
  memoria **no acelera nada**: se paga más por esperar igual. Ahí conviene el mínimo cómodo.

Casi todo este backend es del segundo tipo. Las excepciones son los renderizadores de PDF y
los agregadores que escanean tablas.

### El timeout no es "por si acaso"

Un timeout generoso **no cuesta** (se factura la duración real, no el límite), pero tiene dos
efectos que sí importan:

- **Detrás de API Gateway REST el techo real es 29 s** (cuota por defecto, ampliable por
  solicitud). Poner 60 s en una lambda de API es ficción: a los 29 s el cliente ya recibió un
  504 y la lambda sigue corriendo y facturando sin que nadie escuche la respuesta.
- **En un worker de SQS, el timeout manda sobre el `VisibilityTimeout` de la cola.** Si la
  función puede tardar 300 s y la cola libera el mensaje a los 360 s, va justo. Si subes la
  función a 600 s sin tocar la cola, **SQS re-entrega el mensaje mientras la primera
  invocación sigue trabajando** → dos procesos sobre el mismo lote. Aquí el claim atómico
  (`_claim_part`) evita el envío duplicado, pero se desperdicia cómputo y se ensucian los
  logs. **La regla de AWS: `VisibilityTimeout` ≥ 6 × timeout de la función.**

---

## 2. Configuración recomendada por grupo

`trigger-map.json` ya acepta `visibilityTimeout` por cola, que es donde se aplica la columna
de la derecha.

### Grupo A · API de lectura/escritura ligera — **la mayoría (~95 lambdas)**

`Campaign_*`, `Template_*` (salvo los de render), `MessageTemplate_*`, `Database_*`,
`Blacklist_*`, `Domain_*`, `User_*`, `Security_*`, `Balance_*`, `Notifications_{List,Prefs}`,
`Schedule_*`, `Provider_*`, `SendingConfig_*`, `Config_*`, `Cost_Estimate`, `Resources_List`…

| Memoria | Timeout | Por qué |
|---|---|---|
| **256 MB** | **15 s** | Un GetItem/Query y responder. Nunca pasan de ~1 s. 15 s deja margen para un reintento de DynamoDB y **falla rápido** en vez de dejar al usuario 60 s mirando un spinner por algo que ya se colgó. |

### Grupo B · Agregadores y escaneos

`Admin_Dashboard`, `Admin_Control-center`, `Admin_Jobs`, `Admin_Audit`, `Admin_Balances`,
`Admin_Recipient-lookup`, `Billing_Summary`, `Reports_Statistics`, `Reports_Series`,
`Reports_state-report`, `Portal_Bootstrap`, `Agent_Reports`, `Database_Verify`.

| Memoria | Timeout | Por qué |
|---|---|---|
| **1024 MB** | **29 s** | Hacen `Scan` + `BatchGetItem` sobre muchos procesos y arman el JSON en memoria. Aquí sí son CPU-bound: a 1024 MB tienen ~0,6 vCPU y el agregado baja de forma notable. 29 s = el techo de API Gateway; más no sirve. |

⚠️ `Database_Verify` con el layer de `dnspython` hace lookups DNS **secuenciales** (tope 200
dominios). Es el candidato más probable a rozar los 29 s con una base sucia y grande.

### Grupo C · Renderizado de PDF síncrono

`Template_Render-pdf`, `Template_Render-engine`, `Cost_Attachment-weight`.

| Memoria | Timeout | Por qué |
|---|---|---|
| **2048 MB** | **29 s** | ReportLab/xhtml2pdf son puro CPU. A 2048 MB hay >1 vCPU: el render baja de segundos a décimas y el **costo total no sube** (se paga GB-s y la duración cae proporcional). `Cost_Attachment-weight` además **invoca** a los otros dos y espera → necesita el timeout alto aunque su propio trabajo sea poco. |

### Grupo D · Workers del pipeline (SQS) — **donde está el riesgo**

| Lambda | Carga por mensaje | Memoria | Timeout | `visibilityTimeout` de la cola |
|---|---|---|---|---|
| `Email_Prepare-batch-template` | 1 parte = **5.000 filas** (`PART_SIZE`) → filtra listas, deduplica y encola | **1024 MB** | **300 s** | **1800** |
| `Email_Send-batch-template-EM` | 250 destinatarios → 5 × `send_bulk(50)` | **512 MB** | **120 s** | **900** |
| `Email_Send-batch-template-EAU` | 250 destinatarios en trozos de 25, con adjunto | **1024 MB** | **300 s** | **1800** |
| `Email_Send-batch-template-EAP` | **100 destinatarios, cada uno con `get_object` de S3 + `send_raw_email`** | **1024 MB** | **300 s** | **1800** |
| `Template_Combination-EAP-PDF` | **100 destinatarios × renderizar un PDF con ReportLab** | **2048 MB** | **600 s** | **3600** |
| `Template_Combination` (DOCX) | 100 destinatarios × combinar un .docx | **1024 MB** | **300 s** | **1800** |
| `Sms_Send-batch` | 100 SMS, uno por llamada a la API | **512 MB** | **180 s** | **1080** |
| `Wsp_Send-batch` | 100 mensajes | **512 MB** | **180 s** | **1080** |
| `Voice_Send-batch` | 50 llamadas | **512 MB** | **180 s** | **1080** |

⚠️ **Los dos que hay que subir sí o sí:**

- **`Send-batch-template-EAP`** hace, por cada uno de los 100 destinatarios, un `get_object`
  de S3 y un `send_raw_email` **en serie**. A 250–400 ms por vuelta son **25–40 s**. Con el
  timeout en 60 s, un día lento de S3 o de SES lo revienta — y al reventar, SQS re-entrega y
  vuelve a intentar el lote entero.
- **`Template_Combination-EAP-PDF`** renderiza **100 PDFs** con ReportLab en una sola
  invocación, a 256 MB (o sea, ~0,15 vCPU). Es el trabajo más pesado de toda la plataforma
  corriendo con la configuración más pequeña.

### Grupo E · Crons

| Lambda | Memoria | Timeout |
|---|---|---|
| `Notifications_Scan` (recorre todos los clientes) | **1024 MB** | **600 s** |
| `Cascade_Advance` | **512 MB** | **300 s** |
| `Schedule_Dispatch` / `Schedule_Fire` | **256 MB** | **60 s** |
| `Cron_DeleteTables` / `SQS_DeleteTables` | **256 MB** | **300 s** |

### Grupo F · Authorizers y públicas

| Lambda | Memoria | Timeout | Nota |
|---|---|---|---|
| `Authorizer`, `Authorizer2` | **256 MB** | **10 s** | Corren en **cada** petición. Son JWT con stdlib: milisegundos. El arranque en frío (~200 ms) es el único visible por un usuario, y se amortigua con el caché de autorizadores de API Gateway (bajar el TTL a 60–300 s por la revocación de sesiones, ver `CLAUDE.md`). |
| `Assistant_Ask`, `Assistant_Copilot` | **512 MB** | **29 s** | Esperan a Bedrock. El timeout debe superar la latencia del modelo o el usuario ve un error justo cuando la respuesta venía en camino. |
| `Email_Unsubscribe`, `Email_Preferences` | **256 MB** | **15 s** | Páginas públicas firmadas. |
| `Wallet_Wompi-webhook` | **256 MB** | **30 s** | Si tarda, Wompi reintenta; es idempotente por `reference`. |
| `Email_ReceptionStatus`, `Messaging_ReceptionStatus`, `Wsp_ReceptionStatus` | **512 MB** | **60 s** | Reciben ráfagas de eventos de SNS. |

### Cómo aplicarlo

```bash
# Una lambda
aws lambda update-function-configuration \
  --function-name Api_V1_Email_Send-batch-template-EAP \
  --memory-size 1024 --timeout 300

# Su cola (OBLIGATORIO al subir el timeout: ver §1)
aws sqs set-queue-attributes \
  --queue-url "$(aws sqs get-queue-url --queue-name Email_Send-batch-raw-EAP --query QueueUrl --output text)" \
  --attributes VisibilityTimeout=1800
```

⚠️ El CD **solo** fija memoria/timeout al **crear** una función (`NEW_FN_TIMEOUT` /
`NEW_FN_MEMORY` en `deploy-lambdas.yml`); en las que ya existen no los toca. Es decir: esto
se aplica una vez a mano (o se agrega al workflow) y no se pisa en el siguiente push.

---

## 3. Precios unitarios de referencia (us-east-1, x86)

| Recurso | Bajo demanda | "Aprovisionado" |
|---|---|---|
| **Lambda — peticiones** | $0,20 por millón | igual |
| **Lambda — duración** | $0,0000166667 por GB-s | $0,0000097222 por GB-s *(con PC activa)* |
| **Lambda — concurrencia aprovisionada** | — | $0,0000041667 por GB-s, **siempre encendida** |
| **DynamoDB — escritura** | $1,25 por millón de WRU | WCU: $0,00065/hora |
| **DynamoDB — lectura** | $0,25 por millón de RRU | RCU: $0,00013/hora |
| **SQS** | $0,40 por millón (1M gratis/mes) | no existe |
| **API Gateway REST** | $3,50 por millón de llamadas | no existe |
| **SES — envío** | $0,10 por cada 1.000 correos | — |
| **SES — adjuntos** | $0,12 por GB | — |
| **SES — IP dedicada** | — | **$24,95/mes por IP** |

Concurrencia aprovisionada, llevado a mes (730 h): **$10,95 por GB encendido 24×7**.
→ 256 MB = **$2,74/mes** · 512 MB = **$5,47** · 1024 MB = **$10,95** · 2048 MB = **$21,90**.
**Por lambda y por unidad de concurrencia**, se use o no.

---

## 4. Lambda: bajo demanda vs concurrencia aprovisionada

### 4.1 Qué compra realmente la concurrencia aprovisionada

**Solo una cosa: eliminar el arranque en frío.** No da más capacidad ni más velocidad de
ejecución. Se paga por tener N entornos ya inicializados y esperando.

Tiene sentido cuando el arranque en frío es (a) largo y (b) visible para un humano: una API
de baja latencia en Java/.NET, o Python con un layer pesado que tarda segundos en importar.

### 4.2 Por qué aquí no aplica

- **El arranque en frío de estas lambdas es corto.** Casi todas son Python con stdlib y
  boto3: del orden de **200–400 ms**. Las únicas pesadas son las de PDF (ReportLab + Pillow),
  y esas corren **en cola**, donde nadie está esperando en pantalla.
- **El tráfico es en ráfagas, no sostenido.** Una campaña dispara cientos de invocaciones en
  minutos y después no pasa nada durante días. La concurrencia aprovisionada se paga **por
  segundo, encendida o no**: es exactamente el patrón contrario al que compensa.
- **Son 121 funciones.** El costo se multiplica por función.

**La cuenta, para que se vea la escala:**

| | Costo mensual |
|---|---|
| 1 unidad de concurrencia aprovisionada a 256 MB en **cada una de las 121** lambdas | **≈ $331** |
| Todo el cómputo de una campaña de **100.000 correos**, bajo demanda | **≈ $0,02** |

Son cuatro órdenes de magnitud. Y ese gasto de $331 no compraría ni un correo más ni un
segundo menos de campaña: solo quitaría ~300 ms de arranque en un pipeline que tarda minutos.

**Si aun así quisieras usarla en algún punto**, el único candidato defendible es el
**Authorizer** (corre en cada petición y su latencia sí la siente el usuario). Serían
$2,74/mes por unidad… para ahorrar ~200 ms en la primera petición tras un rato de inactividad,
cuando además el caché de autorizadores de API Gateway ya evita la mayoría de esas llamadas.
No lo recomiendo; si la latencia del portal molesta, el problema está en el Grupo B
(agregadores), y ahí se arregla con memoria y con el rollup, no con PC.

### 4.3 Lo que sí conviene, y es gratis: concurrencia **reservada**

No confundir con la aprovisionada. La **reservada** es un **tope** — no cuesta nada, solo
aparta un pedazo del límite de concurrencia de la cuenta (1.000 por región por defecto).

El riesgo real es este: una campaña grande hace que SQS escale los workers agresivamente; si
consumen las 1.000 unidades, **el portal y el login se quedan sin concurrencia** y los
clientes ven errores mientras alguien más envía.

Recomendación:

| Lambda | Concurrencia reservada |
|---|---|
| `Send-batch-template-EM` | 50 |
| `Send-batch-template-EAU` / `-EAP` | 20 cada una |
| `Template_Combination` / `-EAP-PDF` | 10 cada una |
| `Sms_Send-batch` | 20 |
| `Email_Prepare-batch-template` | 20 |

```bash
aws lambda put-function-concurrency \
  --function-name Api_V1_Email_Send-batch-template-EM --reserved-concurrent-executions 50
```

⚠️ Un efecto secundario deseable: **también limita el ritmo de envío**, que ayuda a no pasarse
de la cuota por segundo de SES. Un efecto no deseable: si lo pones demasiado bajo, los
mensajes esperan más en la cola. 50 × 250 destinatarios por invocación es capacidad de sobra.

---

## 5. DynamoDB: bajo demanda vs aprovisionada

Aquí la decisión **sí** es real: aprovisionada puede salir mucho más barata.

**El punto de equilibrio.** 1 WCU aprovisionada cuesta $0,4745/mes y da 1 escritura/segundo,
o sea **2.628.000 escrituras al mes si se mantiene saturada**. Esas mismas escrituras bajo
demanda costarían $3,29. → **7× más barata… al 100% de utilización.** Se empatan alrededor
del **14–15%** de utilización sostenida.

**El perfil real de MailConnect no llega ahí:**

- Una campaña de 100.000 correos escribe ~100.000 filas de `sendStatus` en unos minutos y
  después la tabla no recibe **nada** durante días. La utilización mensual está en el orden
  del **1%**.
- Las tablas por cliente (`{tenant}_sendStatus`, `_sendDetail`, `_processDetail`,
  `_blackList`, `_unsubscribe`, `_sendSummary`) **se crean solas** cuando entra un cliente
  nuevo. Con capacidad aprovisionada habría que dimensionar y vigilar 6 tablas más por cada
  cliente que se registre — un costo operativo que no compensa unos centavos.
- Una ráfaga contra capacidad aprovisionada da **throttling**, y en este pipeline un throttle
  se traduce en reintentos de SQS y lotes reprocesados.

**Recomendación: dejar todo bajo demanda.** Si lo que preocupa es un gasto descontrolado, la
herramienta correcta no es cambiar a aprovisionada sino ponerle a la tabla un **tope de
rendimiento máximo** (`maximum throughput`), que acota el gasto sin perder la elasticidad.

**Cuándo reconsiderarlo:** si algún día hay envíos constantes durante todo el día (varios
clientes grandes solapados) y CloudWatch muestra utilización sostenida por encima del 20%,
ahí sí vale la pena aprovisionar **las tablas centrales** (`campaign`, `process`, `user`,
`customer`) con autoescalado, y dejar las de cliente bajo demanda.

---

## 6. Qué cuesta de verdad una campaña

Campaña de **100.000 correos**, canal EM, con la configuración recomendada:

| Concepto | Cálculo | Costo |
|---|---|---|
| **SES** | 100.000 × $0,10/1.000 | **$10,00** |
| DynamoDB (escrituras de estado) | ~100.000 WRU + rollup | ~$0,15 |
| Lambda (duración) | ~1.220 GB-s | $0,02 |
| Lambda (peticiones) | ~420 | <$0,01 |
| SQS | ~1.300 llamadas | <$0,01 |
| **Total** | | **≈ $10,20** |

**SES es el 98%.** Es la conclusión que debería guiar cualquier optimización: bajarle memoria
a las lambdas para ahorrar es trabajar sobre el 0,2% de la factura. Lo que mueve la aguja es
el precio por correo y **no enviar a quien no toca** — de ahí que la lista negra, la
verificación de higiene y la deduplicación valgan plata de verdad, no solo cumplimiento.

Para comparar: la tarifa que la plataforma cobra al cliente arranca en ~30 COP por correo
(≈ $0,0075). El costo AWS por correo es ~$0,0001. El margen no está en la infraestructura.

**Campaña de 100.000 con PDF personalizado (EAP)** — muy distinta:

| Concepto | Costo |
|---|---|
| SES (con adjuntos, ~200 KB c/u ⇒ ~20 GB) | $10,00 + $2,40 |
| Lambda del combinador: 1.000 mensajes × ~60 s × 2 GB = 120.000 GB-s | **$2,00** |
| S3 (100.000 PUT + 100.000 GET) | ~$0,55 |
| **Total** | **≈ $15** |

Aquí el cómputo sí pesa (13%), y es exactamente donde subir la memoria **ahorra**: a 2048 MB
en vez de 256 MB el render va ~8× más rápido, así que los GB-s bajan aunque el precio por
GB-s sea el mismo.

---

## 7. El free tier, para no llevarse sorpresas

- **Lambda:** 1M peticiones + 400.000 GB-s al mes, sin vencimiento en el modelo clásico.
  Con el uso de estas pruebas, el cómputo cae entero dentro.
- **SQS:** 1M peticiones al mes.
- **DynamoDB:** 25 GB de almacenamiento.
- **SES:** ⚠️ **el envío desde Lambda/EC2 ya no trae 62.000 correos gratis** en el esquema
  actual — no cuentes con ello.
- ⚠️ AWS cambió el free tier para cuentas nuevas (créditos iniciales en vez de capa gratuita
  perpetua). **Revisa en tu consola cuál de los dos esquemas aplica a tu cuenta** antes de
  planear sobre esto.
