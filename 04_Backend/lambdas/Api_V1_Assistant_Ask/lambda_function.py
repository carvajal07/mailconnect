'''
Lambda del ASISTENTE de IA de MailConnect. Responde preguntas sobre la plataforma usando
AWS Bedrock (Converse API con un modelo Claude). Es PÚBLICA (integración proxy, sin
authorizer) para que la landing la use sin necesidad de iniciar sesión.

Ruta: POST /Assistant/Ask   (integración PROXY + CORS)
Request  body: { "question": "..." }
Respuesta: 200 { "answer": "..." } · 400 pregunta vacía · 502 modelo no disponible

El prompt de sistema aterriza al modelo en MailConnect (qué es, canales, precios, saldo,
cumplimiento) y le pide responder SOLO sobre la plataforma, en español y con honestidad.

Env:
  BEDROCK_MODEL_ID      (default 'anthropic.claude-3-5-haiku-20241022-v1:0')
                        ⚠️ Bedrock on-demand suele exigir un INFERENCE PROFILE regional:
                        p. ej. 'us.anthropic.claude-3-5-haiku-20241022-v1:0'. Ajustar según
                        el acceso a modelos de la cuenta.
  BEDROCK_REGION        (default 'us-east-1')
  ASSISTANT_MAX_TOKENS  (default 500)

Requisitos de despliegue [J]: habilitar acceso al modelo en Bedrock; permiso IAM
`bedrock:InvokeModel` (y el ARN del inference profile si aplica); ruta pública /Assistant/Ask
(proxy, sin authorizer) con CORS. Recomendado: throttling en API Gateway / WAF (endpoint
público → posible abuso/costo).
'''
import os
import json
import boto3

MODEL_ID = os.environ.get('BEDROCK_MODEL_ID', 'anthropic.claude-3-5-haiku-20241022-v1:0')
REGION = os.environ.get('BEDROCK_REGION', 'us-east-1')
MAX_TOKENS = int(os.environ.get('ASSISTANT_MAX_TOKENS', '500'))
MAX_QUESTION_CHARS = 1000

_client = None


def _bedrock():
    """Cliente perezoso de bedrock-runtime (se crea una vez por contenedor)."""
    global _client
    if _client is None:
        _client = boto3.client('bedrock-runtime', region_name=REGION)
    return _client


CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
}

SYSTEM_PROMPT = (
    "Eres el asistente virtual de MailConnect, una plataforma colombiana de comunicaciones "
    "masivas omnicanal. Respondes preguntas de clientes y prospectos SOBRE MailConnect.\n\n"
    "Qué es MailConnect:\n"
    "- Envío masivo por 4 canales desde un solo lugar: correo (email marketing, con adjunto "
    "único o adjunto personalizado por destinatario), SMS, WhatsApp (plantillas oficiales de "
    "Meta) y voz (texto a voz).\n"
    "- Combinación de correspondencia: genera documentos únicos (cartas, facturas, "
    "certificados) por destinatario desde una plantilla y una base de datos (CSV/Excel).\n"
    "- Editor de plantillas HTML de arrastrar y soltar, plantillas PDF y plantillas SMS/WhatsApp.\n"
    "- Estadísticas en tiempo real (entregas, aperturas, clics, rebotes), reportes y lista negra.\n"
    "- Saldo PREPAGO en pesos colombianos (COP): se recarga con Wompi (tarjeta, PSE, Nequi) o "
    "por transferencia; cada envío descuenta su costo del saldo.\n"
    "- Precios por volumen (desde ~30 COP por correo según la cantidad); pagas solo por lo que "
    "envías.\n"
    "- Dominios y correos remitentes propios verificados (SPF/DKIM/DMARC), flujo de aprobación "
    "de campañas (muestras antes del envío real) y cumplimiento de la Ley 1581 (Habeas Data).\n"
    "- Construida sobre AWS (SES / End User Messaging).\n\n"
    "Reglas:\n"
    "- Responde SIEMPRE en español, claro y breve (máx. ~4 frases salvo que pidan detalle).\n"
    "- Responde SOLO sobre MailConnect y temas de comunicaciones/marketing. Si preguntan algo "
    "no relacionado o que no sabes con certeza, dilo con honestidad y sugiere escribir al "
    "WhatsApp de soporte.\n"
    "- No inventes precios exactos ni prometas cosas que no puedas confirmar; da rangos y "
    "remite a una cotización si hace falta.\n"
    "- Nunca pidas ni manejes datos sensibles (contraseñas, tarjetas)."
)


def _response(status_code, payload):
    return {
        'statusCode': status_code,
        'headers': {**CORS_HEADERS, 'Content-Type': 'application/json'},
        'body': json.dumps(payload),
    }


def _extract_question(event):
    """La pregunta puede llegar como body-proxy (string JSON) o como evento directo."""
    body = event.get('body') if isinstance(event, dict) else None
    if isinstance(body, str):
        try:
            body = json.loads(body)
        except Exception:
            body = {}
    if not isinstance(body, dict):
        body = event if isinstance(event, dict) else {}
    return str(body.get('question', '') or '').strip()


def lambda_handler(event, context):
    method = (event.get('httpMethod') or '').upper() if isinstance(event, dict) else ''
    if method == 'OPTIONS':  # preflight CORS
        return _response(200, {})

    question = _extract_question(event)
    if not question:
        return _response(400, {'error': 'Escribe una pregunta.'})
    if len(question) > MAX_QUESTION_CHARS:
        question = question[:MAX_QUESTION_CHARS]

    try:
        resp = _bedrock().converse(
            modelId=MODEL_ID,
            system=[{'text': SYSTEM_PROMPT}],
            messages=[{'role': 'user', 'content': [{'text': question}]}],
            inferenceConfig={'maxTokens': MAX_TOKENS, 'temperature': 0.3},
        )
        answer = (resp['output']['message']['content'][0]['text'] or '').strip()
        if not answer:
            raise ValueError('respuesta vacía del modelo')
        return _response(200, {'answer': answer})
    except Exception as e:
        print('Error invocando Bedrock ({}): {}'.format(MODEL_ID, e))
        return _response(502, {
            'error': 'El asistente no está disponible en este momento. Escríbenos por WhatsApp '
                     'y con gusto te ayudamos.',
        })
