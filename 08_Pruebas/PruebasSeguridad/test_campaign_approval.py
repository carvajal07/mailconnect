"""
Pruebas del flujo de APROBACIÓN de campañas (maker-checker):
  - Api_V1_Campaign_Request-approval
  - Api_V1_Campaign_Approve
  - Api_V1_Campaign_Reject
Ver PLAN_APROBACIONES.md.
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
LAMBDAS = REPO_ROOT / '04_Backend' / 'lambdas'


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def env():
    with mock_aws():
        ddb = boto3.client('dynamodb', region_name='us-east-1')
        ddb.create_table(
            TableName='campaign',
            KeySchema=[{'AttributeName': 'campaignId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'campaignId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        ddb.create_table(
            TableName='adminAudit',
            KeySchema=[{'AttributeName': 'auditId', 'KeyType': 'HASH'}],
            AttributeDefinitions=[{'AttributeName': 'auditId', 'AttributeType': 'S'}],
            BillingMode='PAY_PER_REQUEST')
        t = boto3.resource('dynamodb', region_name='us-east-1').Table('campaign')
        # C1: con muestras enviadas (samplesSentCount=2), lista para solicitar aprobación.
        t.put_item(Item={'campaignId': 'C1', 'customerId': 'CU1', 'campaignName': 'Promo',
                         'channel': 'EM', 'campaignState': 'Muestras', 'samplesSentCount': 2,
                         'approvalStatus': 'none'})
        # C2: sin muestras.
        t.put_item(Item={'campaignId': 'C2', 'customerId': 'CU1', 'campaignName': 'SinMuestras',
                         'channel': 'EM', 'campaignState': 'Pendiente', 'samplesSentCount': 0,
                         'approvalStatus': 'none'})
        req = _load('req_mod', LAMBDAS / 'Api_V1_Campaign_Request-approval' / 'lambda_function.py')
        apr = _load('apr_mod', LAMBDAS / 'Api_V1_Campaign_Approve' / 'lambda_function.py')
        rej = _load('rej_mod', LAMBDAS / 'Api_V1_Campaign_Reject' / 'lambda_function.py')
        yield req, apr, rej, t


def _auth(body, cid='CU1', user='ana@x.com', uid='U1', trole='owner'):
    # El usuario por defecto de estas pruebas es el OWNER de la empresa (puede aprobar/rechazar).
    # El mapping template reenvía tenantRole al lambda; aquí se simula ese context. Pasar
    # trole=None simula que tenantRole NO llega (mapping viejo) → el gate hace fail-CLOSED.
    authz = {'customerId': cid, 'user': user, 'userId': uid}
    if trole is not None:
        authz['tenantRole'] = trole
    return {**body, 'requestContext': {'authorizer': authz}}


# --- Request-approval ---------------------------------------------------------

def test_request_ok(env):
    req, _, _, t = env
    resp = req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    assert resp['statusCode'] == 200
    item = t.get_item(Key={'campaignId': 'C1'})['Item']
    assert item['approvalStatus'] == 'pending'
    assert item['approvalRequestedBy'] == 'U1'


def test_request_sin_muestras_400(env):
    req, _, _, _ = env
    resp = req.lambda_handler(_auth({'campaignId': 'C2'}), None)
    assert resp['statusCode'] == 400


def test_request_otro_cliente_403(env):
    req, _, _, _ = env
    resp = req.lambda_handler(_auth({'campaignId': 'C1'}, cid='CU2'), None)
    assert resp['statusCode'] == 403


def test_request_no_existe_404(env):
    req, _, _, _ = env
    resp = req.lambda_handler(_auth({'campaignId': 'NADA'}), None)
    assert resp['statusCode'] == 404


def test_request_idempotente(env):
    req, _, _, _ = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    assert resp['statusCode'] == 200  # ya estaba pending, no rompe


# --- Approve ------------------------------------------------------------------

def test_approve_ok(env):
    req, apr, _, t = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = apr.lambda_handler(_auth({'campaignId': 'C1'}, user='jefe@x.com', uid='U2'), None)
    assert resp['statusCode'] == 200
    item = t.get_item(Key={'campaignId': 'C1'})['Item']
    assert item['approvalStatus'] == 'approved'
    assert item['approvalReviewedBy'] == 'U2'


def test_approve_sin_solicitar_409(env):
    _, apr, _, _ = env
    resp = apr.lambda_handler(_auth({'campaignId': 'C1'}), None)  # sigue en 'none'
    assert resp['statusCode'] == 409


def test_approve_otro_cliente_403(env):
    req, apr, _, _ = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = apr.lambda_handler(_auth({'campaignId': 'C1'}, cid='CU2'), None)
    assert resp['statusCode'] == 403


def test_approve_operator_403(env):
    """RBAC: un operator (funcional) NO puede aprobar."""
    req, apr, _, _ = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = apr.lambda_handler(_auth({'campaignId': 'C1'}, trole='operator'), None)
    assert resp['statusCode'] == 403


def test_approve_approver_ok(env):
    """RBAC: un approver SÍ puede aprobar."""
    req, apr, _, t = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = apr.lambda_handler(_auth({'campaignId': 'C1'}, trole='approver'), None)
    assert resp['statusCode'] == 200
    assert t.get_item(Key={'campaignId': 'C1'})['Item']['approvalStatus'] == 'approved'


def test_approve_sin_tenantrole_403_failclosed(env):
    """Fail-CLOSED: si el context NO trae tenantRole (mapping template viejo/mal configurado), el
    gate NIEGA (default al menor privilegio) en vez de tratar al usuario como owner. Cierra el
    bypass en el que cualquier usuario era tratado como owner cuando tenantRole no llegaba."""
    req, apr, _, t = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = apr.lambda_handler(_auth({'campaignId': 'C1'}, trole=None), None)
    assert resp['statusCode'] == 403
    # La campaña sigue pendiente (no se aprobó).
    assert t.get_item(Key={'campaignId': 'C1'})['Item']['approvalStatus'] == 'pending'


def test_reject_operator_403(env):
    """RBAC: un operator NO puede rechazar."""
    req, _, rej, _ = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = rej.lambda_handler(_auth({'campaignId': 'C1', 'reason': 'x'}, trole='operator'), None)
    assert resp['statusCode'] == 403


def test_request_approval_operator_ok(env):
    """RBAC: el operator SÍ puede solicitar aprobación (es su función)."""
    req, _, _, _ = env
    resp = req.lambda_handler(_auth({'campaignId': 'C1'}, trole='operator'), None)
    assert resp['statusCode'] == 200


# --- Reject -------------------------------------------------------------------

def test_reject_ok(env):
    req, _, rej, t = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = rej.lambda_handler(_auth({'campaignId': 'C1', 'reason': 'Falta logo'}, uid='U2'), None)
    assert resp['statusCode'] == 200
    item = t.get_item(Key={'campaignId': 'C1'})['Item']
    assert item['approvalStatus'] == 'rejected'
    assert item['approvalRejectReason'] == 'Falta logo'


def test_reject_sin_motivo_400(env):
    req, _, rej, _ = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    resp = rej.lambda_handler(_auth({'campaignId': 'C1', 'reason': '  '}), None)
    assert resp['statusCode'] == 400


def test_reject_sin_solicitar_409(env):
    _, _, rej, _ = env
    resp = rej.lambda_handler(_auth({'campaignId': 'C1', 'reason': 'x'}), None)
    assert resp['statusCode'] == 409


def test_request_after_reject_vuelve_a_pending(env):
    req, _, rej, t = env
    req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    rej.lambda_handler(_auth({'campaignId': 'C1', 'reason': 'corrige'}), None)
    # El funcional corrige y vuelve a solicitar: rejected → pending, limpia el motivo.
    resp = req.lambda_handler(_auth({'campaignId': 'C1'}), None)
    assert resp['statusCode'] == 200
    item = t.get_item(Key={'campaignId': 'C1'})['Item']
    assert item['approvalStatus'] == 'pending'
    assert 'approvalRejectReason' not in item
