'''
Lambda de HIGIENE DE LISTAS: verificación PREVIA de una base registrada, antes del
envío real, con reporte por categorías (Bloque E — protege la reputación SES compartida).

Ruta: POST /Database/Verify  (no-proxy, envelope estándar; identidad del Authorizer)
Request:  { databaseFileId }
Respuesta 200 data: {
  databaseFileId, fileName, channel, contactType, total, analyzed, truncated,
  counts:  { valid, invalidSyntax, duplicates, disposable, roleAccounts,
             unresolvableDomains },
  domains: { unique, checked, skipped, unresolved: [dominio,...] },   # solo correo
  samples: { invalidSyntax[], duplicates[], disposable[], roleAccounts[],
             unresolvableDomains[] },                                  # máx. 20 c/u
  hygieneScore (0-100), level (ok|warning|critical)
}
403 otro cliente · 404 base no existe · 400 falta id · 502 no se pudo leer el CSV.

Checks por canal:
- CORREO (EM/EAU/EAP): sintaxis, duplicados (case-insensitive), dominios DESECHABLES
  (proveedores de correo temporal, lista embebida), cuentas de ROL (info@, noreply@… —
  solo advertencia, no bajan el score) y dominio RESOLUBLE en DNS. La verificación de
  dominio es la aproximación práctica del "chequeo MX": si la lambda tiene la librería
  `dns` (dnspython, por layer) consulta los registros MX de verdad; si no, usa
  socket.getaddrinfo (un dominio que NO resuelve rebotará seguro). Se consulta UNA vez
  por dominio (cache) con tope de dominios por llamada.
- CELULAR (SMS/WSP/VOZ): sintaxis E.164 (normaliza +57 como el pipeline) y duplicados.

El RESUMEN se persiste en el registro `databaseFile` (campo `hygiene` + `hygieneAt`)
para que la tabla de bases muestre el estado sin re-verificar (best-effort).

[J]: ruta /Database/Verify (authorizer + CORS + mapping template con customerId/
customer/nit) — ya en routes.json; el CD crea la lambda. IAM: `dynamodb:GetItem/
UpdateItem databaseFile`, `s3:GetObject` sobre los buckets de cliente. Layer OPCIONAL
con dnspython para el chequeo MX real (sin él, cae a resolución del dominio).
'''
import os
import re
import csv
import json
import time
import socket

import boto3

try:  # dnspython (layer opcional) → chequeo MX real; sin él, getaddrinfo.
    import dns.resolver as _dns_resolver
except Exception:
    _dns_resolver = None

REGION = 'us-east-1'
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table_database = dynamodb.Table('databaseFile')
s3 = boto3.client('s3', region_name=REGION)

BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
ENCODING = 'utf-8'
CANDIDATE_DELIMITERS = [';', ',', '\t', '|']
CONTACT_COL = 1
PHONE_CHANNELS = ('SMS', 'WSP', 'VOZ')
PATRON_EMAIL = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$'

MAX_ROWS = int(os.environ.get('HYGIENE_MAX_ROWS', '20000'))          # filas analizadas
MAX_DOMAIN_LOOKUPS = int(os.environ.get('HYGIENE_MAX_DOMAINS', '200'))  # DNS por llamada
MAX_SAMPLES = 20   # ejemplos por categoría en el reporte

# Dominios de correo TEMPORAL/desechable más comunes (rebotan o desaparecen en días —
# veneno para la reputación). Lista embebida, ampliable por env (coma-separada).
DISPOSABLE_DOMAINS = {
    'mailinator.com', 'yopmail.com', 'guerrillamail.com', 'guerrillamail.net',
    'sharklasers.com', '10minutemail.com', '10minutemail.net', 'temp-mail.org',
    'tempmail.com', 'tempmail.net', 'temp-mail.io', 'throwawaymail.com',
    'getnada.com', 'nada.email', 'maildrop.cc', 'mailnesia.com', 'trashmail.com',
    'trashmail.de', 'dispostable.com', 'mintemail.com', 'mytemp.email',
    'fakeinbox.com', 'spamgourmet.com', 'mailcatch.com', 'moakt.com', 'tmpmail.org',
    'emailondeck.com', 'mohmal.com', 'anonbox.net', 'burnermail.io', 'mailsac.com',
    'inboxkitten.com', 'tempinbox.com', 'discard.email', 'wegwerfmail.de',
}
_extra = os.environ.get('HYGIENE_DISPOSABLE_EXTRA', '')
if _extra:
    DISPOSABLE_DOMAINS |= {d.strip().lower() for d in _extra.split(',') if d.strip()}

