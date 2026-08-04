"""
El CD reconcilia memoria/timeout de las lambdas y el VisibilityTimeout de sus colas.

⚠️ Por qué esto tiene prueba: el workflow SOLO se ejecuta de verdad al hacer push a `main`.
Un error de bash ahí no lo ve nadie hasta que el despliegue rompe producción — y el bloque
que se toca es el que decide con cuánto tiempo corre cada worker del pipeline.

Se extrae la función `reconcile_config` del YAML REAL (no una copia) y se ejecuta con un
`aws` de mentira que registra las llamadas. Así se comprueba el comportamiento, no el texto.
"""
import json
import os
import re
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest
import yaml

RAIZ = Path(__file__).resolve().parents[2]
WORKFLOW = RAIZ / '.github' / 'workflows' / 'deploy-lambdas.yml'
CONFIG_MAP = RAIZ / '04_Backend' / 'lambdas' / 'config-map.json'
TRIGGER_MAP = RAIZ / '04_Backend' / 'lambdas' / 'trigger-map.json'

pytestmark = pytest.mark.skipif(shutil.which('jq') is None,
                                reason='el workflow usa jq para leer los manifiestos')


def _paso_bash():
    doc = yaml.safe_load(WORKFLOW.read_text(encoding='utf-8'))
    for paso in doc['jobs']['deploy']['steps']:
        if 'reconcile_config' in (paso.get('run') or ''):
            return paso['run']
    raise AssertionError('no se encontró el paso que define reconcile_config')


def _funcion(nombre):
    """Extrae `nombre() { … }` del bash del workflow, contando llaves."""
    src = _paso_bash()
    i = src.index(nombre + '() {')
    prof, j = 0, i
    while j < len(src):
        if src[j] == '{':
            prof += 1
        elif src[j] == '}':
            prof -= 1
            if prof == 0:
                return src[i:j + 1]
        j += 1
    raise AssertionError('llaves desbalanceadas en ' + nombre)


