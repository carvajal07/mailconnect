"""Cobertura de la BITÁCORA (`adminAudit`) en las acciones sensibles que antes NO se
registraban: seguridad de la cuenta, identidades de envío, lista negra, dinero,
programación de envíos y borrado de contenido/datos.

El criterio que fijan estas pruebas: una acción con consecuencia (de seguridad, legal,
de dinero o destructiva) tiene que dejar autor y fecha. Lo que NO se audita a propósito
—los workers del pipeline, los eventos de proveedor y los crons— se documenta al final
del archivo, para que quede claro que es una decisión y no un olvido.
"""
import os
import importlib.util
from pathlib import Path

os.environ.setdefault('AWS_DEFAULT_REGION', 'us-east-1')
os.environ.setdefault('AWS_ACCESS_KEY_ID', 'testing')
os.environ.setdefault('AWS_SECRET_ACCESS_KEY', 'testing')

import pytest  # noqa: E402
import boto3  # noqa: E402
from moto import mock_aws  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
DIR = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(folder, alias=None):
    p = DIR / folder / 'lambda_function.py'
    spec = importlib.util.spec_from_file_location('cov_' + (alias or folder), str(p))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _pk(name, pk):
    boto3.client('dynamodb', region_name='us-east-1').create_table(
        TableName=name, KeySchema=[{'AttributeName': pk, 'KeyType': 'HASH'}],
        AttributeDefinitions=[{'AttributeName': pk, 'AttributeType': 'S'}],
        BillingMode='PAY_PER_REQUEST')


def _ctx(**extra):
    auth = {'customerId': 'CU1', 'customer': 'Acme', 'nit': '900', 'user': 'ana@acme.co',
            'userId': 'U1', 'tenantRole': 'owner'}
    auth.update(extra)
    return {'requestContext': {'authorizer': auth}}


def _audit_rows(action=None):
    items = boto3.resource('dynamodb', region_name='us-east-1').Table('adminAudit').scan()['Items']
    return [i for i in items if action is None or i.get('action') == action]


# ── Lista negra: cumplimiento (Ley 1581) ─────────────────────────────────────