# Cuentas de ROL (buzones genéricos): legales pero con apertura bajísima y más quejas.
# Solo ADVERTENCIA (no bajan el score): el cliente decide si las deja.
ROLE_ACCOUNTS = {
    'info', 'contacto', 'contact', 'admin', 'administrador', 'soporte', 'support',
    'ventas', 'sales', 'noreply', 'no-reply', 'no.reply', 'notificaciones',
    'webmaster', 'postmaster', 'abuse', 'facturacion', 'billing', 'rrhh', 'hr',
    'gerencia', 'servicioalcliente', 'atencionalcliente', 'pqr', 'pqrs',
}


def tenant_key(nit):
    """Llave de tenant (NIT saneado) — misma convención del resto del pipeline."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit):
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))


def _get_payload(event):
    if isinstance(event, dict) and isinstance(event.get('body'), dict):
        return event['body']
    if isinstance(event, dict) and isinstance(event.get('body'), str):
        try:
            return json.loads(event['body'])
        except Exception:
            return {}
    return event if isinstance(event, dict) else {}


def _resolve_tenant(event):
    """(customerId, customer, nit) SOLO del context del Authorizer."""
    auth = ((event or {}).get('requestContext') or {}).get('authorizer') or {}
    return auth.get('customerId'), auth.get('customer'), auth.get('nit')


def detect_delimiter(path, default=';'):
    """Mismo criterio que Prepare-batch: el delimitador que más aparece en la 1ª línea."""
    try:
        with open(path, 'r', encoding=ENCODING) as f:
            for line in f:
                if line.strip():
                    counts = {d: line.count(d) for d in CANDIDATE_DELIMITERS}
                    best = max(counts, key=counts.get)
                    return best if counts[best] > 0 else default
    except Exception as e:
        print('No se pudo detectar el delimitador ({}); se usa {!r}'.format(e, default))
    return default


def normalize_phone(raw):
    """E.164 con +57 por defecto (misma lógica del pipeline). '' si no es plausible."""
    if raw is None:
        return ''
    p = re.sub(r'[\s()\-.]', '', str(raw))
    if not p:
        return ''
    if p.startswith('00'):
        p = '+' + p[2:]
    if p.startswith('+'):
        digits = p[1:]
        return '+' + digits if (digits.isdigit() and 8 <= len(digits) <= 15) else ''
    if not p.isdigit():
        return ''
    if p.startswith('57') and len(p) == 12:
        return '+' + p
    if len(p) == 10:
        return '+57' + p
    return ''


def domain_resolves(domain, cache, stats):
    """¿El dominio existe en DNS? MX real con dnspython (si el layer está) o
    getaddrinfo como aproximación. Cachea por dominio y respeta el tope de lookups
    (dominio no consultado → se asume OK y cuenta en `skipped`, no penaliza)."""
    domain = str(domain or '').lower()
    if domain in cache:
        return cache[domain]
    if stats['checked'] >= MAX_DOMAIN_LOOKUPS:
        stats['skipped'] += 1
        return True
    stats['checked'] += 1
    ok = True
    if _dns_resolver is not None:
        try:
            answers = _dns_resolver.resolve(domain, 'MX', lifetime=2.0)
            ok = len(list(answers)) > 0
        except Exception:
            ok = False
    else:
        try:
            socket.getaddrinfo(domain, None)
            ok = True
        except socket.gaierror:
            ok = False
        except Exception:
            ok = True   # error transitorio → no penalizar (fail-open del check)
    cache[domain] = ok
    return ok


def lambda_handler(event, context):
    payload = _get_payload(event)
    customer_id, customer, nit = _resolve_tenant(event)
    if not customer_id and not customer:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    file_id = str(payload.get('databaseFileId', '') or '').strip()
    if not file_id:
        return {'status': False, 'statusCode': 400,
                'description': 'Indica el databaseFileId.', 'data': {}}

    try:
        item = table_database.get_item(Key={'databaseFileId': file_id}).get('Item')
        if not item:
            return {'status': False, 'statusCode': 404,
                    'description': 'La base no existe.', 'data': {}}
        # Aislamiento multi-tenant: la base debe ser del cliente del token.
        owner_ok = (customer_id and item.get('customerId') == customer_id) or \
                   (customer and item.get('customer') == customer)
        if not owner_ok:
            return {'status': False, 'statusCode': 403,
                    'description': 'La base pertenece a otro cliente.', 'data': {}}

        s3_path = str(item.get('s3Path', '') or '')
        if not s3_path:
            return {'status': False, 'statusCode': 400,
                    'description': 'La base no tiene ruta S3 registrada.', 'data': {}}
        bucket = tenant_bucket(nit) if tenant_key(nit) else \
            '{}.database'.format(str(item.get('customer', '')).lower())
        temp_file = '/tmp/hygiene-{}.csv'.format(file_id)
        try:
            s3.download_file(bucket, s3_path, temp_file)
        except Exception as e:
            print('No se pudo descargar s3://{}/{}: {}'.format(bucket, s3_path, e))
            return {'status': False, 'statusCode': 502,
                    'description': 'No se pudo leer el archivo de la base desde S3.',
                    'data': {}}

        channel = str(item.get('channel', 'EMAIL') or 'EMAIL').upper()
        is_phone = channel in PHONE_CHANNELS
        delimiter = detect_delimiter(temp_file)

        counts = {'valid': 0, 'invalidSyntax': 0, 'duplicates': 0, 'disposable': 0,
                  'roleAccounts': 0, 'unresolvableDomains': 0}
        samples = {k: [] for k in
                   ('invalidSyntax', 'duplicates', 'disposable', 'roleAccounts',
                    'unresolvableDomains')}
        domain_cache = {}
        domain_stats = {'checked': 0, 'skipped': 0}
        seen = set()
        total = 0
        analyzed = 0
        truncated = False

        def _sample(cat, value):
            if len(samples[cat]) < MAX_SAMPLES:
                samples[cat].append(str(value)[:120])

        with open(temp_file, 'r', encoding=ENCODING, errors='replace') as f:
            reader = csv.reader(f, delimiter=delimiter)
            next(reader, None)   # encabezado
            for line in reader:
                if not line or not any(str(c).strip() for c in line):
                    continue
                total += 1
                if analyzed >= MAX_ROWS:
                    truncated = True
                    continue   # sigue contando el total, pero ya no analiza
                analyzed += 1
                raw = str(line[CONTACT_COL]).strip() if len(line) > CONTACT_COL else ''

                if is_phone:
                    norm = normalize_phone(raw)
                    if not norm:
                        counts['invalidSyntax'] += 1
                        _sample('invalidSyntax', raw or '(vacío)')
                        continue
                    if norm in seen:
                        counts['duplicates'] += 1
                        _sample('duplicates', norm)
                        continue
                    seen.add(norm)
                    counts['valid'] += 1
                    continue

                email = raw.lower()
                if not re.match(PATRON_EMAIL, raw or ''):
                    counts['invalidSyntax'] += 1
                    _sample('invalidSyntax', raw or '(vacío)')
                    continue
                if email in seen:
                    counts['duplicates'] += 1
                    _sample('duplicates', email)
                    continue
                seen.add(email)
                local, _, domain = email.partition('@')

                bad = False
                if domain in DISPOSABLE_DOMAINS:
                    counts['disposable'] += 1
                    _sample('disposable', email)
                    bad = True
                elif not domain_resolves(domain, domain_cache, domain_stats):
                    counts['unresolvableDomains'] += 1
                    _sample('unresolvableDomains', email)
                    bad = True
                # Cuenta de ROL: advertencia aparte (puede solaparse con las de arriba).
                if local in ROLE_ACCOUNTS:
                    counts['roleAccounts'] += 1
                    _sample('roleAccounts', email)
                if not bad:
                    counts['valid'] += 1

        try:
            os.remove(temp_file)
        except Exception:
            pass

        # Score: % de contactos "limpios" sobre lo analizado. Las cuentas de rol NO
        # penalizan (advertencia). Umbrales alineados con la industria de verificación.
        penalized = (counts['invalidSyntax'] + counts['duplicates'] +
                     counts['disposable'] + counts['unresolvableDomains'])
        score = round(100.0 * (analyzed - penalized) / analyzed, 1) if analyzed else 100.0
        level = 'ok' if score >= 95 else ('warning' if score >= 85 else 'critical')

        unresolved_domains = sorted(d for d, ok in domain_cache.items() if not ok)
        result = {
            'databaseFileId': file_id,
            'fileName': item.get('fileName', ''),
            'channel': channel,
            'contactType': 'celular' if is_phone else 'correo',
            'total': total,
            'analyzed': analyzed,
            'truncated': truncated,
            'counts': counts,
            'domains': {'unique': len(domain_cache) + domain_stats['skipped'],
                        'checked': domain_stats['checked'],
                        'skipped': domain_stats['skipped'],
                        'unresolved': unresolved_domains[:50]},
            'samples': samples,
            'hygieneScore': score,
            'level': level,
        }

        # Persistir el RESUMEN en el registro de la base (best-effort).
        try:
            table_database.update_item(
                Key={'databaseFileId': file_id},
                UpdateExpression='SET hygiene = :h, hygieneAt = :t',
                ExpressionAttributeValues={
                    ':h': {'score': str(score), 'level': level, 'analyzed': analyzed,
                           **{k: v for k, v in counts.items()}},
                    ':t': time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime()),
                })
        except Exception as e:
            print('No se pudo persistir el resumen de higiene: {}'.format(e))

        return {'status': True, 'statusCode': 200,
                'description': 'Verificación de higiene de la base', 'data': result}
    except Exception as e:
        print('Error en la verificación de higiene: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado verificando la base', 'data': {}}
