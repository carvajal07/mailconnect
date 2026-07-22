'''
COPILOTO de campañas (Opción B). Ver PLAN_COPILOTO.md.

POST /Assistant/Copilot  (no-proxy, envelope; detrás del Authorizer del portal).
Request: { action, ...args }

Acciones:
  - 'analyze'  { channel, subject?, body, company?, audience? }
       -> DETERMINISTA (sin IA): score de spam/entregabilidad + problemas + sugerencias +
          checklist de cumplimiento Ley 1581 (Habeas Data) + hora óptima sugerida.
  - 'draft'    { objective, channel, audience?, tone? }
       -> IA (Bedrock Converse): redacta asunto(s) + cuerpo (o texto para SMS/WSP/VOZ).
  - 'rewrite'  { text, channel, goal? }
       -> IA: reescribe/mejora el texto (menos spam / más formal / más corto, etc.).

El análisis y el checklist NO usan IA (deterministas, sin costo, probados). Solo 'draft' y
'rewrite' llaman a Bedrock. Env: BEDROCK_MODEL_ID, BEDROCK_REGION, ASSISTANT_MAX_TOKENS.
'''
import os
import re
import json
import unicodedata

import boto3

MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-5-haiku-20241022-v1:0')
REGION = os.environ.get('BEDROCK_REGION', 'us-east-1')
MAX_TOKENS = int(os.environ.get('ASSISTANT_MAX_TOKENS', '600'))

_client = None


def _bedrock():
    global _client
    if _client is None:
        _client = boto3.client('bedrock-runtime', region_name=REGION)
    return _client


# ============================ Analizador DETERMINISTA (probado) ============================
def _norm(s):
    """Minúsculas sin acentos (para comparar palabras de forma robusta)."""
    s = str(s or '')
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s.lower()


# Palabras/expresiones que suelen disparar filtros de spam (ES + EN comunes).
SPAM_WORDS = [
    'gratis', 'gratuito', 'ganaste', 'ganador', 'ganó', 'premio', 'urgente', 'dinero',
    'credito', 'prestamo', 'oferta', 'descuento', 'clic aqui', 'clic aquí', 'compra ya',
    'compre ya', '100% gratis', 'sin costo', 'sin compromiso', 'garantizado', 'felicidades',
    'oportunidad unica', 'dinero facil', 'ingresos extra', 'trabaja desde casa', 'viagra',
    'casino', 'apuestas', 'free', 'winner', 'cash', 'act now', 'limited time', 'risk free',
    'promocion', 'rebaja', 'ultima oportunidad', 'no pierdas', 'solo hoy',
]
EMAIL_CHANNELS = ('EM', 'EAU', 'EAP', 'EMAIL')


