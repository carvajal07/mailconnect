#!/usr/bin/env python3
"""
Sincroniza la configuración de API Gateway (REST) desde infra/api/routes.json.

Idempotente: crea lo que falte y ajusta lo existente. Por cada ruta del catálogo:
  1. crea el árbol de recursos (p. ej. /V1, /V1/Customer, /V1/Customer/List),
  2. crea el método (POST por defecto) con o sin Authorizer,
  3. configura la integración Lambda (no-proxy con mapping template de rol/tenant si
     admin=true; o AWS_PROXY si proxy=true),
  4. crea el OPTIONS de preflight (CORS) si cors=true,
  5. da permiso a API Gateway para invocar la Lambda.
Al final: CORS en Gateway Responses (4XX/5XX) y despliegue al stage.

Uso:
  API_ID=xxxxx STAGE=V1 AUTHORIZER_ID=abr9e7 python scripts/sync_api.py
  python scripts/sync_api.py --plan     # muestra el plan SIN tocar AWS

Variables de entorno:
  API_ID         (obligatoria salvo --plan) id de la REST API
  STAGE          stage a desplegar (default: V1)
  PREFIX         prefijo de recursos; sobreescribe el de routes.json (p. ej. /V1)
  AUTHORIZER_ID  id del Lambda authorizer para las rutas con auth
  AWS_REGION     default us-east-1
  ACCOUNT_ID     opcional; si falta se obtiene por STS
  ROUTES_FILE    default: infra/api/routes.json
  CORS_ORIGIN    default: *
"""
import os
import sys
import json

ROUTES_FILE = os.environ.get('ROUTES_FILE', 'infra/api/routes.json')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
STAGE = os.environ.get('STAGE', 'V1')
CORS_ORIGIN = os.environ.get('CORS_ORIGIN', '*')
PLAN = '--plan' in sys.argv or os.environ.get('DRY_RUN') == '1'

# Mapping template no-proxy: body como objeto JSON crudo + context del Authorizer.
# Se aplica a TODA ruta no-proxy autenticada (no solo admin): así las lambdas de
# cliente reciben customerId/customer del token (aislamiento multi-tenant), y las
# admin además el role. Las lambdas ya leen event['body'] (objeto) y
# event.requestContext.authorizer.*. El tenant es OBLIGATORIO: las lambdas
# multi-tenant deniegan (403) si el context no llega, así que este template debe
# estar desplegado ANTES de esas lambdas o las rutas de cliente responderán 403.
CONTEXT_TEMPLATE = (
    '{\n'
    '  "body": $input.json(\'$\'),\n'
    '  "requestContext": {\n'
    '    "authorizer": {\n'
    '      "role": "$context.authorizer.role",\n'
    '      "user": "$context.authorizer.user",\n'
    '      "userId": "$context.authorizer.userId",\n'
    '      "customerId": "$context.authorizer.customerId",\n'
    '      "customer": "$context.authorizer.customer"\n'
    '    }\n'
    '  }\n'
    '}'
)


def load_catalog():
    with open(ROUTES_FILE, encoding='utf-8') as fh:
        cat = json.load(fh)
    prefix = os.environ.get('PREFIX') or cat.get('prefix', '')
    routes = []
    for r in cat.get('routes', []):
        routes.append({
            'path': r['path'],
            'lambda': r['lambda'],
            'method': r.get('method', 'POST').upper(),
            'admin': bool(r.get('admin', False)),
            # admin ⇒ requiere auth por defecto; público solo si auth=false explícito.
            'auth': bool(r.get('auth', True)),
            'proxy': bool(r.get('proxy', False)),
            'cors': bool(r.get('cors', True)),
        })
    return prefix.rstrip('/'), routes


def full_path(prefix, path):
    return (prefix + path) if prefix else path


def segments(full):
    """/V1/Customer/List -> ['/V1', '/V1/Customer', '/V1/Customer/List']"""
    parts = [p for p in full.split('/') if p]
    acc, out = '', []
    for p in parts:
        acc += '/' + p
        out.append(acc)
    return out


