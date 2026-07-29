'''
Lambda: LISTAR los remitentes del cliente (DOMINIOS y CORREOS) y REFRESCAR su estado desde SES.

Consulta las identidades del cliente (tabla `senderDomain`, GSI por customerId) y para cada una
pregunta a SES el estado de verificación (`get_identity_verification_attributes`). Este mismo
endpoint sirve para dominios y para correos: `get_identity_verification_attributes` devuelve el
estado tanto de una identidad de dominio como de una de correo. Actualiza `status`
(pending|verified|failed) en la tabla y devuelve la lista con su tipo y registros DNS (los
correos no llevan registros; se verifican por el enlace que SES envía a la dirección).

Ruta: POST /Domain/List  (no-proxy, envelope estándar)
Request:  {}
Respuesta: 200 data:{ domains:[{domainId, kind, domain, status, records, deliverability?,
                                 createdAt, verifiedAt}], count }

── Panel SPF / DKIM / DMARC (ago 2026) ──────────────────────────────────────────────────
`status` (arriba) SOLO refleja el TXT de PROPIEDAD del dominio (`_amazonses.<dominio>`), que
en el producto se venía mostrando como "el" estado — pero eso no dice nada de si DKIM quedó
firmando, ni de si el dominio tiene SPF o DMARC publicados. Para DOMINIOS (no para correos
sueltos, que no firman con Easy DKIM) se agrega `deliverability`:
  - `dkim`  — REAL, de `get_identity_dkim_attributes` (Success→verified). Ya se pedía el IAM
    `ses:GetIdentityDkimAttributes` para otra cosa; no hace falta permiso nuevo.
  - `spf`   — lectura del TXT del dominio buscando `v=spf1 … amazonses.com`. ⚠️ Es
    RECOMENDADO, no obligatorio: como el remitente no usa un dominio MAIL FROM propio (Return-
    Path sigue en amazonses.com), DMARC ya se alinea por DKIM y el envío funciona SIN este
    registro. Se ofrece igual porque varios clientes lo esperan por costumbre de otras
    plataformas.
  - `dmarc` — lectura del TXT `_dmarc.<dominio>` buscando `v=DMARC1`. Tampoco es obligatorio
    para que SES entregue, pero sin él el dominio no tiene política DMARC propia.
  - SPF/DMARC necesitan poder resolver TXT, que **`socket` no hace** (a diferencia del check
    MX de `Database_Verify`, que sí puede caer a `getaddrinfo`). Sin el layer de `dnspython`
    el estado queda en `unknown` — nunca se inventa un resultado.
'''
import os
import time
import boto3
from decimal import Decimal
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

try:  # dnspython (layer opcional) → lectura real de TXT; sin él, SPF/DMARC quedan 'unknown'.
    import dns.resolver as _dns_resolver
except Exception:
    _dns_resolver = None

REGION = os.environ.get('SES_REGION', 'us-east-1')
ses = boto3.client('ses', region_name=REGION)
dynamodb = boto3.resource('dynamodb')
table_domain = dynamodb.Table('senderDomain')

SPF_RECORD = 'v=spf1 include:amazonses.com ~all'
DMARC_RECORD = 'v=DMARC1; p=none;'
#: Tope de dominios a los que se les hace el chequeo DNS de SPF/DMARC por llamada — son
#: los propios del cliente (normalmente unos pocos), pero un tope evita que una cuenta con
#: decenas de dominios alargue la respuesta por lookups DNS uno a uno.
MAX_DELIVERABILITY_DOMAINS = int(os.environ.get('DELIVERABILITY_MAX_DOMAINS', '20'))


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def _clean(value):
    if isinstance(value, Decimal):
        return int(value) if value % 1 == 0 else float(value)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(v) for v in value]
    return value


def _ses_status(domains):
    """Estado consolidado por dominio: 'verified' si la identidad está Success, 'failed' si
    Failed, 'pending' en otro caso. Best-effort (si SES falla, deja el estado guardado)."""
    result = {}
    if not domains:
        return result
    try:
        ver = ses.get_identity_verification_attributes(Identities=domains).get('VerificationAttributes', {})
    except Exception as e:
        print('No se pudo consultar verificación SES: {}'.format(e))
        ver = {}
    for d in domains:
        st = (ver.get(d, {}) or {}).get('VerificationStatus', '')
        if st == 'Success':
            result[d] = 'verified'
        elif st in ('Failed', 'TemporaryFailure'):
            result[d] = 'failed'
        else:
            result[d] = 'pending'
    return result


def _dkim_status(domains):
    """Estado REAL de DKIM por dominio (distinto del `status` general, que solo cubre el TXT
    de propiedad): 'verified' si SES ya firma con ese dominio, 'failed' si SES no pudo
    verificar los CNAME, 'pending' mientras espera propagación, 'unknown' si la consulta
    falla (nunca se asume un resultado)."""
    result = {}
    if not domains:
        return result
    try:
        attrs = ses.get_identity_dkim_attributes(Identities=domains).get('DkimAttributes', {})
    except Exception as e:
        print('No se pudo consultar DKIM: {}'.format(e))
        for d in domains:
            result[d] = 'unknown'
        return result
    for d in domains:
        st = (attrs.get(d, {}) or {}).get('DkimVerificationStatus', '')
        if st == 'Success':
            result[d] = 'verified'
        elif st in ('Failed', 'TemporaryFailure'):
            result[d] = 'failed'
        else:
            result[d] = 'pending'
    return result


