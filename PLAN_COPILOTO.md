# PLAN — Copiloto de campañas (Opción B)

> **Diferenciador Opción B.** Un asistente que, **antes de enviar**, ayuda a la PYME (que no
> tiene equipo de marketing) a: (1) **analizar spam/entregabilidad**, (2) **validar cumplimiento
> de la Ley 1581 (Habeas Data)**, (3) **sugerir la hora óptima**, y (4) **redactar/mejorar el
> copy** con IA. Lo crítico y diferenciador (análisis + cumplimiento) es **determinista**
> (confiable, gratis, sin alucinación); la IA solo hace lo creativo.

## 1. Por qué
La entregabilidad y el cumplimiento legal son los dos puntos donde una PYME se equivoca y no lo
sabe: cae en spam o incumple Habeas Data. El copiloto lo revisa en segundos, en español, aterrizado
en MailConnect. Reutiliza el asistente Bedrock ya sembrado (Opción B se apoya en la Opción "IA").

## 2. Acciones (endpoint `POST /Assistant/Copilot`, no-proxy, tras el Authorizer)
- **`analyze`** `{ channel, subject?, body, company?, audience? }` → **DETERMINISTA (sin IA)**:
  `{ score (0-100), level (ok|warning|critical), issues[], suggestions[], habeasData{ok, present[],
  missing[], requiredMissing[]}, sendTime{suggestion, rationale} }`.
- **`draft`** `{ objective, channel, audience?, tone? }` → **IA (Bedrock Converse)**: asunto(s) +
  cuerpo, con prompt aterrizado (evita spam, respeta Ley 1581, longitud por canal).
- **`rewrite`** `{ text, channel, goal? }` → **IA**: reescribe el texto (menos spam / más formal /
  más corto / mejor CTA…).

## 3. Analizador determinista (el núcleo, probado)
- **Spam/entregabilidad:** palabras gatillo (ES/EN), MAYÚSCULAS excesivas, `!!!`, puntuación
  llamativa (`$$$`, ★), exceso de enlaces, asunto ausente/largo/TODO MAYÚSCULAS, cuerpo muy corto,
  falta de desuscripción. Cada señal resta; `score = 100 − penalizaciones`; `level` por umbrales.
- **Habeas Data (Ley 1581):** checklist — obligatorios: *identifica al remitente*, *explica la
  finalidad*, *ofrece opt-out*; recomendado: *referencia a política de tratamiento de datos*.
  Detecta el token `{{unsubscribeUrl}}` como opt-out válido. `ok` = todos los obligatorios presentes.
- **Hora óptima:** heurística por canal × audiencia (B2B/B2C).

## 4. IA (draft/rewrite)
Bedrock Converse con un **prompt de sistema de copiloto** (marketing colombiano, sin spam, respeta
Ley 1581, longitud por canal, responde solo el contenido). Mismo modelo/env que el asistente
(`BEDROCK_MODEL_ID`, `BEDROCK_REGION`, `ASSISTANT_MAX_TOKENS`).

## 5. Frontend
Sección **"Copiloto IA"** (`CopilotoSection`, `copilotService`): editor (canal, asunto, cuerpo,
audiencia) + **Analizar** (score + problemas + checklist Habeas Data + hora óptima) + **Redactar
con IA** (objetivo/tono → asunto(s)+cuerpo) + **Mejorar con IA** (objetivo de reescritura).
Accesible a todos los sub-roles (es una ayuda; no envía nada).

## 6. Estado y despliegue `[J]`
**Implementado + probado:** analizador determinista (spam + Habeas Data + hora) con pruebas
exhaustivas (`08_Pruebas/PruebasSeguridad/test_copilot.py`); `draft`/`rewrite` con Bedrock stubeado;
frontend completo.

**`[J]` (despliegue):** función `Api_V1_Assistant_Copilot` + ruta `/Assistant/Copilot` (authorizer
del portal + CORS); acceso al modelo en Bedrock + IAM `bedrock:InvokeModel` (mismo que el asistente;
sólo `draft`/`rewrite` lo usan — `analyze` no cuesta nada).

## 7. Fases siguientes
- **Fase 2:** integrar el copiloto DENTRO de los editores (botón "Analizar/Mejorar" en el builder
  HTML, plantillas SMS/WSP y en crear campaña) y **bloquear el envío real** si faltan obligatorios
  de Habeas Data (gate configurable).
- **Fase 3:** hora óptima *aprendida* por segmento (a partir del histórico de aperturas del cliente),
  y predicción de entregabilidad con el histórico real de rebotes/quejas.
