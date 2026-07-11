# Estado de los endpoints — MailConnect API (V1)

> Acompaña a `01-MailConnect.postman_collection.json`. Resume, por endpoint, si la
> **lambda está implementada** (revisión de código + pruebas moto) y si su **ruta/infra
> está desplegada** en AWS. **No** es una prueba en vivo: la política de red de este
> entorno bloquea el host del API (`api.mailconnect.com.co` → 403 policy denial), así que
> el estado LIVE hay que obtenerlo corriendo la colección (ver más abajo).

_Última verificación de código: suite moto **130/130 en verde**; base `https://api.mailconnect.com.co/V1`._

## Cómo probar en vivo (lo que yo no pude por el bloqueo de red)

1. Importa `01-MailConnect.postman_collection.json` en Postman.
2. Ajusta variables: `baseUrl`, `email`, `password`, `customer`, `companyTin`.
3. Corre **1) Seguridad → Login** (guarda `token`, `customerId`, `customer`, `userId`).
4. Corre el resto. Cada request valida el envelope y loguea en consola:
   `OK <nombre> -> HTTP <code> | statusCode=<sc> | <desc>`.
5. Por línea de comandos (reporte completo):
   ```
   npm i -g newman
   newman run 10_Postman/01-MailConnect.postman_collection.json \
     --env-var email=... --env-var password=... --env-var customer=... --env-var companyTin=...
   ```
   > ⚠️ Ejecuta la carpeta **4) Envíos** solo con datos de prueba: dispara correos REALES.

## Leyenda
- **Código:** ✅ implementado · ⚠️ stub (no hace nada útil) · 🔁 consumidor de cola/SNS (no es ruta HTTP)
- **Prueba:** 🧪 cubierto por moto · 👁 revisión de código
- **Despliegue:** 🟢 documentado como real en prod · 🟡 `[J]` reciente, **confirmar ruta/tabla en AWS**

## 1) Seguridad
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Security/Register` | POST | ✅ (+ correo SES) | 🧪 | 🟢 |
| `/Security/Login` | POST | ✅ | 🧪 | 🟢 |
| `/Security/Acount-activation` | GET | ✅ (302) | 🧪 | 🟢 |
| `/Security/Recovery-password` | POST | ✅ (OTP genérico) | 🧪 | 🟢 |
| `/Security/Create-otp` | POST | ✅ | 🧪 | 🟢 |
| `/Security/Validate-otp` | POST | ✅ | 🧪 | 🟢 |
| `/Security/Change-password` | POST | ✅ (token u OTP) | 🧪 | 🟢 |
| `/Security/Refresh-token` | POST | ✅ | 🧪 | 🟢 |
| `/Security/Logout` | POST | ✅ | 🧪 | 🟢 |
| `/Security/Verify-code` | POST | ⚠️ **STUB** | — | 🟢 (ruta) |

## 2) Plantillas SES (HTML)
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Template/Create-template` | POST | ✅ | 👁 | 🟢 |
| `/Template/List` | POST | ✅ | 🧪 | 🟢 |
| `/Template/Get-template` | POST | ✅ | 👁 | 🟢 |
| `/Template/Delete-template` | POST | ✅ | 👁 | 🟢 |

## 3) Campañas
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Campaign/Prefirm-url` | POST | ✅ | 👁 | 🟢 |
| `/Campaign/Create-campaign` | POST | ✅ | 👁 | 🟢 |
| `/Campaign/List` | POST | ✅ | 🧪 | 🟢 |
| `/Campaign/Update` | POST | ✅ | 👁 | 🟡 confirmar ruta |

## 4) Envíos (⚠️ efectos reales)
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Email/Send-batch-template-samples` | POST | ✅ (Prepare-batch) | 🧪 | 🟢 |
| `/Email/Send-batch-template` (real) | POST | ✅ (Prepare-batch) | 🧪 | 🟢 |
| `/Email/Send-ondemand-template` | POST | ✅ | 👁 | 🟢 |
| `/Email/Unsubscribe` | GET | ✅ (público) | 👁 | 🟢 |

## 5) Bases de datos
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Database/Register-file` | POST | ✅ | 👁 | 🟡 confirmar `columns` |
| `/Database/List` | POST | ✅ | 👁 | 🟢 |
| `/Database/Delete` | POST | ✅ (+ borra S3) | 👁 | 🟡 ruta + permiso `s3:DeleteObject` |

## 6) Plantillas multicanal (SMS/WSP/DOCX)
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/MessageTemplate/Create` | POST | ✅ | 👁 | 🟡 tabla `messageTemplate` + ruta |
| `/MessageTemplate/List` | POST | ✅ | 👁 | 🟡 |
| `/MessageTemplate/Delete` | POST | ✅ | 👁 | 🟡 |

## 7) Lista negra
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Blacklist/Add` | POST | ✅ (crea tabla si falta) | 👁 | 🟡 ruta + permisos |
| `/Blacklist/List` | POST | ✅ | 👁 | 🟡 |
| `/Blacklist/Delete` | POST | ✅ | 👁 | 🟡 |

## 8) Clientes (ADMIN)
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Customer/List` | POST | ✅ (rol admin) | 🧪 | 🟡 ruta admin |
| `/Customer/Update` | POST | ✅ (rol admin) | 🧪 | 🟡 ruta admin |

## 9) Reportes y costo
| Endpoint | Método | Código | Prueba | Despliegue |
|---|---|---|---|---|
| `/Report/Statistics` | POST | ✅ | 🧪 | 🟢 |
| `/Report` (state-report) | POST | ✅ | 👁 | 🟢 |
| `/Cost/Estimate` | POST | ✅ | 👁 | 🟡 ruta + tabla `pricingRate` |

## No incluidos en la colección (no son rutas HTTP)
Se disparan por **cola SQS / SNS / cron**, no por API Gateway:
`Api_V1_Sms_Send-batch`, `Api_V1_Wsp_Send-batch`, `Api_V1_Voice_Send-batch`
(consumen sus colas), `Api_V1_Email_Prepare-batch-template` en modo *worker* de partes
(SQS), `Api_V1_Email_ReceptionStatus` y `Api_V1_Messaging_ReceptionStatus` (SNS),
`Api_V1_Template_Combination` / `Api_V1_Combination` / `CombinacionPython3-9` (armado de
adjuntos EAP, SQS), `Api_V1_Cron_DeleteTables` / `Api_V1_SQS_DeleteTables` (mantenimiento),
`Authorizer` / `Authorizer2` (autorizadores Lambda).

## Resumen
- **Implementados y con prueba moto (alta confianza):** todo Seguridad (salvo Verify-code),
  Campaign/List, Template/List, Report/Statistics, Customer List/Update.
- **Implementados (revisión de código):** resto de Plantillas SES, Campaña, Envíos, Bases,
  MessageTemplate, Blacklist, state-report, Cost.
- **No funcional por diseño:** `Verify-code` (stub).
- **A confirmar en AWS (🟡):** rutas/tablas recientes (MessageTemplate, Blacklist, Customer,
  Cost, Database/Delete, Campaign/Update). El estado LIVE definitivo sale de correr la colección.