def analyze_content(subject, body, channel):
    """Devuelve (score 0-100, level, issues[], suggestions[]). Determinista."""
    channel = str(channel or '').upper()
    subject = str(subject or '')
    body = str(body or '')
    text = '{} {}'.format(subject, body)
    ntext = _norm(text)
    issues = []
    suggestions = []
    penalty = 0

    found = sorted({w for w in SPAM_WORDS if w in ntext})
    if found:
        penalty += min(len(found) * 6, 30)
        issues.append({'type': 'spam-words', 'severity': 'warning',
                       'message': 'Palabras que suelen marcar spam: ' + ', '.join(found[:6])})
        suggestions.append('Replantea estas palabras: ' + ', '.join(found[:6]) + '.')

    words = [w for w in re.findall(r'[A-Za-zÁÉÍÓÚÑáéíóúñ]+', text) if len(w) >= 3]
    caps = [w for w in words if w.isupper()]
    if words and (len(caps) / len(words)) > 0.35:
        penalty += 15
        issues.append({'type': 'caps', 'severity': 'warning', 'message': 'Demasiadas palabras en MAYÚSCULAS.'})
        suggestions.append('Usa mayúsculas solo donde corresponda; el exceso parece spam.')

    exclamations = text.count('!')
    if exclamations >= 3:
        penalty += 10
        issues.append({'type': 'exclamations', 'severity': 'warning',
                       'message': 'Signos de exclamación en exceso ({}).'.format(exclamations)})
        suggestions.append('Reduce los signos de exclamación (1 es suficiente).')

    if re.search(r'!{2,}|\${2,}|€{2,}|★|▶▶|➤➤', text):
        penalty += 8
        issues.append({'type': 'punct', 'severity': 'warning', 'message': 'Puntuación llamativa (!!!, $$$, ★).'})

    links = len(re.findall(r'https?://', text))
    if links > 5:
        penalty += 10
        issues.append({'type': 'links', 'severity': 'warning', 'message': 'Muchos enlaces ({}).'.format(links)})
        suggestions.append('Deja 1–2 enlaces claros; demasiados bajan la entregabilidad.')

    if channel in EMAIL_CHANNELS:
        s = subject.strip()
        if not s:
            penalty += 20
            issues.append({'type': 'subject', 'severity': 'critical', 'message': 'Falta el asunto del correo.'})
        elif len(s) > 90:
            penalty += 8
            issues.append({'type': 'subject', 'severity': 'warning', 'message': 'Asunto muy largo (>90 caracteres).'})
            suggestions.append('Acorta el asunto a 30–60 caracteres.')
        elif len(s) < 3:
            penalty += 8
            issues.append({'type': 'subject', 'severity': 'warning', 'message': 'Asunto demasiado corto.'})
        if s and s.isupper():
            penalty += 10
            issues.append({'type': 'subject', 'severity': 'warning', 'message': 'El asunto está TODO EN MAYÚSCULAS.'})
        if not any(k in ntext for k in ('desuscri', 'unsubscribe')) and '{{unsubscribeurl}}' not in ntext.replace(' ', ''):
            issues.append({'type': 'unsubscribe', 'severity': 'info',
                           'message': 'No se ve enlace de desuscripción (MailConnect agrega uno automático en email).'})

    if len(_norm(body).strip()) < 15:
        penalty += 15
        issues.append({'type': 'body', 'severity': 'warning', 'message': 'El mensaje es muy corto / vacío.'})

    score = max(0, 100 - penalty)
    level = 'ok' if score >= 80 else 'warning' if score >= 55 else 'critical'
    return score, level, issues, suggestions


# --- Cumplimiento Ley 1581 (Habeas Data) — checklist determinista -------------------------
HD_REQUIRED = [
    ('remitente', 'Identifica al remitente (empresa/responsable)'),
    ('finalidad', 'Explica por qué recibe el mensaje (finalidad)'),
    ('optout', 'Ofrece opción de exclusión (darse de baja)'),
]
HD_RECOMMENDED = [('tratamiento', 'Referencia a la política de tratamiento de datos')]


def check_habeas_data(subject, body, company=''):
    n = _norm('{} {}'.format(subject, body))
    nbody = _norm(body).replace(' ', '')
    company_n = _norm(company)

    def has(key):
        if key == 'remitente':
            if company_n and company_n in n:
                return True
            return any(k in n for k in ('s.a', ' sas', 'ltda', 'somos', 'te escribe', 'equipo de', 'remitente'))
        if key == 'finalidad':
            return any(k in n for k in ('porque', 'recibes este', 'te contactamos', 'te escribimos',
                                        'te suscribiste', 'te registraste', 'finalidad', 'eres cliente'))
        if key == 'optout':
            return ('{{unsubscribeurl}}' in nbody) or any(k in n for k in (
                'desuscri', 'darte de baja', 'darse de baja', 'no recibir', 'cancelar suscrip', 'unsubscribe'))
        if key == 'tratamiento':
            return any(k in n for k in ('tratamiento de datos', 'politica de datos', 'proteccion de datos',
                                        'habeas data', 'ley 1581'))
        return False

    present, missing = [], []
    for key, label in HD_REQUIRED + HD_RECOMMENDED:
        (present if has(key) else missing).append(label)
    required_missing = [label for key, label in HD_REQUIRED if not has(key)]
    return {'ok': len(required_missing) == 0, 'present': present, 'missing': missing,
            'requiredMissing': required_missing}


