# DESPLIEGUE.md — Checklist de salida a producción (panel admin + pendientes)

> **Propósito:** lista **accionable y consolidada** de todo lo que falta para que lo
> construido funcione en AWS, más lo que queda pendiente **de mi lado (código)**.
> Complementa a `CLAUDE.md` (estado/contratos) y `README.md` (arquitectura).
>
> Marca `[x]` lo hecho, `[ ]` lo pendiente. `[J]` = tareas de despliegue (Jhon/infra).
> `[C]` = tareas de código (mi lado).
>
> _Región: `us-east-1`. Integración de las rutas de datos: **no-proxy** con envelope._

---

## 0. TL;DR — el orden correcto

1. **Crear las 3 tablas DynamoDB nuevas** (§2).
2. **Crear las 10 lambdas nuevas vacías** (el CD las actualiza al hacer push) (§3).
3. **Crear sus rutas** en API Gateway, todas **admin-only** + **CORS** (§3, §5).
4. **⚠️ Configurar el mapping template de rol** en TODAS las rutas admin no-proxy (§1).
   Sin esto, cada tab nuevo responde **403 "Acceso restringido"** aunque el usuario sea admin.
5. **Dar los permisos IAM** por lambda (§3, §4).
6. **Redesplegar las 4 lambdas modificadas** (config + auditoría) (§4).
7. **Promover a `admin`** al menos un usuario en la tabla `user` (§6).

---

## 1. ⚠️ BLOQUEANTE — Mapping template de rol (rutas admin no-proxy)

Las rutas admin son **no-proxy**: la lambda **solo recibe lo que el mapping template
inyecta**. Hoy no se está pasando el `role`, por eso el panel da 403. En el
**Integration Request** de cada ruta admin, con `Content-Type: application/json`,
usa este **body mapping template**:

```velocity
#set($body = $input.json('$'))
{
  "body": $body,
  "requestContext": {
    "authorizer": {
      "role": "$context.authorizer.role",
      "user": "$context.authorizer.user",
      "userId": "$context.authorizer.userId",
      "customerId": "$context.authorizer.customerId",
      "customer": "$context.authorizer.customer"
    }
  }
}
```

> Las lambdas leen el payload real tanto si viene como `event` directo (legacy) como
> dentro de `event['body']` (este template) — el helper `_get_payload` lo maneja.
> `role` habilita el acceso; `user`/`userId` identifican al **actor en la auditoría**;
> `customerId`/`customer` sirven al multi-tenant de las read-lambdas.
>
> **Alternativa:** pasar esas rutas a integración **proxy** (ahí el context llega solo),
> pero entonces la lambda recibe `event['body']` como string JSON (ya soportado).

- [ ] `[J]` Aplicar el template en: `/Pricing/List`, `/Pricing/Update`, `/Customer/List`,
  `/Customer/Update`, `/Customer/Detail`, `/User/SetRole`, `/Billing/Summary`,
  `/Admin/Dashboard`, `/Admin/Jobs`, `/Admin/Audit`, `/Config/Get`, `/Config/Set`.

---

## 2. Tablas DynamoDB nuevas

| Tabla | PK | SK | Notas |
|-------|----|----|-------|
| `pricingRate` | `customerId` (S) | `channel` (S) | `customerId='*'` = tarifa global. La usan estimador, Pricing_* y Billing. |
| `platformConfig` | `configKey` (S) | — | `Config_Set` la crea sola si falta, pero mejor provisionarla. |
| `adminAudit` | `auditId` (S) | — | Bitácora de auditoría. Si no existe, el lector devuelve vacío y los escritores no rompen. |

- [ ] `[J]` Crear `pricingRate` (PK `customerId` + SK `channel`).
- [ ] `[J]` Crear `platformConfig` (PK `configKey`).
- [ ] `[J]` Crear `adminAudit` (PK `auditId`).

