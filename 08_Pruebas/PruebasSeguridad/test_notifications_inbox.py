"""
Centro de notificaciones del portal: listado por USUARIO, marcado de leídas y los
disparadores del flujo de aprobación.

Lo que más importa aquí es el AISLAMIENTO: las notificaciones son por usuario, no por
empresa, y un usuario no debe ver (ni marcar) las de otro aunque conozca el id.
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


def _load(folder, alias):
    spec = importlib.util.spec_from_file_location(alias, str(DIR / folder / 'lambda_function.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _tabla(dynamodb, nombre, pk, gsi=None):
    kwargs = {
        'TableName': nombre,
        'KeySchema': [{'AttributeName': pk, 'KeyType': 'HASH'}],
        'AttributeDefinitions': [{'AttributeName': pk, 'AttributeType': 'S'}],
        'BillingMode': 'PAY_PER_REQUEST',
    }
    if gsi:
        kwargs['AttributeDefinitions'] += [{'AttributeName': a, 'AttributeType': 'S'} for a in gsi['attrs']]
        kwargs['GlobalSecondaryIndexes'] = [{
            'IndexName': gsi['name'],
            'KeySchema': gsi['keys'],
            'Projection': {'ProjectionType': 'ALL'},
        }]
    dynamodb.create_table(**kwargs)


@pytest.fixture
def entorno():
    with mock_aws():
        dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
        _tabla(dynamodb, 'notification', 'notificationId', gsi={
            'name': 'userId-createdAt-index',
            'attrs': ['userId', 'createdAt'],
            'keys': [{'AttributeName': 'userId', 'KeyType': 'HASH'},
                     {'AttributeName': 'createdAt', 'KeyType': 'RANGE'}],
        })
        _tabla(dynamodb, 'campaign', 'campaignId')
        _tabla(dynamodb, 'user', 'userId')
        _tabla(dynamodb, 'adminAudit', 'auditId')
        yield dynamodb


def _ctx(body, user_id='U1', customer_id='CU1', tenant_role='owner', user='ana@acme.co'):
    return {**body, 'requestContext': {'authorizer': {
        'userId': user_id, 'customerId': customer_id,
        'tenantRole': tenant_role, 'user': user}}}


# ─────────────────────────── Listado y marcado ───────────────────────────

def test_lista_vacia_sin_notificaciones(entorno):
    lst = _load('Api_V1_Notifications_List', 'notif_list')
    resp = lst.lambda_handler(_ctx({}), None)
    assert resp['statusCode'] == 200
    assert resp['data'] == {'items': [], 'unread': 0}


def test_sin_identidad_403(entorno):
    lst = _load('Api_V1_Notifications_List', 'notif_list2')
    assert lst.lambda_handler({}, None)['statusCode'] == 403


def _sembrar(dynamodb, user_id, n=3, leidas=0):
    t = dynamodb.Table('notification')
    for i in range(n):
        t.put_item(Item={
            'notificationId': '{}-{}'.format(user_id, i),
            'userId': user_id, 'customerId': 'CU1', 'kind': 'campaign.approval',
            'title': 'Aviso {}'.format(i), 'body': 'cuerpo', 'level': 'info', 'link': '',
            'read': i < leidas, 'createdAt': '2026-07-2{}T10:00:00.000000'.format(i),
        })


def test_lista_del_usuario_reciente_primero_y_cuenta_no_leidas(entorno):
    _sembrar(entorno, 'U1', n=3, leidas=1)
    lst = _load('Api_V1_Notifications_List', 'notif_list3')
    data = lst.lambda_handler(_ctx({}), None)['data']
    assert len(data['items']) == 3
    assert data['unread'] == 2
    # Recientes primero.
    assert data['items'][0]['title'] == 'Aviso 2'


def test_no_ve_las_de_otro_usuario(entorno):
    _sembrar(entorno, 'U1', n=2)
    _sembrar(entorno, 'U2', n=5)
    lst = _load('Api_V1_Notifications_List', 'notif_list4')
    data = lst.lambda_handler(_ctx({}, user_id='U1'), None)['data']
    assert len(data['items']) == 2


def test_marcar_leida(entorno):
    _sembrar(entorno, 'U1', n=2)
    lst = _load('Api_V1_Notifications_List', 'notif_list5')
    resp = lst.lambda_handler(_ctx({'action': 'read', 'notificationId': 'U1-0'}), None)
    assert resp['statusCode'] == 200
    assert resp['data']['unread'] == 1


def test_no_puede_marcar_la_de_otro(entorno):
    """Sin la condición por dueño, cualquiera con un id podría marcar avisos ajenos."""
    _sembrar(entorno, 'U2', n=1)
    lst = _load('Api_V1_Notifications_List', 'notif_list6')
    resp = lst.lambda_handler(_ctx({'action': 'read', 'notificationId': 'U2-0'}, user_id='U1'), None)
    assert resp['statusCode'] == 404
    assert entorno.Table('notification').get_item(Key={'notificationId': 'U2-0'})['Item']['read'] is False


def test_marcar_todas(entorno):
    _sembrar(entorno, 'U1', n=4)
    lst = _load('Api_V1_Notifications_List', 'notif_list7')
    resp = lst.lambda_handler(_ctx({'action': 'read-all'}), None)
    assert resp['data']['unread'] == 0


# ─────────────────────────── Disparadores de aprobación ───────────────────────────

def _campana(dynamodb, estado='none', pedida_por='U9'):
    dynamodb.Table('campaign').put_item(Item={
        'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Julio',
        'channel': 'EM', 'samplesSentCount': 2, 'approvalStatus': estado,
        'approvalRequestedBy': pedida_por,
    })


def _equipo(dynamodb):
    """Owner + approver + operator, todos del mismo tenant."""
    t = dynamodb.Table('user')
    t.put_item(Item={'userId': 'U1', 'customerId': 'CU1', 'active': True, 'tenantRole': 'operator'})
    t.put_item(Item={'userId': 'U2', 'customerId': 'CU1', 'active': True, 'tenantRole': 'approver'})
    t.put_item(Item={'userId': 'U3', 'customerId': 'CU1', 'active': True, 'tenantRole': 'owner'})
    # De otra empresa: no debe recibir nada.
    t.put_item(Item={'userId': 'X9', 'customerId': 'CU2', 'active': True, 'tenantRole': 'owner'})


def _notis(dynamodb, user_id):
    return [i for i in dynamodb.Table('notification').scan().get('Items', [])
            if i['userId'] == user_id]


def test_solicitar_aprobacion_avisa_solo_a_quien_puede_aprobar(entorno):
    _campana(entorno)
    _equipo(entorno)
    req = _load('Api_V1_Campaign_Request-approval', 'req_approval')
    resp = req.lambda_handler(_ctx({'campaignId': 'C1'}, user_id='U1', tenant_role='operator'), None)
    assert resp['statusCode'] == 200

    # Approver y owner sí; el operator que la pidió NO (ya sabe que la pidió).
    assert len(_notis(entorno, 'U2')) == 1
    assert len(_notis(entorno, 'U3')) == 1
    assert _notis(entorno, 'U1') == []
    # Y nadie de otro tenant.
    assert _notis(entorno, 'X9') == []

    aviso = _notis(entorno, 'U2')[0]
    assert aviso['kind'] == 'campaign.approval'
    assert aviso['link'] == 'aprobaciones'
    assert 'Julio' in aviso['body']


def test_aprobar_avisa_a_quien_la_solicito(entorno):
    _campana(entorno, estado='pending', pedida_por='U1')
    _equipo(entorno)
    apr = _load('Api_V1_Campaign_Approve', 'approve')
    resp = apr.lambda_handler(_ctx({'campaignId': 'C1'}, user_id='U3', tenant_role='owner'), None)
    assert resp['statusCode'] == 200
    avisos = _notis(entorno, 'U1')
    assert len(avisos) == 1
    assert avisos[0]['kind'] == 'campaign.approved'
    assert avisos[0]['level'] == 'success'


def test_rechazar_avisa_con_el_motivo(entorno):
    _campana(entorno, estado='pending', pedida_por='U1')
    _equipo(entorno)
    rej = _load('Api_V1_Campaign_Reject', 'reject')
    resp = rej.lambda_handler(
        _ctx({'campaignId': 'C1', 'reason': 'Falta el descargo legal'},
             user_id='U3', tenant_role='owner'), None)
    assert resp['statusCode'] == 200
    avisos = _notis(entorno, 'U1')
    assert len(avisos) == 1
    assert avisos[0]['level'] == 'error'
    # El motivo va DENTRO del aviso: si no, el rechazo se siente arbitrario.
    assert 'Falta el descargo legal' in avisos[0]['body']


def test_sin_tabla_de_notificaciones_la_operacion_sigue(entorno):
    """Best-effort: notificar nunca debe tumbar la acción del cliente."""
    entorno.Table('notification').delete()
    _campana(entorno)
    _equipo(entorno)
    req = _load('Api_V1_Campaign_Request-approval', 'req_approval2')
    resp = req.lambda_handler(_ctx({'campaignId': 'C1'}, user_id='U1', tenant_role='operator'), None)
    assert resp['statusCode'] == 200
