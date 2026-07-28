'''
Lambda CLIENTE: LISTAR las imágenes que el cliente ya subió (biblioteca reutilizable).

Problema que resuelve: cada imagen del constructor se sube al prefijo PÚBLICO
`resources/` del bucket del tenant, pero no había forma de volver a usarla. El cliente
terminaba subiendo el MISMO logo en cada plantilla que hacía.

Ruta: POST /Resources/List  (integración no-proxy, envelope estándar)
Request:  { prefix?, limit? }   (el tenant sale del context del Authorizer)
Respuesta: 200 { data: { images: [{ key, url, name, size, modified }], count, truncated } }
           · 403 sin sesión · 502 S3

Solo lee el bucket del PROPIO cliente (`tenant_bucket(nit)`), así que no hay forma de
listar el material de otra empresa: el NIT viene del token, no del body.

⚠️ [J]: lambda + ruta /Resources/List (authorizer + CORS + mapping template con
customerId/customer/nit); IAM `s3:ListBucket` sobre los buckets de cliente.
'''
import json
import os
import re

import boto3
from botocore.exceptions import ClientError

REGION = 'us-east-1'
s3 = boto3.client('s3', region_name=REGION)

BUCKET_PREFIX = os.environ.get('BUCKET_PREFIX', 'mailconnect')
DEFAULT_LIMIT = int(os.environ.get('RESOURCES_LIST_LIMIT', '200'))
MAX_LIMIT = 500

# Prefijos PÚBLICOS que tiene sentido ofrecer como biblioteca. `database/` y `document/`
# son privados (bases de contactos y comprobantes): no se listan aquí ni por error.
ALLOWED_PREFIXES = ('resources/', 'attachment/')

IMAGE_EXT = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg')


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


def _authorizer(event):
    if not isinstance(event, dict):
        return {}
    return (event.get('requestContext') or {}).get('authorizer') or {}


def tenant_key(nit):
    """Llave del tenant: el NIT saneado (copiada, convención del repo). Idempotente."""
    return re.sub(r'[^a-z0-9]', '', str(nit or '').lower())


def tenant_bucket(nit):
    return '{}-{}'.format(BUCKET_PREFIX, tenant_key(nit))


def lambda_handler(event, context):
    auth = _authorizer(event)
    nit = auth.get('nit') or auth.get('companyTin')
    if not auth.get('customerId') or not nit:
        return {'status': False, 'statusCode': 403,
                'description': 'Sesión sin identidad de cliente.', 'data': {}}

    payload = _get_payload(event)
    prefix = str(payload.get('prefix', 'resources/') or 'resources/')
    if prefix not in ALLOWED_PREFIXES:
        prefix = 'resources/'
    try:
        limit = int(payload.get('limit') or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT
    limit = max(1, min(limit, MAX_LIMIT))

    bucket = tenant_bucket(nit)
    images = []
    truncated = False
    try:
        paginator = s3.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix,
                                       PaginationConfig={'MaxItems': limit + 1}):
            for obj in page.get('Contents', []):
                key = obj.get('Key', '')
                if not key.lower().endswith(IMAGE_EXT):
                    continue          # solo imágenes: aquí también viven .html y .docx
                if len(images) >= limit:
                    truncated = True
                    break
                images.append({
                    'key': key,
                    'url': 'https://s3.{}.amazonaws.com/{}/{}'.format(REGION, bucket, key),
                    'name': key.split('/')[-1],
                    'size': int(obj.get('Size', 0)),
                    'modified': obj['LastModified'].strftime('%Y-%m-%d %H:%M:%S')
                    if obj.get('LastModified') else '',
                })
            if truncated:
                break
    except ClientError as e:
        code = e.response.get('Error', {}).get('Code', '')
        # Un cliente que aún no ha subido nada no tiene bucket: es lista vacía, no error.
        if code in ('NoSuchBucket', 'AccessDenied'):
            return {'status': True, 'statusCode': 200, 'description': 'Sin imágenes',
                    'data': {'images': [], 'count': 0, 'truncated': False}}
        print('Error listando recursos: {}'.format(e))
        return {'status': False, 'statusCode': 502,
                'description': 'No se pudieron listar las imágenes.', 'data': {}}
    except Exception as e:
        print('Error no controlado listando recursos: {}'.format(e))
        return {'status': False, 'statusCode': 500,
                'description': 'Error no controlado al listar las imágenes.', 'data': {}}

    # Más recientes primero: lo que se acaba de subir es lo que se suele querer.
    images.sort(key=lambda i: i['modified'], reverse=True)
    return {'status': True, 'statusCode': 200, 'description': 'Imágenes del cliente',
            'data': {'images': images, 'count': len(images), 'truncated': truncated}}