def _txt_records(name):
    """Registros TXT de `name` (unidos: un TXT puede llegar partido en varios strings).
    `None` = sin el layer de dnspython, no se pudo ni intentar. `[]` = se consultó y no hay
    registro (o el dominio no existe)."""
    if _dns_resolver is None:
        return None
    try:
        answers = _dns_resolver.resolve(name, 'TXT', lifetime=2.5)
        return [b''.join(r.strings).decode('utf-8', 'ignore') for r in answers]
    except Exception:
        return []   # NXDOMAIN, sin respuesta, timeout… todo se lee igual: "no publicado".


def _spf_status(domain):
    """'verified' si el TXT del dominio incluye el mecanismo de SES; 'pending' si no está
    publicado; 'unknown' sin el layer de dnspython. NO es obligatorio para enviar (ver
    docstring del módulo) — se ofrece por costumbre de otras plataformas."""
    txts = _txt_records(domain)
    if txts is None:
        return 'unknown'
    for t in txts:
        if t.strip().lower().startswith('v=spf1') and 'amazonses.com' in t.lower():
            return 'verified'
    return 'pending'


def _dmarc_status(domain):
    """'verified' si existe `_dmarc.<dominio>` con `v=DMARC1`; 'pending' si no está
    publicado; 'unknown' sin el layer de dnspython."""
    txts = _txt_records('_dmarc.' + domain)
    if txts is None:
        return 'unknown'
    for t in txts:
        if t.strip().lower().startswith('v=dmarc1'):
            return 'verified'
    return 'pending'


def lambda_handler(event, context):
    auth = _authorizer(event)
    customer_id = auth.get('customerId')
    if not customer_id:
        return {'status': False, 'statusCode': 403, 'description': 'Sesión sin identidad de cliente.',
                'data': {'domains': [], 'count': 0}}

    try:
        items = []
        kwargs = {'IndexName': 'customerId-index', 'KeyConditionExpression': Key('customerId').eq(customer_id)}
        while True:
            resp = table_domain.query(**kwargs)
            items.extend(resp.get('Items', []))
            last = resp.get('LastEvaluatedKey')
            if not last:
                break
            kwargs['ExclusiveStartKey'] = last

        domains = [str(i.get('domain', '')) for i in items if i.get('domain')]
        status_by_domain = _ses_status(domains)

        # Solo los DOMINIOS (no los correos sueltos, que no firman con Easy DKIM) llevan el
        # panel SPF/DKIM/DMARC. Un tope evita que muchos dominios alarguen la respuesta con
        # lookups DNS uno a uno.
        dominios_kind = [
            str(i.get('domain', '')) for i in items
            if i.get('domain') and (i.get('kind') or 'domain') == 'domain'
        ][:MAX_DELIVERABILITY_DOMAINS]
        dkim_by_domain = _dkim_status(dominios_kind)
        spf_by_domain = {d: _spf_status(d) for d in dominios_kind}
        dmarc_by_domain = {d: _dmarc_status(d) for d in dominios_kind}

        now = time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())

        out = []
        for it in items:
            d = str(it.get('domain', ''))
            new_status = status_by_domain.get(d, it.get('status', 'pending'))
            # Persistir el estado si cambió (best-effort).
            if new_status != it.get('status'):
                try:
                    upd = 'SET #s = :s'
                    vals = {':s': new_status}
                    if new_status == 'verified' and not it.get('verifiedAt'):
                        upd += ', verifiedAt = :v'
                        vals[':v'] = now
                    table_domain.update_item(
                        Key={'domainId': it['domainId']},
                        UpdateExpression=upd,
                        ExpressionAttributeNames={'#s': 'status'},
                        ExpressionAttributeValues=vals)
                    it['status'] = new_status
                    if new_status == 'verified' and not it.get('verifiedAt'):
                        it['verifiedAt'] = now
                except Exception as e:
                    print('No se pudo actualizar el estado de {}: {}'.format(d, e))
            kind = it.get('kind') or ('email' if '@' in d else 'domain')
            fila = {
                'domainId': it.get('domainId'),
                # kind: 'domain' | 'email'. Autodetecta por '@' para filas legacy sin el campo.
                'kind': kind,
                'domain': d,
                'status': it.get('status', 'pending'),
                'records': it.get('records', []),
                'createdAt': it.get('createdAt', ''),
                'verifiedAt': it.get('verifiedAt', ''),
            }
            if kind == 'domain' and d in dkim_by_domain:
                fila['deliverability'] = {
                    'dkim': {'status': dkim_by_domain.get(d, 'unknown')},
                    'spf': {'status': spf_by_domain.get(d, 'unknown'), 'record': SPF_RECORD},
                    'dmarc': {'status': dmarc_by_domain.get(d, 'unknown'),
                              'name': '_dmarc.' + d, 'record': DMARC_RECORD},
                }
            out.append(_clean(fila))

        out.sort(key=lambda x: str(x.get('createdAt', '')), reverse=True)
        return {'status': True, 'statusCode': 200, 'description': 'Dominios del cliente',
                'data': {'domains': out, 'count': len(out)}}
    except ClientError as e:
        if e.response['Error']['Code'] == 'ResourceNotFoundException':
            # La tabla aún no existe (ningún dominio registrado): lista vacía, no es error.
            return {'status': True, 'statusCode': 200, 'description': 'Sin dominios',
                    'data': {'domains': [], 'count': 0}}
        print('Error listando dominios: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'No se pudieron listar los dominios.',
                'data': {'domains': [], 'count': 0}}
    except Exception as e:
        print('Error no controlado listando dominios: {}'.format(e))
        return {'status': False, 'statusCode': 500, 'description': 'Error no controlado al listar los dominios.',
                'data': {'domains': [], 'count': 0}}