def print_plan(prefix, routes):
    print(f"PLAN (sin cambios en AWS)  prefix='{prefix}'  stage='{STAGE}'  region='{REGION}'")
    print(f"Rutas en el catálogo: {len(routes)}\n")
    for r in routes:
        fp = full_path(prefix, r['path'])
        kind = 'AWS_PROXY' if r['proxy'] else ('no-proxy + template(context)' if r['auth'] else 'no-proxy (público)')
        auth = f"authorizer" if r['auth'] else "público (NONE)"
        cors = " +OPTIONS" if r['cors'] else ""
        print(f"  {r['method']:5} {fp}")
        print(f"        lambda={r['lambda']}  {kind}  {auth}{cors}")
    print("\nAdemás: CORS en Gateway Responses DEFAULT_4XX/5XX + deployment al stage.")
    # Validaciones de coherencia útiles aunque no toquemos AWS.
    dups = [p for p in _dups([full_path(prefix, r['path']) for r in routes])]
    if dups:
        print("\n⚠️  Rutas duplicadas:", ", ".join(sorted(set(dups))))
    admin_sin_auth = [r['path'] for r in routes if r['admin'] and not r['auth']]
    if admin_sin_auth:
        print("⚠️  admin=true sin auth (revisa):", ", ".join(admin_sin_auth))


def _dups(items):
    seen, out = set(), []
    for i in items:
        if i in seen:
            out.append(i)
        seen.add(i)
    return out


# --------------------------- Aplicación real (boto3) ---------------------------