def _correr(tmp_path, folder, mem_actual, to_actual, falla_update=False, envs_actuales=None):
    """Ejecuta reconcile_config con un `aws` simulado. Devuelve (stdout, llamadas, FN_TIMEOUT).

    `envs_actuales` = mapa de variables que la función YA tiene en AWS (lo que no se puede
    perder al mezclar). None simula una función sin variables.
    """
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir()
    log = tmp_path / 'llamadas.log'
    env_json = json.dumps(envs_actuales) if envs_actuales is not None else 'null'
    # ⚠️ El orden de los `case` importa: la consulta de envs también es un
    # `get-function-configuration`, así que se distingue por el --query.
    (bin_dir / 'aws').write_text(textwrap.dedent(f"""\
        #!/usr/bin/env bash
        echo "$@" >> {log}
        case "$*" in
          *Environment.Variables*) echo '{env_json}' ;;
          *get-function-configuration*) echo -e "{mem_actual}\\t{to_actual}" ;;
          *update-function-configuration*) {'echo "boom" 1>&2; exit 1' if falla_update else 'echo OK'} ;;
          *wait*) : ;;
        esac
        """))
    (bin_dir / 'aws').chmod(0o755)

    script = tmp_path / 'run.sh'
    script.write_text('#!/usr/bin/env bash\nset -euo pipefail\n'
                      + _funcion('reconcile_config') + '\n'
                      + f'reconcile_config "{folder}" "fn-{folder}"\n'
                      + 'echo "FN_TIMEOUT=$FN_TIMEOUT"\n')
    env = dict(os.environ,
               PATH=str(bin_dir) + os.pathsep + os.environ['PATH'],
               CONFIG_MAP=str(CONFIG_MAP), NEW_FN_TIMEOUT='60', NEW_FN_MEMORY='256')
    r = subprocess.run(['bash', str(script)], capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    llamadas = log.read_text() if log.exists() else ''
    fn_to = re.search(r'FN_TIMEOUT=(\d+)', r.stdout).group(1)
    return r.stdout, llamadas, fn_to


def test_corrige_una_lambda_desconfigurada(tmp_path):
    """El caso que motiva todo: Combination-EAP-PDF renderiza 100 PDFs con ReportLab y estaba
    en el default de 256 MB / 60 s."""
    out, llamadas, fn_to = _correr(tmp_path, 'Api_V1_Template_Combination-EAP-PDF', '256', '60')
    assert 'update-function-configuration' in llamadas
    assert '--memory-size 2048' in llamadas and '--timeout 600' in llamadas
    assert fn_to == '600', 'el timeout aplicado debe quedar disponible para derivar la cola'


def test_no_llama_a_aws_si_ya_esta_correcta(tmp_path):
    """Idempotencia: sin esto, CADA despliegue publicaría una versión nueva sin cambiar nada."""
    _, llamadas, _ = _correr(tmp_path, 'Api_V1_Template_Combination-EAP-PDF', '2048', '600')
    assert 'update-function-configuration' not in llamadas


def test_sin_entrada_no_toca_nada_pero_lee_el_timeout_real(tmp_path):
    """Las ~95 lambdas de API ligera no están en el manifiesto: no se tocan. Pero su timeout
    REAL sí se lee — si alguien lo subió a mano en la consola, la cola tiene que seguirlo."""
    _, llamadas, fn_to = _correr(tmp_path, 'Api_V1_Campaign_List', '256', '300')
    assert 'update-function-configuration' not in llamadas
    assert fn_to == '300', 'debe usarse el timeout REAL, no el default'


def test_un_fallo_al_ajustar_no_aborta_el_despliegue(tmp_path):
    """El código ya se subió y funciona; lo que queda es una configuración subóptima. Abortar
    dejaría el despliegue a medias por algo que no impide operar."""
    out, _, _ = _correr(tmp_path, 'Api_V1_Sms_Send-batch', '256', '60', falla_update=True)
    assert 'No se pudo ajustar' in out


# ── VisibilityTimeout derivado ─────────────────────────────────────────────
def _visibility(timeout_fn, declarado=360):
    """La regla que aplica el workflow: max(declarado, 6 × timeout), tope de SQS 43200."""
    return min(max(declarado, timeout_fn * 6), 43200)


def test_reconcile_config_se_llama_en_LAS_DOS_rutas():
    """⚠️ Guard de CABLEADO, no de comportamiento. Una función perfecta que nadie invoca no
    hace nada, y el fallo es invisible: el despliegue termina en verde y la lambda se queda
    con la configuración vieja. La ruta de ACTUALIZAR es la que corre en casi todos los
    despliegues; la de CREAR, la que deja bien a una lambda nueva desde el primer día.
    (Comprobado: al quitar la llamada de una de las dos, el resto de pruebas seguía en verde.)"""
    src = _paso_bash()
    llamadas = src.count('reconcile_config "$folder" "$fn"')
    assert llamadas == 2, ('reconcile_config debe llamarse en la ruta de crear Y en la de '
                           'actualizar; encontradas: {}'.format(llamadas))
    # Y antes de ensure_triggers en ambas: la cola deriva su VisibilityTimeout de FN_TIMEOUT,
    # que reconcile_config es quien deja puesto.
    for bloque in src.split('reconcile_config "$folder" "$fn"')[1:]:
        siguiente = bloque.strip().split('\n')[0].strip()
        assert siguiente.startswith('ensure_triggers'), \
            'reconcile_config debe correr justo ANTES de ensure_triggers, no después'


def test_la_regla_de_visibility_esta_en_el_workflow():
    """Guard del texto: si alguien quita la derivación, la cola vuelve a quedarse en 360 s
    mientras la lambda corre 600 → SQS re-entrega el lote a mitad de proceso."""
    src = _paso_bash()
    assert 'FN_TIMEOUT * 6' in src, 'se perdió la derivación 6× del VisibilityTimeout'
    assert '43200' in src, 'falta el tope de SQS (12 h)'


@pytest.mark.parametrize('folder,esperado', [
    ('Api_V1_Email_Prepare-batch-template', 1800),
    ('Api_V1_Email_Send-batch-template-EM', 720),
    ('Api_V1_Email_Send-batch-template-EAP', 1800),
    ('Api_V1_Template_Combination-EAP-PDF', 3600),
    ('Api_V1_Sms_Send-batch', 1080),
])
def test_cada_worker_deriva_su_visibility(folder, esperado):
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    assert _visibility(cfg[folder]['timeout']) == esperado


def test_todo_worker_con_cola_tiene_visibility_suficiente():
    """El invariante que importa, sobre los manifiestos REALES: ninguna cola del pipeline
    puede liberar su mensaje antes de que la función termine."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    triggers = json.loads(TRIGGER_MAP.read_text(encoding='utf-8'))
    for folder, t in triggers.items():
        if not isinstance(t, dict) or 'sqs' not in t:
            continue
        timeout = cfg.get(folder, {}).get('timeout', 60)
        vis = _visibility(timeout, t.get('visibilityTimeout', 360))
        assert vis >= timeout * 6, '{}: visibility {} < 6× timeout {}'.format(t['sqs'], vis, timeout)


# ── El manifiesto en sí ────────────────────────────────────────────────────
def test_el_manifiesto_solo_nombra_carpetas_que_existen():
    """Una entrada con el nombre mal escrito no falla: simplemente NO se aplica nunca, y la
    lambda se queda con el default sin que nadie lo note."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    carpetas = {p.name for p in (RAIZ / '04_Backend' / 'lambdas').iterdir() if p.is_dir()}
    huerfanas = [k for k in cfg if not k.startswith('_') and k not in carpetas]
    assert huerfanas == [], 'entradas sin carpeta: {}'.format(huerfanas)


def test_los_valores_estan_dentro_de_los_limites_de_lambda():
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    for k, v in cfg.items():
        if k.startswith('_'):
            continue
        assert 128 <= v['memory'] <= 10240, '{}: memoria fuera de rango'.format(k)
        assert 1 <= v['timeout'] <= 900, '{}: timeout fuera de rango (máx 900 s)'.format(k)


def test_las_lambdas_detras_de_api_gateway_no_pasan_de_29s():
    """API Gateway REST corta a los 29 s por defecto: más timeout ahí es facturar una lambda
    que sigue corriendo cuando el cliente ya recibió un 504."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    triggers = json.loads(TRIGGER_MAP.read_text(encoding='utf-8'))
    # Asíncronas (cola, cron, SNS o invocación directa): no las alcanza el límite de 29 s.
    asincronas = {k for k, v in triggers.items() if isinstance(v, dict)} | {
        'Api_V1_Cron_DeleteTables', 'Api_V1_SQS_DeleteTables', 'Api_V1_Cascade_Advance',
        'Api_V1_Email_ReceptionStatus', 'Api_V1_Messaging_ReceptionStatus',
        'Api_V1_Wsp_ReceptionStatus', 'Api_V1_Wallet_Wompi-webhook',
        'Authorizer', 'Authorizer2',
    }
    for k, v in cfg.items():
        if k.startswith('_') or k in asincronas:
            continue
        assert v['timeout'] <= 29, '{} está detrás de API Gateway y pide {} s'.format(k, v['timeout'])

# ── Variables de entorno de AJUSTE (llave "env") ───────────────────────────
def test_las_envs_se_MEZCLAN_nunca_reemplazan():
    """⚠️ El guard más importante de este archivo.

    `aws lambda update-function-configuration --environment` REEMPLAZA el mapa COMPLETO.
    Si el CD lo usara con solo las claves declaradas, cada despliegue **borraría** SECRET_KEY,
    las credenciales de los proveedores y todo lo demás — y terminaría en VERDE, con la lambda
    rota en la siguiente invocación. Tiene que leer el mapa actual y mezclar.
    """
    src = _paso_bash()
    assert 'Environment.Variables' in src, 'no lee las envs actuales antes de escribir'
    assert '$a * $b' in src, 'falta la mezcla (jq `*`) del mapa actual con el declarado'


def test_ninguna_env_del_manifiesto_parece_un_secreto():
    """`config-map.json` está EN GIT. La llave `env` es para ajustes de rendimiento; un
    secreto ahí queda en el historial para siempre, y rotarlo no lo borra."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    SOSPECHOSAS = ('SECRET', 'PASSWORD', 'PASSWD', 'TOKEN', 'CREDENTIAL', 'PRIVATE',
                   'API_KEY', 'APIKEY', 'AUTH_TOKEN', 'ACCESS_KEY')
    for lambda_, v in cfg.items():
        if lambda_.startswith('_'):
            continue
        for clave in (v.get('env') or {}):
            arriba = clave.upper()
            assert not any(s in arriba for s in SOSPECHOSAS), (
                '{}: la env "{}" parece un secreto y este archivo está en git'.format(lambda_, clave))


