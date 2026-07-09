# Mailconnect

Plataforma de envío masivo de emails construida sobre AWS serverless. Permite a clientes registrados crear campañas de email marketing, cargar bases de datos de destinatarios, y hacer seguimiento de estadísticas de entrega.

**Cuenta AWS:** `873837768806`  
**Región:** `us-east-1`  
**API Base (Test):** `https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test`  
**Dominio:** `mailconnect.com.co` | `api.mailconnect.com.co` (Godaddy → `76.223.105.231`)

> 📌 **Estado actual e implementación reciente:** ver `CLAUDE.md` (landing pública + autenticación conectada al backend, lambdas de seguridad implementadas y probadas). Este README es la referencia de arquitectura.

---

## Estructura del repositorio

```
ProyectoMailconnect/
├── 01_Documentacion/
│   ├── Legal/          # RUT, certificado bancario
│   ├── Comercial/      # Cotizaciones, precios, descripción de servicios
│   └── Tecnica/        # Diagramas, tablas BD, permisos AWS, notas técnicas
├── 02_Diseño/          # Logos (.ai, .svg, .png), fuentes (Nunito)
├── 03_Arquitectura/    # Diagrama draw.io
├── 04_Backend/
│   ├── lambdas/        # Lambdas productivas (Api_V1_*)
│   ├── lambdas-prueba/ # Lambdas de prueba y versiones descartadas
│   ├── scripts/        # Scripts Python sueltos, utilidades, envíos manuales
│   └── librerias/      # Librerías empaquetadas para capas Lambda (JWT, etc.)
├── 05_Frontend/        # App React/Vite/TS: landing pública + auth + panel
├── 06_Plantillas/      # Templates HTML de email
├── 07_Schemas/         # JSON Schemas de validación de la API
├── 08_Pruebas/         # Datos de prueba (CSV/JSON) + PruebasSeguridad/ (pytest)
└── 09_Herramientas/    # Colección Postman, notas de OTP
```

---

## Arquitectura

```
Cliente
  │
  ▼
API Gateway (REST)
  │
  ├── Lambda Authorizer (JWT) ──────────────────────────────────┐
  │                                                              │
  ├── Lambdas de Seguridad (register, login, otp, etc.)        │
  ├── Lambdas de Template (create, get, delete, combination)    │ Valida token
  ├── Lambdas de Campaña (create-campaign, prefirm-url)         │ en cada request
  ├── Lambda de Email ondemand                                   │
  └── Lambda de Reportes ◄───────────────────────────────────── ┘
         │
         ▼
    DynamoDB ◄──── todas las lambdas leyendo/escribiendo
         │
  ┌──────┴──────┐
  │             │
  S3           SQS
  │             │
  │      ┌──────┴────────────────────┐
  │      │                           │
  │   Lambda_Send_EM         Lambda_Send_EAU / EAP
  │      │                           │
  └──────┴───────────────────────────┘
              │
             SES ──────────────────► Destinatarios
              │
             SNS
              │
              ▼
   Lambda_ReceptionStatus → DynamoDB (estados de envío)
```

### Flujo de envío masivo

1. **Subida del CSV** — el cliente solicita una URL prefirmada de S3 (`GET /api/get-urlS3`) y sube su base de datos con `PUT` directo a S3.
2. **Crear campaña** — `POST /api/email/config/create-campaign` registra la campaña en DynamoDB.
3. **Preparar lote** — `Api_V1_Email_Prepare-batch-template` lee el CSV desde S3, lo divide según el canal y encola mensajes en SQS:
   - EM: lotes de **250** registros → cola `Email_Send-batch-template-EM`
   - EAU: lotes de **250** registros → cola `Email_Send-batch-raw-EAU`
   - EAP: lotes de **100** registros → cola `Template_Combination-EAP`
4. **Envío** — las lambdas de envío consumen SQS y realizan los envíos via AWS SES.
5. **Recepción de estados** — SES notifica via SNS los eventos (entrega, rebote, apertura, clic, etc.) y `Api_V1_Email_ReceptionStatus` los guarda en DynamoDB.

---

## Canales de envío

| Código | Descripción | Lote máx | Lambda de envío |
|--------|-------------|-----------|-----------------|
| `EM`   | Email marketing (sin adjunto) | 250 | `Send-batch-template-EM` |
| `EAU`  | Email con adjunto único (mismo para todos) | 250 | `Send-batch-template-EAU` |
| `EAP`  | Email con adjunto personalizado (uno por destinatario) | 100 | `Send-batch-template-EAP` |

---

## Lambdas productivas

### Seguridad (`/api/...`)