def apply(prefix, routes):
    import boto3
    from botocore.exceptions import ClientError

    api_id = os.environ.get('API_ID')
    if not api_id:
        sys.exit("Falta API_ID (o usa --plan).")
    account = os.environ.get('ACCOUNT_ID') or boto3.client('sts').get_caller_identity()['Account']
    authorizer_id = os.environ.get('AUTHORIZER_ID', '')
    gw = boto3.client('apigateway', region_name=REGION)
    lam = boto3.client('lambda', region_name=REGION)

    # Mapa path -> resourceId (se actualiza al crear).
    resources = {}
    pos = None
    while True:
        kwargs = {'restApiId': api_id, 'limit': 500}
        if pos:
            kwargs['position'] = pos
        resp = gw.get_resources(**kwargs)
        for it in resp.get('items', []):
            resources[it['path']] = it['id']
        pos = resp.get('position')
        if not pos:
            break
    root_id = resources.get('/')
    if not root_id:
        sys.exit("No se encontró el recurso raíz '/' de la API.")

    def ensure_resource(fp):
        """Crea el árbol de recursos y devuelve el id del recurso hoja."""
        parent = root_id
        for partial in segments(fp):
            if partial in resources:
                parent = resources[partial]
                continue
            part = partial.rsplit('/', 1)[-1]
            print(f"  + recurso {partial}")
            created = gw.create_resource(restApiId=api_id, parentId=parent, pathPart=part)
            resources[partial] = created['id']
            parent = created['id']
        return resources[fp]

    def ensure_method(res_id, method, auth):
        auth_type = 'CUSTOM' if auth else 'NONE'
        try:
            gw.get_method(restApiId=api_id, resourceId=res_id, httpMethod=method)
            ops = [{'op': 'replace', 'path': '/authorizationType', 'value': auth_type}]
            if auth and authorizer_id:
                ops.append({'op': 'replace', 'path': '/authorizerId', 'value': authorizer_id})
            gw.update_method(restApiId=api_id, resourceId=res_id, httpMethod=method, patchOperations=ops)
        except ClientError as e:
            if e.response['Error']['Code'] != 'NotFoundException':
                raise
            kwargs = {'restApiId': api_id, 'resourceId': res_id, 'httpMethod': method,
                      'authorizationType': auth_type, 'apiKeyRequired': False}
            if auth and authorizer_id:
                kwargs['authorizerId'] = authorizer_id
            gw.put_method(**kwargs)

    def ensure_integration(res_id, r):
        uri = (f"arn:aws:apigateway:{REGION}:lambda:path/2015-03-31/functions/"
               f"arn:aws:lambda:{REGION}:{account}:function:{r['lambda']}/invocations")
        itype = 'AWS_PROXY' if r['proxy'] else 'AWS'
        kwargs = {'restApiId': api_id, 'resourceId': res_id, 'httpMethod': r['method'],
                  'type': itype, 'integrationHttpMethod': 'POST', 'uri': uri}
        # Inyectar el context del Authorizer en TODA ruta no-proxy autenticada
        # (antes solo admin). Sin auth (rutas públicas) se deja passthrough.
        if (not r['proxy']) and r['auth']:
            kwargs['requestTemplates'] = {'application/json': CONTEXT_TEMPLATE}
            kwargs['passthroughBehavior'] = 'WHEN_NO_TEMPLATES'
        gw.put_integration(**kwargs)
        if not r['proxy']:
            # Respuesta 200 de integración/método (no-proxy necesita method response).
            _ensure_method_response(res_id, r['method'], '200')
            try:
                gw.put_integration_response(restApiId=api_id, resourceId=res_id,
                                            httpMethod=r['method'], statusCode='200',
                                            selectionPattern='')
            except ClientError as e:
                if e.response['Error']['Code'] != 'ConflictException':
                    raise

    def _ensure_method_response(res_id, method, code, headers=None):
        params = {f'method.response.header.{h}': False for h in (headers or [])}
        try:
            gw.put_method_response(restApiId=api_id, resourceId=res_id, httpMethod=method,
                                   statusCode=code, responseParameters=params,
                                   responseModels={'application/json': 'Empty'})
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConflictException':
                raise

    def ensure_options_cors(res_id):
        h = 'method.response.header.Access-Control-Allow-'
        try:
            gw.put_method(restApiId=api_id, resourceId=res_id, httpMethod='OPTIONS',
                          authorizationType='NONE', apiKeyRequired=False)
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConflictException':
                raise
        gw.put_integration(restApiId=api_id, resourceId=res_id, httpMethod='OPTIONS',
                           type='MOCK', requestTemplates={'application/json': '{"statusCode": 200}'})
        try:
            gw.put_method_response(restApiId=api_id, resourceId=res_id, httpMethod='OPTIONS',
                                   statusCode='200',
                                   responseParameters={h + 'Headers': False, h + 'Methods': False, h + 'Origin': False},
                                   responseModels={'application/json': 'Empty'})
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConflictException':
                raise
        gw.put_integration_response(
            restApiId=api_id, resourceId=res_id, httpMethod='OPTIONS', statusCode='200',
            responseParameters={
                h + 'Headers': "'Content-Type,Authorization,token'",
                h + 'Methods': "'POST,OPTIONS'",
                h + 'Origin': "'%s'" % CORS_ORIGIN,
            },
            responseTemplates={'application/json': ''})

    def ensure_permission(fn):
        sid = 'apigw-%s' % api_id
        src = f"arn:aws:execute-api:{REGION}:{account}:{api_id}/*/*"
        try:
            lam.add_permission(FunctionName=fn, StatementId=sid, Action='lambda:InvokeFunction',
                               Principal='apigateway.amazonaws.com', SourceArn=src)
            print(f"  + permiso invoke a {fn}")
        except ClientError as e:
            if e.response['Error']['Code'] != 'ResourceConflictException':
                raise  # ya existe: ok

    # ---- recorrer catálogo ----
    for r in routes:
        fp = full_path(prefix, r['path'])
        print(f"→ {r['method']} {fp}  ({r['lambda']})")
        res_id = ensure_resource(fp)
        ensure_method(res_id, r['method'], r['auth'])
        ensure_integration(res_id, r)
        if r['cors']:
            ensure_options_cors(res_id)
        ensure_permission(r['lambda'])

    # CORS en respuestas de error (para no enmascarar 4xx/5xx como CORS).
    rp = {
        'gatewayresponse.header.Access-Control-Allow-Origin': "'%s'" % CORS_ORIGIN,
        'gatewayresponse.header.Access-Control-Allow-Headers': "'Content-Type,Authorization,token'",
        'gatewayresponse.header.Access-Control-Allow-Methods': "'POST,OPTIONS'",
    }
    for rt in ('DEFAULT_4XX', 'DEFAULT_5XX'):
        gw.put_gateway_response(restApiId=api_id, responseType=rt, responseParameters=rp)
        print(f"  CORS en {rt}")

    gw.create_deployment(restApiId=api_id, stageName=STAGE,
                         description='sync_api: rutas + template + CORS')
    print(f"✅ Desplegado al stage '{STAGE}'.")


def main():
    prefix, routes = load_catalog()
    if PLAN:
        print_plan(prefix, routes)
        return
    apply(prefix, routes)


if __name__ == '__main__':
    main()
