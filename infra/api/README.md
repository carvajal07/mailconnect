# infra/api — Configuración de API Gateway como código (IaC ligero)

La config de las **rutas admin** de API Gateway vive aquí y se aplica **automáticamente
desde GitHub** en cada push (workflow `.github/workflows/deploy-api.yml`). Así no hay
que tocar la consola ruta por ruta.

## Qué gestiona

Para cada ruta listada en `admin-routes.txt`, el script `scripts/sync-api.sh`:
1. Aplica el **mapping template** de rol/tenant a la integración POST (no-proxy), para
   que la lambda reciba `role`/`user`/`customerId` desde el Authorizer.
2. Pone **CORS** en las respuestas de error (`DEFAULT_4XX`/`DEFAULT_5XX`) para que los
   errores no se vean como "CORS error" en el navegador.
3. (Opcional) Adjunta el **Authorizer** a cada ruta si defines `AUTHORIZER_ID`.
4. **Despliega** la API al stage.

Es **idempotente**: se puede correr las veces que sea.

## Cómo se dispara

- **Automático:** cualquier push a `main` que toque `infra/api/**` o `scripts/sync-api.sh`.
- **Manual:** pestaña Actions → "Desplegar API (rutas admin)" → Run workflow. O local:
  ```bash
  API_ID=<id> STAGE=V1 PREFIX="" AUTHORIZER_ID=<id> ./scripts/sync-api.sh
  ```

## Configuración (una sola vez)

En **Settings → Secrets and variables → Actions**:

- **Secrets:** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (mismos del CD de lambdas;
  el usuario IAM necesita permisos `apigateway:*` sobre la API).
- **Variables:**
  - `API_ID` (obligatoria) — id de la REST API (p. ej. `jj9ulp7d59`).
  - `STAGE` — stage a desplegar (default `V1`).
  - `PREFIX` — prefijo de los resource paths. Si en API Gateway tus recursos son
    `/Customer/List` deja vacío; si son `/V1/Customer/List` pon `/V1`.
  - `AUTHORIZER_ID` — (opcional) para que también adjunte el authorizer.
  - `AWS_REGION` — default `us-east-1`.

## Agregar/quitar una ruta admin

Edita `admin-routes.txt` (una ruta por línea), haz push, y el workflow la aplica.
**Requisito:** la ruta/método ya debe existir en API Gateway (este flujo configura la
integración; no crea el recurso desde cero). Para crear recursos nuevos desde cero,
la evolución natural es migrar a OpenAPI import o Terraform (ver DESPLIEGUE.md).

## Alcance y límites

- Sincroniza integración (template), CORS de errores y (opcional) authorizer + deploy.
- **No** crea recursos/métodos nuevos, ni gestiona el preflight `OPTIONS` (eso lo deja
  "Enable CORS" de la consola una vez, o se añade a este flujo si hace falta).
- **No** toca las lambdas (eso es `deploy-lambdas.yml`) ni otras rutas fuera de la lista.