| Lambda | Endpoint | Descripción | Estado |
|--------|----------|-------------|--------|
| `Api_V1_Security_Register` | `POST /api/register` | Registro de cliente + correo de activación (SES) | ✅ Implementado |
| `Api_V1_Security_Login` | `POST /api/login` | Login, retorna JWT + info del cliente | ✅ Implementado |
| `Api_V1_Security_Logout` | `POST /api/logout` | Cierre de sesión (invalida sesiones) | ✅ Implementado |
| `Api_V1_Security_Acount-activation` | `GET /api/account-activation?qs=` (o `/verify-email/{token}`) | Activa la cuenta con la clave del correo (redirige 302) | ✅ Implementado |
| `Api_V1_Security_Create-otp` | `POST /api/create-otp` | Genera OTP (hasheado) y lo envía por correo | ✅ Implementado |
| `Api_V1_Security_Validate-otp` | `POST /api/validate-otp` | Valida y consume el OTP | ✅ Implementado |
| `Api_V1_Security_Verify-code` | `POST /api/verify-code` | Verifica código de confirmación | ⚠️ TODO (stub) |
| `Api_V1_Security_Refresh-token` | `POST /api/token/refresh` | Renueva el JWT | ⚠️ TODO (stub) |
| `Api_V1_Security_Change-password` | `POST /api/change-password` | Cambia contraseña (por token JWT o por OTP) | ✅ Implementado |
| `Api_V1_Security_Recovery-password` | `POST /api/forgot-password` | Recuperación de contraseña (genera y envía OTP) | ✅ Implementado |
| `Authorizer` / `Authorizer2` | (Lambda Authorizer) | Valida JWT en cada request | ✅ Valida el JWT (HS256, deniega por defecto) |

> ✅ La mayoría de las lambdas de seguridad ya están **implementadas y probadas** (ver `08_Pruebas/PruebasSeguridad`). Siguen como **stub** (`# TODO implement`): `Verify-code` y `Refresh-token`. El `Authorizer` (y `Authorizer2`) ya **valida** el JWT (HS256) con `SECRET_KEY` y deniega por defecto. Las lambdas de seguridad leen `SECRET_KEY`/`SENDER_EMAIL` desde variables de entorno (los Authorizers requieren el layer de PyJWT y la env `SECRET_KEY`).

### Template (`/api/...`)

| Lambda | Endpoint | Descripción |
|--------|----------|-------------|
| `Api_V1_Template_Create-template` | `POST /api/create-template` | Crea template en SES + registra en DynamoDB |
| `Api_V1_Template_Get-template` | `POST /api/get-template` | Consulta template |
| `Api_V1_Template_Delete-template` | `POST /api/delete-template` | Elimina template |
| `Api_V1_Template_Combination` | trigger SQS `Template_Combination-EAP` | Combina template docx con datos para EAP |
| `Api_V1_Combination` | (invocación directa) | Similar, combinación de correspondencia con docx |

### Campaña

| Lambda | Endpoint | Descripción |
|--------|----------|-------------|
| `Api_V1_Campaign_Create-campaign` | `POST /api/email/config/create-campaign` | Crea campaña, asigna consecutivo |
| `Api_V1_Campaign_Prefirm-url` | `GET /api/get-urlS3` | Genera URL prefirmada para subir CSV a S3 |

### Email

| Lambda | Trigger | Descripción | Memoria | Timeout |
|--------|---------|-------------|---------|---------|
| `Api_V1_Email_Prepare-batch-template` | API Gateway | Lee CSV de S3, divide y encola en SQS | 256 MB | 90 s |
| `Api_V1_Email_Send-batch-template-EM` | SQS `Email_Send-batch-template-EM` | Envío masivo EM via SES | 128 MB | 5 s |
| `Api_V1_Email_Send-batch-template-EAU` | SQS `Email_Send-batch-raw-EAU` | Envío con adjunto único via SES | 1024 MB | 720 s |
| `Api_V1_Email_Send-batch-template-EAP` | SQS `Template_Combination-EAP` | Envío con adjunto personalizado via SES | 128 MB | 30 s |
| `Api_V1_Email_Send-ondemand-template` | `POST /api/email/sent/ondemand` | Envíos transaccionales internos de Mailconnect | 128 MB | 3 s |
| `Api_V1_Email_ReceptionStatus` | SNS/SQS (eventos SES) | Recibe y persiste estados de entrega | 128 MB | 3 s |

### Reportes

| Lambda | Trigger | Descripción | Runtime |
|--------|---------|-------------|---------|
| `Api_V1_Reports_state-report` | API Gateway | Genera CSV de reporte de campaña y sube a S3 | Python 3.10 |
| `Api_V1_Agent_Reports` | Bedrock Agent Tool | Reportes para agente IA (status_summary, full_report, open_rate, campaign_comparison, list_campaigns) | Python 3.13 |