def test_quitar_de_lista_negra_queda_auditado():
    """Sacar a alguien de la lista negra vuelve a habilitar el envío a un contacto que
    rebotó o se quejó: es la acción de esta familia con consecuencia legal."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('customer', 'customerId')
        _pk('900_blackList', 'email')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})
        res.Table('900_blackList').put_item(Item={'email': 'malo@x.com'})

        mod = _load('Api_V1_Blacklist_Delete')
        out = mod.lambda_handler({**_ctx(), 'email': 'malo@x.com'}, None)
        assert out['statusCode'] == 200

        rows = _audit_rows('blacklist.delete')
        assert len(rows) == 1
        assert rows[0]['target'] == 'malo@x.com'
        assert rows[0]['actor'] == 'ana@acme.co'


def test_agregar_a_lista_negra_queda_auditado():
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('customer', 'customerId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('customer').put_item(Item={'customerId': 'CU1', 'company': 'Acme', 'companyTin': '900'})

        mod = _load('Api_V1_Blacklist_Add')
        out = mod.lambda_handler({**_ctx(), 'email': 'malo@x.com', 'reason': 'pidió no recibir'}, None)
        assert out['statusCode'] == 201
        rows = _audit_rows('blacklist.add')
        assert len(rows) == 1 and 'pidió no recibir' in rows[0]['detail']


# ── Identidades de envío ─────────────────────────────────────────────────────

def test_eliminar_dominio_queda_auditado():
    """Borrar una identidad verificada deja a la empresa sin poder enviar desde ella."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('senderDomain', 'domainId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('senderDomain').put_item(Item={
            'domainId': 'D1', 'customerId': 'CU1', 'domain': 'acme.com',
            'kind': 'domain', 'status': 'verified'})

        mod = _load('Api_V1_Domain_Delete')
        out = mod.lambda_handler({**_ctx(), 'domainId': 'D1'}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('domain.delete')
        assert len(rows) == 1
        assert rows[0]['target'] == 'acme.com'
        assert 'verified' in rows[0]['detail']


def test_agregar_dominio_queda_auditado():
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('senderDomain', 'domainId')
        boto3.client('ses', region_name='us-east-1')

        mod = _load('Api_V1_Domain_Add')
        out = mod.lambda_handler({**_ctx(), 'identity': 'acme.com'}, None)
        assert out['statusCode'] == 201
        assert len(_audit_rows('domain.add')) == 1


def test_operator_rechazado_no_deja_rastro_de_alta():
    """El gate RBAC corre ANTES: un intento denegado no debe verse como un alta hecha."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('senderDomain', 'domainId')
        mod = _load('Api_V1_Domain_Add')
        out = mod.lambda_handler({**_ctx(tenantRole='operator'), 'identity': 'acme.com'}, None)
        assert out['statusCode'] == 403
        assert _audit_rows('domain.add') == []


# ── Seguridad de la cuenta ───────────────────────────────────────────────────

def test_desactivar_2fa_queda_auditado():
    """Desactivar el segundo factor es justo lo que hace quien tomó una sesión ajena."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('user', 'userId')
        res = boto3.resource('dynamodb', region_name='us-east-1')

        mod = _load('Api_V1_Security_Totp')
        # Enrolamiento + activación con un código REAL para llegar a un 2FA activo.
        res.Table('user').put_item(Item={'userId': 'U1', 'email': 'ana@acme.co'})
        ev = {**_ctx(), 'action': 'enroll'}
        secret = mod.lambda_handler(ev, None)['data']['secret']
        code = mod.totp_now(secret) if hasattr(mod, 'totp_now') else None
        if code is None:
            import base64
            import hmac
            import hashlib
            import struct
            import time as _t
            key = base64.b32decode(secret, casefold=True)
            counter = int(_t.time()) // 30
            digest = hmac.new(key, struct.pack('>Q', counter), hashlib.sha1).digest()
            off = digest[-1] & 0x0F
            code = str((struct.unpack('>I', digest[off:off + 4])[0] & 0x7FFFFFFF) % 1000000).zfill(6)
        assert mod.lambda_handler({**_ctx(), 'action': 'activate', 'code': code}, None)['statusCode'] == 200
        assert len(_audit_rows('security.2fa.enable')) == 1

        out = mod.lambda_handler({**_ctx(), 'action': 'disable', 'code': code}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('security.2fa.disable')
        assert len(rows) == 1 and rows[0]['actor'] == 'ana@acme.co'


def test_logout_cierra_el_par_con_login():
    """Sin `security.logout` la bitácora muestra ingresos sin salidas."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('session', 'sessionId')
        _pk('user', 'userId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('user').put_item(Item={'userId': 'U1', 'email': 'ana@acme.co'})
        res.Table('session').put_item(Item={'sessionId': 'S1', 'userId': 'U1', 'active': True})

        mod = _load('Api_V1_Security_Logout')
        out = mod.lambda_handler({**_ctx(), 'user': 'ana@acme.co'}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('security.logout')
        assert len(rows) == 1 and '1 sesión' in rows[0]['detail']


# ── Dinero ───────────────────────────────────────────────────────────────────

def test_solicitud_de_recarga_queda_auditada():
    """La aprobación ya se auditaba; sin la solicitud, en la bitácora aparecía una
    recarga aprobada sin origen."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('walletTransaction', 'txId')

        mod = _load('Api_V1_Balance_Topup-manual-request')
        out = mod.lambda_handler({**_ctx(), 'amount': 150000,
                                  'proofS3Path': 'document/2026/comprobante.pdf'}, None)
        assert out['statusCode'] == 201
        rows = _audit_rows('balance.topup.request')
        assert len(rows) == 1 and '150.000' in rows[0]['detail']


# ── Programación de envíos ───────────────────────────────────────────────────

def test_cancelar_programacion_queda_auditada():
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('scheduledSend', 'scheduleId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('scheduledSend').put_item(Item={
            'scheduleId': 'S1', 'customerId': 'CU1', 'campaignName': 'Julio',
            'status': 'pending', 'scheduledAt': '2026-12-01T10:00:00Z'})

        mod = _load('Api_V1_Schedule_Cancel')
        out = mod.lambda_handler({**_ctx(), 'scheduleId': 'S1'}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('schedule.cancel')
        assert len(rows) == 1 and 'Julio' in rows[0]['detail']


# ── Contenido y datos personales ─────────────────────────────────────────────

def test_eliminar_base_queda_auditado():
    """La base es el CSV de contactos: su borrado es borrado de datos personales."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('databaseFile', 'databaseFileId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('databaseFile').put_item(Item={
            'databaseFileId': 'B1', 'customerId': 'CU1', 'fileName': 'clientes.csv',
            's3Path': 'database/clientes.csv', 'totalRecords': 5000})

        mod = _load('Api_V1_Database_Delete')
        out = mod.lambda_handler({**_ctx(), 'databaseFileId': 'B1'}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('database.delete')
        assert len(rows) == 1
        assert rows[0]['target'] == 'clientes.csv' and '5000' in rows[0]['detail']


def test_eliminar_plantilla_de_mensaje_queda_auditado():
    """Simetría con messageTemplate.create, que ya se auditaba. Importa más desde que
    SMS/WSP resuelven la plantilla EN VIVO: borrarla cambia lo que se envía."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('messageTemplate', 'messageTemplateId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('messageTemplate').put_item(Item={
            'messageTemplateId': 'T1', 'customerId': 'CU1', 'name': 'Bienvenida', 'channel': 'SMS'})

        mod = _load('Api_V1_MessageTemplate_Delete')
        out = mod.lambda_handler({**_ctx(), 'messageTemplateId': 'T1'}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('messageTemplate.delete')
        assert len(rows) == 1 and rows[0]['target'] == 'Bienvenida'


def test_editar_campana_queda_auditado():
    """Crear/borrar/aprobar/rechazar ya se auditaban; EDITAR (que puede cambiar la base,
    la plantilla o el remitente antes del envío) no."""
    with mock_aws():
        _pk('adminAudit', 'auditId')
        _pk('campaign', 'campaignId')
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('campaign').put_item(Item={
            'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Julio',
            'campaignState': 'Pendiente'})

        mod = _load('Api_V1_Campaign_Update')
        out = mod.lambda_handler({**_ctx(), 'campaignId': 'C1', 'campaignName': 'Agosto',
                                  'dataPath': 'database/otra.csv'}, None)
        assert out['statusCode'] == 200
        rows = _audit_rows('campaign.update')
        assert len(rows) == 1
        assert 'campaignName' in rows[0]['detail'] and 'dataPath' in rows[0]['detail']


# ── La auditoría NUNCA rompe la operación ────────────────────────────────────

def test_sin_tabla_adminaudit_la_operacion_sigue():
    """El helper `_audit` es best-effort a propósito: si la bitácora no está disponible,
    la operación del cliente NO puede fallar por eso."""
    with mock_aws():
        _pk('databaseFile', 'databaseFileId')       # sin crear adminAudit
        res = boto3.resource('dynamodb', region_name='us-east-1')
        res.Table('databaseFile').put_item(Item={
            'databaseFileId': 'B1', 'customerId': 'CU1', 'fileName': 'x.csv'})

        mod = _load('Api_V1_Database_Delete')
        out = mod.lambda_handler({**_ctx(), 'databaseFileId': 'B1'}, None)
        assert out['statusCode'] == 200


# ── Guard del inventario: qué se audita y qué NO ─────────────────────────────

# Lambdas que MUTAN estado pero NO deben escribir en adminAudit, con el porqué. Si
# alguna empieza a auditar (o alguien agrega una lambda nueva a esta lista sin pensar),
# esta prueba lo hace visible en vez de dejarlo pasar en silencio.
SIN_AUDITORIA = {
    # Workers del pipeline: un evento POR DESTINATARIO inundaría la bitácora; su
    # trazabilidad ya vive en {tenant}_sendStatus y en el registro del proceso.
    'Api_V1_Email_Send-batch-template-EM': 'worker del pipeline',
    'Api_V1_Email_Send-batch-template-EAU': 'worker del pipeline',
    'Api_V1_Email_Send-batch-template-EAP': 'worker del pipeline',
    'Api_V1_Sms_Send-batch': 'worker del pipeline',
    'Api_V1_Wsp_Send-batch': 'worker del pipeline',
    'Api_V1_Voice_Send-batch': 'worker del pipeline',
    'Api_V1_Template_Combination': 'worker del pipeline',
    'Api_V1_Template_Combination-EAP-PDF': 'worker del pipeline',
    # Eventos de PROVEEDOR (SES/EUM/Meta), no acciones de una persona.
    'Api_V1_Email_ReceptionStatus': 'evento de proveedor',
    'Api_V1_Messaging_ReceptionStatus': 'evento de proveedor',
    'Api_V1_Wsp_ReceptionStatus': 'evento de proveedor',
    # Automatismos (cron / target): la DECISIÓN humana ya se audita aguas arriba
    # (schedule.create, cascade.dispatch); el disparo en sí no tiene autor.
    'Api_V1_Schedule_Fire': 'automatismo',
    'Api_V1_Schedule_Dispatch': 'automatismo',
    'Api_V1_Cascade_Advance': 'automatismo',
    'Api_V1_Notifications_Scan': 'automatismo',
    'Api_V1_SQS_DeleteTables': 'automatismo de retención',
    # Acciones del SUSCRIPTOR (no del cliente): alto volumen y con registro legal
    # propio en {tenant}_unsubscribe / _preferences.
    'Api_V1_Email_Unsubscribe': 'acción del suscriptor',
    'Api_V1_Email_Preferences': 'acción del suscriptor',
}


def test_inventario_de_lambdas_sin_auditoria_es_deliberado():
    faltantes = [f for f in SIN_AUDITORIA if not (DIR / f / 'lambda_function.py').exists()]
    assert not faltantes, 'Lambdas del inventario que ya no existen: {}'.format(faltantes)
    for folder in SIN_AUDITORIA:
        src = (DIR / folder / 'lambda_function.py').read_text()
        assert 'adminAudit' not in src, (
            '{} empezó a auditar: si es a propósito, quítala de SIN_AUDITORIA '
            '(y verifica que no genere una entrada por destinatario).'.format(folder))


@pytest.mark.parametrize('folder,action', [
    ('Api_V1_Security_Totp', 'security.2fa.enable'),
    ('Api_V1_Security_Totp', 'security.2fa.disable'),
    ('Api_V1_Security_Change-password', 'security.password'),
    ('Api_V1_Security_Register', 'security.register'),
    ('Api_V1_Security_Recovery-password', 'security.recovery'),
    ('Api_V1_Security_Logout', 'security.logout'),
    ('Api_V1_Security_Acount-activation', 'security.activation'),
    ('Api_V1_Domain_Add', 'domain.add'),
    ('Api_V1_Domain_Delete', 'domain.delete'),
    ('Api_V1_Blacklist_Add', 'blacklist.add'),
    ('Api_V1_Blacklist_Delete', 'blacklist.delete'),
    ('Api_V1_Wallet_Wompi-webhook', 'balance.topup.wompi'),
    ('Api_V1_Balance_Topup-init', 'balance.topup.init'),
    ('Api_V1_Balance_Topup-manual-request', 'balance.topup.request'),
    ('Api_V1_Schedule_Create', 'schedule.create'),
    ('Api_V1_Schedule_Cancel', 'schedule.cancel'),
    ('Api_V1_Cascade_Dispatch', 'cascade.dispatch'),
    ('Api_V1_Campaign_Update', 'campaign.update'),
    ('Api_V1_MessageTemplate_Delete', 'messageTemplate.delete'),
    ('Api_V1_Template_Delete-template', 'template.delete'),
    ('Api_V1_Admin_Templates', 'template.admin-delete'),
    ('Api_V1_Database_Register-file', 'database.register'),
    ('Api_V1_Database_Delete', 'database.delete'),
    ('Api_V1_Notifications_Prefs', 'notifications.prefs'),
])
def test_cada_accion_sensible_emite_su_evento(folder, action):
    """Guard barato contra regresiones al refactorizar: la acción sigue emitiéndose."""
    src = (DIR / folder / 'lambda_function.py').read_text()
    assert "'{}'".format(action) in src, '{} dejó de emitir {}'.format(folder, action)