def test_las_envs_declaradas_son_texto():
    """La API de Lambda exige strings en el mapa de variables: un número desnudo en el JSON
    haría fallar el `update-function-configuration` con un error poco claro."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    for lambda_, v in cfg.items():
        if lambda_.startswith('_'):
            continue
        for clave, valor in (v.get('env') or {}).items():
            assert isinstance(valor, str), '{}.{} debe ser texto, no {}'.format(
                lambda_, clave, type(valor).__name__)


def test_el_fanout_de_PDF_esta_declarado_y_es_menor_que_el_default():
    """El punto 2 de PROVISION.md §11: bajar REGISTERS_FOR_EAP reparte los PDFs en más
    invocaciones que Lambda corre en paralelo. Con el default (100) van EN SERIE en una sola."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    env = cfg['Api_V1_Email_Prepare-batch-template'].get('env') or {}
    assert 'REGISTERS_FOR_EAP' in env, 'se perdió el fan-out del combinador de PDF'
    assert 0 < int(env['REGISTERS_FOR_EAP']) < 100, 'debe ser MENOR que el default de 100'

def test_la_mezcla_CONSERVA_las_variables_que_ya_tenia(tmp_path):
    """⚠️ El comportamiento, no el texto. Si el CD reemplazara el mapa, la lambda perdería
    SECRET_KEY en el próximo push y el despliegue terminaría en VERDE — el fallo aparecería
    después, en la primera invocación."""
    _, llamadas, _ = _correr(
        tmp_path, 'Api_V1_Email_Prepare-batch-template', '1024', '300',
        envs_actuales={'SECRET_KEY': 'no-me-borres', 'SES_CONFIGURATION_SET': 'default'})
    linea = [l for l in llamadas.split('\n') if 'update-function-configuration' in l]
    assert linea, 'no se llamó a update-function-configuration'
    enviado = linea[0]
    assert 'no-me-borres' in enviado, 'SE PERDIÓ SECRET_KEY al escribir las envs'
    assert 'SES_CONFIGURATION_SET' in enviado, 'se perdió una env que ya existía'
    assert 'REGISTERS_FOR_EAP' in enviado, 'no se aplicó la env declarada'


def test_si_la_env_declarada_ya_esta_puesta_no_se_reescribe(tmp_path):
    """Idempotencia también aquí: reescribir el mapa idéntico publica una versión nueva de la
    función en cada despliegue, sin cambiar nada."""
    cfg = json.loads(CONFIG_MAP.read_text(encoding='utf-8'))
    ya = dict(cfg['Api_V1_Email_Prepare-batch-template']['env'])
    ya['SECRET_KEY'] = 'x'
    _, llamadas, _ = _correr(tmp_path, 'Api_V1_Email_Prepare-batch-template', '1024', '300',
                             envs_actuales=ya)
    assert 'update-function-configuration' not in llamadas


def test_una_funcion_sin_variables_recibe_solo_las_declaradas(tmp_path):
    """Caso borde: la API devuelve `null` (no `{}`) cuando la función nunca tuvo variables."""
    _, llamadas, _ = _correr(tmp_path, 'Api_V1_Email_Prepare-batch-template', '1024', '300',
                             envs_actuales=None)
    assert 'REGISTERS_FOR_EAP' in llamadas

