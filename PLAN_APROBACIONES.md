# PLAN_APROBACIONES.md — Flujo de aprobación + Roles (RBAC)

> Diseño del flujo **maker-checker** (funcional prepara/prueba → aprobador autoriza y envía)
> y del **control de acceso por rol** (cada rol ve/usa solo los módulos que le corresponden).
> Se implementa en **2 fases**. Este documento es el contrato; ante conflicto con el código,
> manda el código ya mergeado, y este doc se actualiza.

Rama de trabajo: `claude/flujo-aprobaciones-rbac` (a partir de `main`).

---

## 0. Problema que resuelve

Hoy el envío de muestras y su aprobación viven en **estado local del navegador**
(`MuestrasSection` con `useState`): se pierde al recargar y **no es multi-usuario** (si un
funcional envía muestras, su jefe no ve nada). Además, el botón "Enviar campaña real" queda
escondido detrás de "enviar muestras → aprobar" en la misma sesión. Queremos:

1. **Persistir** el flujo de aprobación en la campaña (multi-usuario, sobrevive recargas).
2. **Separar por rol**: un **funcional** prepara y prueba; un **aprobador** autoriza y ejecuta
   el envío real (que cuesta saldo y reputación).
3. **RBAC**: cada rol tiene asignados los **módulos/tabs** a los que puede entrar.

---

## 1. Máquina de estados de la campaña

Se conserva `campaignState` (progreso de envío) y se agrega un campo dedicado
`approvalStatus` (flujo de aprobación), para no sobrecargar un solo campo.

```
approvalStatus:  none ──(solicitar)──▶ pending ──(aprobar)──▶ approved ──(envío real)──▶ (sending)
                                          │
                                          └──(rechazar, con motivo)──▶ rejected ──(reabrir/editar)──▶ none

campaignState:   Pendiente ──▶ Muestras ──▶ Enviando ──▶ Procesando ──▶ Terminada / Error
```

- **`none`**: campaña creada/en preparación. Aún no se pide aprobación.
- **`pending`**: el funcional envió muestras y **solicitó aprobación**. En la bandeja del aprobador.
- **`approved`**: el aprobador la **aprobó**. Habilitado el **envío real**.
- **`rejected`**: el aprobador la **rechazó** (con motivo). Vuelve al funcional para corregir.

**Regla:** solo se puede **solicitar aprobación** si la campaña tiene ≥1 envío de muestras
(`samplesSentCount > 0`) y está en estado enviable (`Pendiente`/`Muestras`). El **envío real**
solo procede con `approvalStatus == approved` (además del gate ya existente de saldo +
`realSendEnabled`).

### Campos nuevos en la tabla `campaign`
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `approvalStatus` | String | `none` (default) `pending` `approved` `rejected` |
| `approvalRequestedBy` / `...ByName` / `...At` | String | Quién solicitó y cuándo |
| `approvalReviewedBy` / `...ByName` / `...At` | String | Quién aprobó/rechazó y cuándo |
| `approvalRejectReason` | String | Motivo del rechazo (visible al funcional) |
| `sampleBatches` | List | Historial de envíos de muestras: `{batchId, tipo, recipients[], quantity, sentBy, sentByName, sentAt}` |

---

## 2. Endpoints (Fase 1)

Todos multi-tenant (customerId del Authorizer), envelope estándar no-proxy.

| Endpoint | Request | Respuesta |
|----------|---------|-----------|
| `Campaign/Request-approval` | `{ campaignId }` | 200 ok · 400 (sin muestras) · 403 (otro cliente / rol) · 404 · 409 (estado inválido). `none→pending`. Audita `campaign.request-approval` |
| `Campaign/Approve` | `{ campaignId }` | 200 ok · 403 · 404 · 409 (no `pending`). `pending→approved`. Audita `campaign.approve` |
| `Campaign/Reject` | `{ campaignId, reason }` | 200 ok · 400 (sin motivo) · 403 · 404 · 409. `pending→rejected`. Audita `campaign.reject` |

- `Campaign/List` ya devuelve el item completo → los campos de aprobación fluyen solos
  (se hace `_clean` **recursivo** para serializar `sampleBatches`).
- `Prepare-batch` (muestras) registra un `sampleBatch` en la campaña al enviar muestras OK.
- El **envío real** sigue siendo `Email/Send-batch-template` (Prepare-batch); se le agrega el
  gate `approvalStatus == approved` (Fase 2 endurece por rol; en Fase 1 se valida el estado).

---

## 3. Roles y RBAC

