'''
Lambda ADMIN: LEER la bitácora de auditoría (tabla `adminAudit`).

Registra quién hizo qué y cuándo en las acciones administrativas sensibles
(habilitar envíos, cambiar rol, tocar tarifas o configuración). Las lambdas que
mutan escriben aquí (best-effort); esta solo lee.

Ruta: POST /Admin/Audit  (integración no-proxy, envelope estándar)
Request:  { month?, action?, actor? }
    - month  : 'YYYY-MM' para acotar por fecha. Vacío = recientes.
    - action : filtra por tipo de acción (customer.realSend, user.role, ...).
    - actor  : filtra por actor (coincidencia por substring, case-insensitive).
Respuesta: 200 { data: { entries:[{auditId, date, actor, action, target, detail,
                                   customer}], count, actions[], truncated } }

⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.

Tabla DynamoDB: adminAudit (PK auditId). Devuelve vacío si la tabla no existe.
'''
import json
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table('adminAudit')

MAX_ENTRIES = 500  # tope de eventos devueltos (los más recientes)


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            parsed = json.loads(event['body'])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    return event if isinstance(event, dict) else {}


def _is_admin(event):
    if not isinstance(event, dict):
        return False
    auth = (event.get('requestContext') or {}).get('authorizer') or {}
    return str(auth.get('role', '')).lower() == 'admin'


def _scan_all(**kwargs):
    items = []
    try:
        while True:
            resp = table.scan(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            return []
        raise
    return items


def lambda_handler(event, context):
    if not _is_admin(event):
        return {'status': False, 'statusCode': 403,
                'description': 'Acceso restringido a administradores.', 'data': {}}

    payload = _get_payload(event)
    month = str(payload.get('month', '') or '').strip()
    action = str(payload.get('action', '') or '').strip()
    actor = str(payload.get('actor', '') or '').strip().lower()

    try:
        items = _scan_all()

        # Catálogo de acciones presentes (para el filtro de la UI), antes de filtrar.
        actions = sorted({str(i.get('action', '')) for i in items if i.get('action')})

        if month:
            items = [i for i in items if str(i.get('date', '')).startswith(month)]
        if action:
            items = [i for i in items if str(i.get('action', '')) == action]
        if actor:
            items = [i for i in items if actor in str(i.get('actor', '')).lower()]

        # Más recientes primero.
        items.sort(key=lambda i: str(i.get('date', '')), reverse=True)
        truncated = len(items) > MAX_ENTRIES
        items = items[:MAX_ENTRIES]

        entries = [{
            'auditId': i.get('auditId'),
            'date': i.get('date', ''),
            'actor': i.get('actor', ''),
            'action': i.get('action', ''),
            'target': i.get('target', ''),
            'detail': i.get('detail', ''),
            'customer': i.get('customer', ''),
        } for i in items]

        return {'status': True, 'statusCode': 200,
                'description': 'Bitácora de auditoría' + (' (parcial)' if truncated else ''),
                'data': {'entries': entries, 'count': len(entries), 'actions': actions, 'truncated': truncated}}
    except Exception as e:
        print('Error leyendo auditoría: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al leer la auditoría', 'data': {}}
