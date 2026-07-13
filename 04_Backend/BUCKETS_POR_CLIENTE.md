# Almacenamiento S3 por cliente (buckets por NIT)

## Convención
Cada cliente tiene **dos buckets**, nombrados por su **NIT** (no por el nombre de empresa):

```
{BUCKET_PREFIX}-{nit}-database    # bases CSV
{BUCKET_PREFIX}-{nit}-document    # documentos, imágenes, adjuntos EAU/EAP
```

- `BUCKET_PREFIX` = variable de entorno (default `mailconnect`).
- `nit` = `companyTin`, saneado a `[a-z0-9]` (DNS-safe).
- Ej.: NIT `900123456` → `mailconnect-900123456-database` / `mailconnect-900123456-document`.

**Por qué NIT y no nombre:** los nombres de empresa rompen las reglas de S3 (espacios,
acentos, mayúsculas), son únicos a nivel GLOBAL de AWS (colisión) y cambian si se renombra la
empresa. El NIT es numérico, estable y DNS-safe. El prefijo evita colisiones globales.

## Creación automática
- **`Register`** crea los dos buckets del cliente la **primera vez** que aparece la empresa
  (rama de NIT nuevo). Antes no se creaban → el primer upload fallaba (`NoSuchBucket`).
- **`Prefirm-url`** además asegura el bucket (crea-si-no-existe) antes de prefirmar la subida
  (red de seguridad para clientes previos a este cambio).

## Threading del NIT
- **Front:** la sesión tiene `nit`; `presignUrl` lo envía y `publicUrl`/`tenantBucket` lo usan.
- **`Prepare-batch`:** obtiene el NIT del cliente (`get_customer_nit` por `customerId`), descarga
  la base del bucket por NIT (con **fallback** al viejo por nombre) y lo incluye en el mensaje
  SQS (`build_ctx` → `nit`). Los part-files van al bucket por NIT.
- **Envíos `.document`** (`Send-EAU`, `Send-EAP`, `Template_Combination`): leen `nit` del mensaje
  y arman el bucket por NIT (fallback al viejo por nombre si no llega).
- **`Database_Delete`:** borra el objeto del bucket por NIT y del viejo por nombre (best-effort).

## Fallback (migración sin romper)
Todas las **lecturas** intentan primero el bucket por NIT y, si falla, el viejo `{nombre}.{tipo}`.
Así los datos de prueba existentes siguen funcionando durante la transición.

## Pendiente `[J]` (despliegue / AWS)
- Permisos IAM de las lambdas: `s3:CreateBucket` + `HeadBucket` (Register, Prefirm-url),
  `s3:PutObject/GetObject/DeleteObject` sobre `{prefix}-*-database` y `-document`.
- Env `BUCKET_PREFIX` (si no se usa `mailconnect`) en todas las lambdas que tocan S3.
- **Migrar los buckets/datos viejos** `{nombre}.database` / `{nombre}.document` (pre-prod = datos
  de prueba; el fallback los sigue leyendo, pero conviene mover a los buckets por NIT).
- **Lambdas legacy sin migrar** (duplicados/secundarios, migrar si están activos):
  `Api_V1_Combination`, `CombinacionPython3-9`, `Api_V1_Agent_Reports` (aún usan `{nombre}.document`).
- Verificar con `test-runner.html` el flujo real (subir base → crear campaña → muestra) tras desplegar.