> Todas en modo **On-Demand (PAY_PER_REQUEST)** salvo que prefieras capacidad provisionada.

---

## 3. Lambdas nuevas + rutas + permisos

Crear la **función vacía** (mismo nombre de la carpeta) antes del primer `push`, para
que el CD (`deploy-lambdas.yml`) la actualice. Todas las rutas son **POST**, **admin-only**,
integración **no-proxy** + **CORS** + el mapping template de §1.

| Lambda | Ruta | Permisos IAM (DynamoDB salvo nota) |
|--------|------|-----------------------------------|
| `Api_V1_Pricing_List` | `/Pricing/List` | `GetItem` sobre `pricingRate` |
| `Api_V1_Pricing_Update` | `/Pricing/Update` | `UpdateItem` sobre `pricingRate`; `PutItem` sobre `adminAudit` |
| `Api_V1_Customer_Detail` | `/Customer/Detail` | `Scan` sobre `customer`, `user`, `userData` |
| `Api_V1_User_SetRole` | `/User/SetRole` | `GetItem`/`UpdateItem`/`Scan` sobre `user`; `PutItem` sobre `adminAudit` |
| `Api_V1_Billing_Summary` | `/Billing/Summary` | `Scan` sobre `customer`/`campaign`/`process`; `Query` sobre `*_sendStatus`; `GetItem` sobre `pricingRate` |
| `Api_V1_Admin_Dashboard` | `/Admin/Dashboard` | `Scan` sobre `customer`/`campaign`/`process`; `Query` sobre `*_sendStatus` |
| `Api_V1_Admin_Jobs` | `/Admin/Jobs` | `Scan` sobre `process`/`campaign`; `Query` sobre `*_sendStatus` |
| `Api_V1_Config_Get` | `/Config/Get` | `Scan` sobre `platformConfig` |
| `Api_V1_Config_Set` | `/Config/Set` | `PutItem`/`CreateTable`/`DescribeTable` sobre `platformConfig`; `PutItem` sobre `adminAudit` |
| `Api_V1_Admin_Audit` | `/Admin/Audit` | `Scan` sobre `adminAudit` |

- [ ] `[J]` Crear las 10 funciones vacías + sus rutas + permisos de la tabla.
- [ ] `[J]` Confirmar que el **Authorizer** está asignado a las 10 rutas.

> `*_sendStatus` = permiso sobre el patrón `arn:aws:dynamodb:...:table/*_sendStatus`
> (una tabla por cliente, `{customer}_sendStatus`).

---

## 4. Lambdas EXISTENTES modificadas (redesplegar + permisos extra)

Estas ya existían; en esta tanda se les agregó lógica. Hay que **redesplegarlas** y
darles un permiso extra. Todo es **best-effort con fallback**: si falta el permiso o la
tabla, siguen funcionando como antes (sin auditar / con la env var).

| Lambda | Cambio | Permiso extra |
|--------|--------|---------------|
| `Api_V1_Customer_Update` | Escribe auditoría `customer.realSend` | `PutItem` sobre `adminAudit` |
| `Api_V1_Security_Register` | Lee `SENDER_EMAIL`/`ACTIVATION_URL` de `platformConfig` | `GetItem` sobre `platformConfig` |
| `Api_V1_Security_Create-otp` | Lee `SENDER_EMAIL`/`OTP_EXPIRATION_MIN` de `platformConfig` | `GetItem` sobre `platformConfig` |
| `Api_V1_Security_Recovery-password` | Lee `SENDER_EMAIL`/`OTP_EXPIRATION_MIN` de `platformConfig` | `GetItem` sobre `platformConfig` |

> `Api_V1_User_SetRole`, `Api_V1_Pricing_Update` y `Api_V1_Config_Set` también escriben
> auditoría, pero ya están en §3 (son nuevas) con su permiso `PutItem` sobre `adminAudit`.

- [ ] `[J]` Redesplegar las 4 lambdas y darles el permiso extra.