### Mantenimiento

| Lambda | Trigger | Descripción | Runtime |
|--------|---------|-------------|---------|
| `Api_V1_Cron_DeleteTables` | EventBridge (Cron) | Revisa `{env}_TableLifecycle` y encola tablas a limpiar | Python 3.13 |
| `Api_V1_SQS_DeleteTables` | SQS | Archiva tablas viejas en S3/Glacier según lifecycle | Python 3.13 |

---

## Tablas DynamoDB

### Tablas globales (fijas)

| Tabla | Descripción |
|-------|-------------|
| `user` | Credenciales: `userId`, `email`, `userHash`, `userSalt`, `active`, `customerId`, `userDataId` |
| `userData` | Datos personales: `userDataId`, `userName` |
| `customer` | Empresas cliente: `customerId`, `company`, `companyTin` |
| `session` | Sesiones activas: `sessionId`, `userId`, `ipAddress`, `device`, `active`, `date` |
| `otp` | OTPs: `otpId`, `active` |
| `userActivation` | Tokens de activación de cuenta |
| `campaign` | Campañas: `customerId`, consecutivo, canal, estado |
| `campaignControl` | Consecutivo de campañas por cliente |
| `channel` | Canales disponibles: EM, EAU, EAP, SMS |
| `document` | Documentos adjuntos |
| `process` | Procesos de envío batch |
| `templateControl` | Consecutivo de templates por cliente |
| `templateAudit` | Auditoría de templates |
| `mailconnect_processDetail` | Detalle de procesos ondemand |
| `mailconnect_sendDetail_default` | Detalle de envíos ondemand |
| `mailconnect_blacklist` | Lista negra global |
| `mailconnect_unsubscribe` | Desuscripciones globales |
| `{env}_TableLifecycle` | Control de ciclo de vida de tablas (limpieza automática) |

### Tablas dinámicas por cliente

Se crean automáticamente usando el nombre del cliente (`customer_name`):

| Patrón | Descripción |
|--------|-------------|
| `{customer_name}_sendStatus_{campaign_id}` | Estado de cada email de una campaña |
| `{customer_name}_sendDetail` | Detalle de envíos del cliente |
| `{customer_name}_processDetail` | Detalle de procesos del cliente |
| `{customer_name}_blackList` | Lista negra del cliente |
| `{customer_name}_unsubscribe` | Desuscripciones del cliente |

---

## Colas SQS

| Cola | Descripción |
|------|-------------|
| `Email_Send-batch-template-EM` | Lotes de envío EM (email marketing sin adjunto) |
| `Email_Send-batch-raw-EAU` | Lotes de envío EAU (adjunto único) |
| `Template_Combination-EAP` | Lotes EAP para combinación de plantilla antes del envío |

> La cola `Email_Send-batch-raw-EAP` existe pero está comentada en el código; el flujo EAP va por `Template_Combination-EAP`.

---

## Buckets S3

| Bucket | Uso |
|--------|-----|
| `mailconnect.database` | CSVs subidos por los clientes (prefijo `/pruebas/` para tests) |
| `mailconnect.document` | Documentos y adjuntos de campañas |
| `email-campaign-archive` | Archivado de tablas antiguas (S3 + Glacier) |

---

## Autenticación

- **Tipo:** JWT (HS256), firmado con `SECRET_KEY`
- **Expiración:** 1 día
- **Header:** `Authorization: Bearer <token>`
- El Lambda Authorizer valida el token antes de cada request al API Gateway
- El payload del JWT contiene `user` (email del usuario)

> ✅ El `Authorizer` (y `Authorizer2`) ya **valida** el JWT (firma HS256 + expiración) con `SECRET_KEY`, soporta autorizadores TOKEN y REQUEST, y deniega por defecto (fail-closed). `Login` y las lambdas de seguridad leen `SECRET_KEY` desde variable de entorno. Pendiente: mover `SECRET_KEY` a AWS Secrets Manager.

---

## Endpoints API (Test)

**Base URL:** `https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test`

### Seguridad
```
POST /api/register
POST /api/login
POST /api/logout
POST /api/verify-email/{token}
POST /api/create-otp
POST /api/validate-otp
POST /api/verify-code
POST /api/token/refresh
POST /api/change-password
POST /api/forgot-password
```

### Templates
```
POST /api/create-template
POST /api/get-template
POST /api/delete-template
```

### Campaña y envío
```
POST /api/email/config/create-campaign
GET  /api/get-urlS3
POST /api/email/sent/ondemand
```