# --- Hora óptima sugerida (heurística determinista) ---------------------------------------
SEND_TIME = {
    'EMAIL': {
        'b2b': ('Martes a jueves, 9:00–11:00', 'Las aperturas B2B suben a media mañana entre semana.'),
        'b2c': ('Martes a jueves 18:00–20:00, o sábado 10:00–12:00', 'El público general abre más fuera del horario laboral.'),
    },
    'SMS': {
        'b2b': ('Días hábiles, 10:00–12:00', 'Alta lectura inmediata; evita muy temprano o de noche.'),
        'b2c': ('Tardes 15:00–19:00', 'Mejor respuesta en la tarde; nunca antes de las 8:00 ni después de las 21:00.'),
    },
    'WSP': {
        'b2b': ('Días hábiles, 9:00–12:00', 'WhatsApp se lee casi al instante en horario laboral.'),
        'b2c': ('Tardes/noche temprano 17:00–20:00', 'Mayor interacción al terminar la jornada.'),
    },
    'VOZ': {
        'b2b': ('Días hábiles, 10:00–12:00 o 14:00–16:00', 'Evita inicios/fines de jornada.'),
        'b2c': ('Tardes 15:00–18:00', 'Respeta el descanso; nunca antes de 8:00 ni después de 20:00.'),
    },
}


def suggest_send_time(channel, audience):
    ch = str(channel or '').upper()
    ch = 'EMAIL' if ch in EMAIL_CHANNELS else ch
    aud = 'b2b' if str(audience or '').lower() in ('b2b', 'empresas', 'corporativo') else 'b2c'
    table = SEND_TIME.get(ch, SEND_TIME['EMAIL'])
    suggestion, rationale = table[aud]
    return {'suggestion': suggestion, 'rationale': rationale, 'audience': aud}


def do_analyze(payload):
    channel = payload.get('channel', 'EM')
    subject = payload.get('subject', '')
    body = payload.get('body', '')
    company = payload.get('company', '')
    audience = payload.get('audience', '')
    score, level, issues, suggestions = analyze_content(subject, body, channel)
    return {
        'score': score, 'level': level, 'issues': issues, 'suggestions': suggestions,
        'habeasData': check_habeas_data(subject, body, company),
        'sendTime': suggest_send_time(channel, audience),
    }


# ============================ IA (Bedrock) — draft / rewrite ============================
CHANNEL_GUIDE = {
    'EM': 'correo (asunto + cuerpo HTML corto y claro)', 'EAU': 'correo con adjunto',
    'EAP': 'correo con adjunto personalizado', 'SMS': 'SMS (máx ~160 caracteres, sin enlaces largos)',
    'WSP': 'WhatsApp (mensaje breve y cordial)', 'VOZ': 'mensaje de voz (texto natural para leer en voz alta)',
}

COPILOT_SYSTEM = (
    'Eres un copiloto de marketing de MailConnect (plataforma colombiana de envíos masivos). '
    'Escribes copy en ESPAÑOL para campañas, claro, honesto y persuasivo sin caer en spam. '
    'Reglas: evita palabras que disparan filtros de spam (gratis, urgente, ganaste, 100%, $$$), '
    'no uses TODO EN MAYÚSCULAS ni exceso de signos (!!!), respeta la Ley 1581 (identifica al '
    'remitente, explica por qué recibe el mensaje y ofrece darse de baja). Ajusta la longitud al '
    'canal. Responde SOLO con el contenido pedido, sin explicaciones adicionales.'
)


