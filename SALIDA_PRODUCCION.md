# SALIDA_PRODUCCION.md — Checklist para vender

> Lista corta y concreta de lo que falta para abrir a clientes de pago. Cada punto dice
> **qué** y **dónde**. El detalle técnico está en `DESPLIEGUE.md` (qué desplegar),
> `PROVISION.md` (con qué números) y `PENDIENTES.md` (backlog por bloques).
>
> `[J]` = consola AWS / cuenta · `[C]` = código · `[P]` = producto/negocio

---

## 🔴 Bloquea vender — sin esto no se puede facturar a un cliente

| # | Qué | Dónde |
|---|---|---|
| 1 | **Los textos legales muestran `[RAZÓN SOCIAL DE LA EMPRESA]`, `[NIT]`, `[DIRECCIÓN]`, `[CIUDAD]`, `[TELÉFONO]` literales.** Están publicados así en las 4 páginas legales. `[C]` | `src/pages/legal/legalContent.tsx` → const `COMPANY` |
| 2 | **Crear el buzón `protecciondedatos@mailconnect.com.co`** y que alguien lo lea. La política de habeas data lo publica como canal del titular; la Ley 1581 exige que responda. `[J]` | Correo corporativo |
| 3 | **Actualizar la fecha de los textos legales** (`updated: '10 de julio de 2026'`) a la de publicación real. `[C]` | mismo archivo, línea ~24 |
| 4 | **Verificar que Wompi está con llaves de PRODUCCIÓN**, no de pruebas. Con las de sandbox el cliente "paga" y no entra plata. `[J]` | envs `WOMPI_*` en `Balance_Topup-init` y `Wallet_Wompi-webhook` |
| 5 | **Desplegar la rama** (PR #127): 6 workers de envío, `Create-campaign`, `Prepare-batch`, `Cascade_Dispatch`, `Assistant_Ask`, las 6 lambdas de correo + build del frontend. `[J]` | `DESPLIEGUE.md` §26–29 |
| 6 | ⚠️ **El frontend va ANTES o junto con las 6 lambdas de correo.** Los iconos del pie salen de `public/email/`; al revés, los correos salen con imágenes rotas. `[J]` | — |
| 7 | **Piloto E2E con un cliente real.** Es el único gate del MVP que no es infraestructura. `[P]` | `PLAN_MVP.md` Fase 1 |

## 🟠 Antes del primer cliente que pague

| # | Qué | Dónde |
|---|---|---|
| 8 | **Borrar las envs `ACTIVATION_SUCCESS_URL` / `_ERROR_URL` / `_EXPIRED_URL`** para que mande el default del código. Mientras sigan con el esquema viejo, un enlace **expirado** se ve como error genérico. `[J]` | `Api_V1_Security_Acount-activation` · `DESPLIEGUE.md` §24 |
| 9 | **Correr la verificación post-deploy.** Nunca se ha ejecutado. `[J]` | `DESPLIEGUE.md` §7 |
| 10 | **`SECRET_KEY` y llaves de Wompi a Secrets Manager** (hoy son env vars planas). `[J]` | `PENDIENTES.md` Bloque 1.5 |
| 11 | **WAF / usage plan en API Gateway.** `/Assistant/Ask` y `/Security/Register` son públicos; el rate-limit propio corta Bedrock pero no las invocaciones. `[J]` | Bloque 1.2 |
| 12 | **Rate-limit en `/Security/Register` y `/Create-otp`.** Sin él, cualquiera hace email bombing **con tu reputación de SES**. `[C]` | Bloque 1.2 |
| 13 | **Alarma de gasto en AWS Budgets** (Bedrock y total de la cuenta). `[J]` | Billing |
| 14 | **Revisar los overrides de `pricingRate` por cliente**: las tarifas de SMS/Voz subieron a costo+25% y un override plano viejo puede haber quedado **bajo el costo**. `[J]` | Admin → Tarifas |
| 15 | **Verificar que el asistente de IA responde.** Estaba bloqueado por el medio de pago de AWS Marketplace (no es IAM ni código). `[J]` | `CLAUDE.md` §Bedrock |

## 🟡 Marca y contenido

| # | Qué | Dónde |
|---|---|---|
| 16 | **Las 4 redes son cuentas PERSONALES, no páginas de empresa** (`linkedin.com/in/…`, Facebook `profile.php?id=…`, Reddit `/user/…`). Crear página de empresa en **LinkedIn y Facebook**; X puede quedarse. Cambiar la URL en 2 sitios. `[P]`+`[C]` | `REDES` en `LandingPage.tsx` · envs `SOCIAL_*` |
| 17 | **Sacar Reddit del pie.** Ahí una cuenta corporativa se lee como spam; no pinta en un sitio corporativo. `[C]` | mismo `REDES` |
| 18 | **Sumar tu LinkedIn personal en "Sobre nosotros"**, etiquetado como fundador — la cercanía va ahí, no en el pie. `[C]` | sección `#nosotros` |

## 🟢 Operación — primeras semanas

| # | Qué | Dónde |
|---|---|---|
| 19 | **Aplicar `config-map.json` a todas las lambdas**: workflow de despliegue a mano con el input `all`. ⚠️ Sobrescribe todo el código con el del repo. `[J]` | `PROVISION.md` §2 |
| 20 | **Publicar el layer de PDF con bytecode** (−1 s por arranque en frío). `[J]` | workflow "Publicar layer de PDF" |
| 21 | **Verificar los números del simulador de SMS** en la consola antes de cargar esas bases. Un dígito mal = SMS real, a una persona real, cobrado. `[J]` | `09_Herramientas/bases-prueba/README.md` |
| 22 | **Correr las pruebas de carga** con `email-08-troceo-5130.csv` y mirar DLQ en 0. `[P]` | mismo README |
| 23 | **S3 público (`attachment/`, `resources/`) → URLs prefirmadas o CloudFront.** Hoy cualquiera con la URL ve el adjunto de otro. `[J]` | Bloque 1.8 |
| 24 | **DOMPurify en `dangerouslySetInnerHTML`** del constructor y el diseñador. `[C]` | Bloque 1.7 |
| 25 | **`realSendEnabled` fail-CLOSED.** Hoy asume `True` si falla la lectura: un control de bloqueo debe denegar ante error. `[C]` | Bloque 1.3 |

---

## Lo que NO hace falta para vender

- **WhatsApp y Voz**: apagados a propósito. Sales con correo y SMS, y la FAQ lo dice.
- **ARM / Graviton**: ahorra ~medio centavo por campaña. No es una palanca.
- **Concurrencia aprovisionada**: ~$331/mes contra $0,02 de cómputo por campaña.
- **DynamoDB aprovisionada**: el perfil es ráfaga, no carga sostenida.
