"""
Guard del mapping template no-proxy (scripts/sync_api.py CONTEXT_TEMPLATE).

Debe reenviar TODOS los claims del context del Authorizer que las lambdas usan para
autorizar. En particular **tenantRole**: sin él, los gates RBAC de sub-rol
(Campaign_Approve/Reject, Schedule_Create, envío real en Prepare-batch) veían el campo
ausente y —por su default previo 'owner'— trataban a CUALQUIER usuario como owner
(bypass del maker-checker: un operator podía aprobar/rechazar/enviar). Este test evita
esa regresión (que alguien quite un claim del template).
"""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SYNC_API = REPO_ROOT / 'scripts' / 'sync_api.py'

# Claims que las lambdas leen de event.requestContext.authorizer.* (aislamiento multi-tenant,
# gating admin por role, y RBAC de sub-rol por tenantRole).
REQUIRED_CLAIMS = ('role', 'user', 'userId', 'customerId', 'customer', 'nit', 'tenantRole')


def test_context_template_reenvia_todos_los_claims():
    src = SYNC_API.read_text(encoding='utf-8')
    for claim in REQUIRED_CLAIMS:
        assert '$context.authorizer.{}'.format(claim) in src, (
            'El mapping template (CONTEXT_TEMPLATE) no reenvía "{}" → las lambdas lo verían '
            'ausente en el context y su gate fallaría (403) o —peor— haría fail-open.'.format(claim))