---

## 5. CORS (recordatorio)

- No-proxy: habilitar **CORS** en la ruta agrega el `OPTIONS` de preflight y los headers
  de respuesta; con eso basta para las rutas admin nuevas.
- Proxy: si alguna ruta se pasa a proxy, la **lambda debe emitir** el header
  `Access-Control-Allow-Origin` en su respuesta (el "Enable CORS" solo añade el OPTIONS).

- [ ] `[J]` Habilitar CORS en las 10 rutas nuevas.

---

## 6. Datos / provisión

- [ ] `[J]` **Promover a `admin`** al menos un usuario: en la tabla `user`, poner
  `role = "admin"` en el ítem del usuario. (Después ya se hace desde la ficha de cliente).
- [ ] `[J]` (Opcional) Cargar la tarifa **global** en `pricingRate` (`customerId='*'`) por
  canal, o dejar que apliquen los `DEFAULT_RATES` embebidos hasta calibrar.
- [ ] `[J]` **Calibrar tarifas** con costos reales (SES/SNS/Meta/AWS EUM) — hoy son indicativas.

---

## 7. Checklist rápido de verificación (post-deploy)

- [ ] Entrar a `/admin` con un usuario `admin` → cargan los tabs sin 403.
- [ ] **Tarifas:** editar la tarifa global de un canal y guardar → recargar y persiste.
- [ ] **Clientes → Ficha:** abrir un cliente, ver sus usuarios, promover/degradar admin.
- [ ] **Facturación / Panel / Trabajos:** cargan datos (o vacío correcto si no hay envíos).
- [ ] **Configuración:** cambiar `OTP_EXPIRATION_MIN` → pedir un OTP → vigencia nueva aplica.
- [ ] **Auditoría:** cada acción anterior aparece en la bitácora con el actor correcto.

---

## 8. Pendiente de MI lado (código) `[C]`

Lo que queda por hacer en el repo (no es despliegue):

- [ ] **WhatsApp — ReceptionStatus:** los recibos de entrega/lectura vienen de **Meta**
  (formato distinto, vía la SNS de `socialmessaging`). Falta el parser (mismo patrón que
  `Api_V1_Messaging_ReceptionStatus` de SMS/Voz, otro formato de evento).
- [ ] **EAP — variable de desuscripción:** el envío EAP aún no reemplaza `{{unsubscribeUrl}}`
  por destinatario (EM y EAU sí). Mismo patrón que EAU (token HMAC + relleno por destinatario).
- [ ] **Trabajos — reencolar:** hoy el monitor es solo lectura. Falta la acción de
  reencolar/reintentar un proceso atascado (requiere permisos SQS + las URLs de las colas).
- [ ] **`verify-code`:** sigue como **stub** (el flujo real de OTP usa create/validate-otp).
- [ ] **Fase 5 (Prepare-batch):** pasar los `scan` a `query`/índices y garantizar la
  **unicidad de campaña** (índice) — última fase del refactor de Prepare-batch.
- [ ] **CI — build del frontend:** agregar `npm ci && npm run build` al workflow para
  atrapar regresiones de TypeScript en cada PR.
- [ ] **(Opcional) Auditoría ampliada:** hoy audita realSend, rol, tarifas y config; se puede
  extender a más acciones adoptando el helper `_audit`.

## 9. Pendiente de seguridad (compartido) `[J]`/`[C]`

- [ ] `[J]` **Confirmar que `SECRET_KEY` sea NUEVA** (32+ bytes). La vieja quedó en el
  **historial git** del repo público; si no se rotó el valor, sigue comprometida.
- [ ] `[J]` Hacer el repo **privado** (o limpiar el historial con BFG/filter-repo).
- [ ] `[C]`/`[J]` Mover `SECRET_KEY` a **AWS Secrets Manager** (hoy es env var).
- [ ] `[J]` Sacar **SES del sandbox** y verificar remitente/dominio.