### 3.1 Dos dimensiones de rol
- **`role`** (plataforma, ya existe): `admin` (interno MailConnect, panel `/admin`) | `client`.
- **`tenantRole`** (NUEVO, dentro de la empresa): `owner` | `approver` | `operator`.
  - **`owner`** (dueño/admin del cliente): todo (default para cuentas existentes → no rompe nada).
  - **`approver`** (aprobador/jefe): prepara + **aprueba/rechaza** + **envío real**.
  - **`operator`** (funcional): prepara + prueba + **solicita aprobación**. **No** envío real.

`tenantRole` se guarda en la tabla `user` (default `owner`), viaja en el JWT y lo reenvía el
Authorizer en el context. `Login` lo devuelve en `data.tenantRole`. Cuentas antiguas sin el
campo → `owner` (fail-open: siguen haciendo todo, como hoy).

### 3.2 Matriz rol → módulos (tabs del portal)
Fuente única en el front (`portalAccess.ts`), fácil de mover a config del backend luego.

| Tab / módulo | owner | approver | operator |
|--------------|:-----:|:--------:|:--------:|
| Plantillas HTML/DOCX/SMS/WhatsApp | ✅ | ✅ | ✅ |
| Campañas | ✅ | ✅ | ✅ |
| Bases de datos | ✅ | ✅ | ✅ |
| Muestras (preparar + probar + solicitar aprobación) | ✅ | ✅ | ✅ |
| **Aprobaciones** (bandeja: aprobar/rechazar + envío real) | ✅ | ✅ | ❌ |
| Lista negra | ✅ | ✅ | ❌ |
| Reportes / Estadísticas | ✅ | ✅ | ✅ |
| Saldo y recargas | ✅ | ❌ | ❌ |
| Mi cuenta | ✅ | ✅ | ✅ |

- El **envío real** (modal de confirmación) vive en el tab **Aprobaciones** → solo `owner`/`approver`.
- El **operator** ve el estado de sus campañas (chip) y puede **solicitar aprobación** desde Muestras.
- Gating en el front (sidebar filtra tabs por `tenantRole`) **y** en el backend (los endpoints
  de aprobación/envío validan `tenantRole` en la Fase 2).

---

## 4. UX del flujo (por tab)

- **Muestras** (todos): configurar campaña → enviar muestras (a los correos/celulares de los
  aprobadores) → **Solicitar aprobación**. Muestra el estado persistido de cada campaña
  (`none/pending/approved/rejected`) y el motivo si fue rechazada.
- **Aprobaciones** (owner/approver): **bandeja** de campañas `pending` con historial de muestras,
  vista previa, **costo estimado + saldo**, y acciones **Aprobar** / **Rechazar (motivo)**. Tras
  aprobar, botón **Enviar campaña real** (modal de confirmación: nº de envíos, costo, casilla de
  responsabilidad). Patrón idéntico a la bandeja de recargas del admin.
- **Campañas** (todos): chip de estado de aprobación por campaña (visibilidad transversal).

---

## 5. Fases

- **Fase 1 — Persistencia (sin roles todavía):**
  - Backend: campos de aprobación + 3 endpoints + `sampleBatches` en muestras + `_clean`
    recursivo en `Campaign/List` + rutas + init en `Create-campaign`.
  - Frontend: `campaignsService` (tipos + request/approve/reject); `MuestrasSection` deja de
    usar estado local y **lee/escribe el estado persistido** de la campaña; el envío real se
    habilita solo con `approved`. (Aprobar/Rechazar visibles inline mientras no hay roles.)
  - Tests: pytest+moto de los 3 endpoints.
- **Fase 2 — Roles + tab Aprobaciones + RBAC:**
  - `tenantRole` en `user`/JWT/Authorizer/Login; `Register` default `owner`.
  - `portalAccess.ts` (matriz) + el sidebar filtra tabs; tab **Aprobaciones** (bandeja).
  - Mueve el envío real a Aprobaciones; endurece los endpoints por `tenantRole`.
  - Gestión de sub-rol por usuario en la ficha de cliente (`User/SetRole` extendido o nuevo
    `User/SetTenantRole`).

---

## 6. Despliegue `[J]`
- Campos en `campaign`: `approvalStatus`, `approval*`, `sampleBatches` (los escribe el backend;
  cuentas viejas sin ellos → `none`, se tratan como nunca solicitadas).
- Nuevas lambdas: `Api_V1_Campaign_Request-approval`, `Api_V1_Campaign_Approve`,
  `Api_V1_Campaign_Reject` (+ rutas en `infra/api/routes.json`, ya declaradas).
  Permisos: `dynamodb:GetItem/UpdateItem` sobre `campaign`, `PutItem` sobre `adminAudit`.
- **Fase 2**: campo `tenantRole` en `user` (default `owner`); el Authorizer debe reenviar
  `tenantRole` en el context (proxy directo; en no-proxy, inyectar `$context.authorizer.tenantRole`).