---

## Estados de email (SES)

| # | Estado | Descripción |
|---|--------|-------------|
| 1 | Send | Enviado |
| 2 | Delivery | Entregado |
| 3 | Reject | Rechazado |
| 4 | Open | Abierto |
| 5 | Click | Click en enlace |
| 6 | Bounce | Rebote |
| 7 | Complaint | Marcado como spam |
| 8 | Rendering Failure | Error al renderizar template |
| 9 | DeliveryDelay | Entrega demorada |
| 10 | Subscription | Suscripción/desinscripción |

---

## Capas Lambda (Layers)

| Layer | ARN | Uso |
|-------|-----|-----|
| AWSSDKPandas-Python311 | `336392948345:layer:AWSSDKPandas-Python311` | Pandas para lectura de CSV (`Prepare-batch`) |
| docxtpl_windows | `873837768806:layer:docxtpl_windows:3` | Combinación de correspondencia en .docx |
| docx | `873837768806:layer:docx:2` | Manipulación de archivos Word |
| openpyxl | `873837768806:layer:openpyxl:2` | Generación de Excel en reportes |

---

## Roles IAM usados

| Rol | Permisos |
|-----|----------|
| `Lambda_DynFull` | DynamoDB full |
| `Lambda_DynFull_SES` | DynamoDB + SES |
| `Lambda_DynFull_SES_SQS` | DynamoDB + SES + SQS |
| `Lambda_DynFull_SQS` | DynamoDB + SQS |
| `Lambda_DynFull_SQS_S3` | DynamoDB + SQS + S3 |
| `Lambda_DynFull_SES_SQS_S3` | DynamoDB + SES + SQS + S3 |
| `Lambda_DynFull_S3` | DynamoDB + S3 |

---

## Usuarios IAM (acceso programático)

| Usuario | Uso |
|---------|-----|
| `consumoSQS` | Encolar mensajes en SQS (access key en `01_Documentacion/Tecnica/DatosTrabajo.txt`) |
| `consumoS3` | Subir archivos a S3 (access key en `01_Documentacion/Tecnica/DatosTrabajo.txt`) |

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend | Python 3.11 / 3.13 (AWS Lambda) |
| Base de datos | AWS DynamoDB |
| Envío de email | AWS SES |
| Colas | AWS SQS |
| Almacenamiento | AWS S3 + Glacier |
| API | AWS API Gateway (REST) |
| Frontend | React + Vite + TypeScript |
| Formato de datos | CSV (delimitador `;`), JSON |
| Reportes | Excel (.xlsx via openpyxl) |

---

## Pendientes conocidos

- [x] Implementadas: `register` (+ activación), `login` (fix), `logout`, `create-otp`, `validate-otp`, `change-password`, `account-activation`, `forgot-password`
- [x] `Authorizer` (y `Authorizer2`) validan el JWT (HS256, fail-closed)
- [ ] Faltan lambdas de seguridad: `verify-code` y `token/refresh`
- [x] `SECRET_KEY` del JWT leído desde variable de entorno — [ ] pendiente migrar a AWS Secrets Manager
- [x] CI con GitHub Actions: `pytest` en cada push/PR (`.github/workflows/tests.yml`) — [ ] pendiente CI/CD de despliegue (CodeBuild/CodePipeline)
- [x] Pruebas de integración de seguridad (pytest + moto) en `08_Pruebas/PruebasSeguridad` — pendiente ampliar cobertura a otros módulos
- [ ] **Estimador de costo de envío:** mostrar al cliente un valor estimado de la campaña
      **antes** de enviar, según cantidad de envíos, si lleva adjunto y su peso, y el tipo
      (EM / EAU adjunto único / EAP adjunto personalizado PDF o Word). Endpoint sugerido
      `POST /api/email/estimate` + tarifas configurables. Detalle en `CLAUDE.md` §5.
- [ ] Implementar lista negra por cliente (`{customer_name}_blackList`)
- [ ] Validar manejo de archivos CSV grandes (+100k registros) con lectura por partes
- [ ] Segmentar IPs de envío SES por cliente

---

## Archivos de referencia

- **Colección Postman:** `09_Herramientas/01-MailConnect.postman_collection.json`
- **Tablas BD:** `01_Documentacion/Tecnica/tabla BD.xlsx`
- **Permisos AWS:** `01_Documentacion/Tecnica/PermisoAWS-Roles.xlsx`
- **Credenciales y accesos:** `01_Documentacion/Tecnica/DatosTrabajo.txt`
- **Diagrama arquitectura:** `03_Arquitectura/Diagrama.drawio`