def _bedrock_text(prompt):
    resp = _bedrock().converse(
        modelId=MODEL_ID,
        system=[{'text': COPILOT_SYSTEM}],
        messages=[{'role': 'user', 'content': [{'text': prompt}]}],
        inferenceConfig={'maxTokens': MAX_TOKENS, 'temperature': 0.6},
    )
    return (resp['output']['message']['content'][0]['text'] or '').strip()


def do_draft(payload):
    objective = str(payload.get('objective', '') or '').strip()
    channel = str(payload.get('channel', 'EM') or 'EM').upper()
    audience = str(payload.get('audience', '') or 'clientes').strip()
    tone = str(payload.get('tone', '') or 'cercano y profesional').strip()
    if not objective:
        return None, 'Describe el objetivo de la campaña.'
    guide = CHANNEL_GUIDE.get(channel, 'mensaje')
    ask_subject = channel in EMAIL_CHANNELS
    prompt = (
        'Redacta una campaña para el canal: {guide}.\n'
        'Objetivo: {obj}\nAudiencia: {aud}\nTono: {tone}\n\n'
        '{subject_line}'
        'Devuelve el resultado EXACTAMENTE en este formato:\n'
        '{subject_fmt}CUERPO:\n<texto del mensaje>'
    ).format(
        guide=guide, obj=objective, aud=audience, tone=tone,
        subject_line=('Incluye 3 opciones de asunto (cortos, 30-55 caracteres).\n\n' if ask_subject else '\n'),
        subject_fmt=('ASUNTOS:\n- <opción 1>\n- <opción 2>\n- <opción 3>\n\n' if ask_subject else ''),
    )
    text = _bedrock_text(prompt)
    subjects, body = _split_subjects_body(text, ask_subject)
    return {'subjects': subjects, 'body': body}, None


def do_rewrite(payload):
    text = str(payload.get('text', '') or '').strip()
    channel = str(payload.get('channel', 'EM') or 'EM').upper()
    goal = str(payload.get('goal', '') or 'que sea más claro y con menos riesgo de spam').strip()
    if not text:
        return None, 'No hay texto para mejorar.'
    guide = CHANNEL_GUIDE.get(channel, 'mensaje')
    prompt = ('Reescribe el siguiente texto de {guide} para que {goal}. Mantén el idioma español y '
              'la intención. Devuelve SOLO el texto reescrito.\n\nTEXTO:\n{t}').format(guide=guide, goal=goal, t=text)
    return {'text': _bedrock_text(prompt)}, None


def _split_subjects_body(text, ask_subject):
    """Separa la respuesta del modelo en asuntos[] y cuerpo (formato ASUNTOS:/CUERPO:)."""
    subjects = []
    body = text
    up = text
    if 'CUERPO:' in up:
        head, _, rest = up.partition('CUERPO:')
        body = rest.strip()
        if ask_subject and 'ASUNTOS:' in head:
            for line in head.split('ASUNTOS:', 1)[1].splitlines():
                line = line.strip().lstrip('-•*').strip()
                if line:
                    subjects.append(line)
    return subjects[:3], body


# ============================ Handler ============================
def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _resp(status_code, data=None, description=''):
    ok = status_code < 400
    return {'status': ok, 'statusCode': status_code, 'description': description, 'data': data or {}}


def lambda_handler(event, context):
    payload = _get_payload(event)
    action = str(payload.get('action', '') or '').lower()

    if action == 'analyze':
        return _resp(200, do_analyze(payload), 'Análisis de la campaña')

    if action in ('draft', 'rewrite'):
        try:
            data, err = do_draft(payload) if action == 'draft' else do_rewrite(payload)
            if err:
                return _resp(400, {}, err)
            return _resp(200, data, 'Contenido generado')
        except Exception as e:
            print('Error Bedrock copiloto ({}): {}'.format(MODEL_ID, e))
            return _resp(502, {}, 'El generador de IA no está disponible ahora. Intenta más tarde.')

    return _resp(400, {}, 'action inválida (usa analyze, draft o rewrite).')
