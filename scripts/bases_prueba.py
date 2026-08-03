#!/usr/bin/env python3
"""
Generador de BASES DE PRUEBA para ejercitar el flujo de envío de punta a punta.

    python3 scripts/bases_prueba.py                 # genera el juego completo
    python3 scripts/bases_prueba.py --filas 50000   # una base grande a la medida
    python3 scripts/bases_prueba.py --salida /tmp   # en otra carpeta

Formato: el del modelo interno (`FORMATO_BASES.md` §2) — CSV UTF-8 con encabezado,
delimitador `;` y las 3 columnas obligatorias EN ORDEN (identificación · contacto ·
nombre). Las columnas extra quedan disponibles como `{{variables}}` en las plantillas.

═══════════════════════════════════════════════════════════════════════════════
CORREO — simulador de buzones de SES
═══════════════════════════════════════════════════════════════════════════════
SES expone buzones de prueba en `@simulator.amazonses.com` que devuelven un resultado
FIJO sin tocar un destinatario real y **sin afectar tus métricas de reputación** (rebotes
y quejas) — que es justo lo que hace seguro probar un rebote o una queja a propósito.
Funcionan también en sandbox y NO hay que verificarlos como identidad.

⚠️ **Las etiquetas (`success+0001@…`) son obligatorias aquí, no un adorno.** Prepare-batch
DEDUPLICA por contacto salvo que la base venga marcada "Permitir duplicados": sin etiqueta,
una base de 10.000 filas con el mismo buzón se cobraría y enviaría como **1** destinatario y
la prueba de volumen no probaría nada.

═══════════════════════════════════════════════════════════════════════════════
SMS — simulador de AWS End User Messaging
═══════════════════════════════════════════════════════════════════════════════
Existe un simulador equivalente, pero funciona distinto y hay que montarlo antes:

  1. En la consola de **AWS End User Messaging SMS → Phone numbers → Request originator**
     se pide un *simulator phone number* (gratis).
  2. Los envíos se hacen DESDE ese número simulador HACIA unos números de destino fijos.
     Solo esa combinación es simulada.

⚠️ **Verifica los números de destino en la consola antes de cargarlos.** Los que trae este
script (`--sms-ok` / `--sms-fallo`) son los que documenta AWS, pero un dígito equivocado no
falla: **sale como SMS real, a una persona real, y se cobra**. Es el único dato de este
script que no se puede validar desde el repo.

⚠️ Para SMS **no hay etiquetas** como en el correo: todas las filas llevan el mismo número.
Sube esas bases con **"Permitir duplicados" marcado**, o el envío se reducirá a 1 destino.
"""
import argparse
import csv
import random
from pathlib import Path

# ── Correo: los 5 buzones del simulador de SES ─────────────────────────────
SIM = 'simulator.amazonses.com'
BUZONES = {
    'success': 'entrega correcta',
    'bounce': 'rebote duro (entra a la lista negra por ReceptionStatus)',
    'complaint': 'queja / marcado como spam',
    'ooto': 'respuesta automática de ausencia',
    'suppressionlist': 'rechazado por la lista de supresión de la cuenta',
}

# Mezcla realista: la inmensa mayoría entrega bien. Se dejan rebotes y quejas suficientes
# para VER el efecto en los reportes y en la lista negra, sin que dominen la muestra.
MEZCLA = (['success'] * 88) + (['bounce'] * 5) + (['complaint'] * 2) + (['ooto'] * 3) + (['suppressionlist'] * 2)

# Números del simulador de End User Messaging. VERIFICAR EN LA CONSOLA (ver cabecera).
SMS_OK = '+14254147755'
SMS_FALLO = '+14254147167'

NOMBRES = ['Ana', 'Carlos', 'Beatriz', 'Diego', 'Elena', 'Felipe', 'Gabriela', 'Hugo',
           'Isabel', 'Javier', 'Karina', 'Luis', 'Marta', 'Nicolás', 'Olga', 'Pablo',
           'Quintín', 'Rosa', 'Santiago', 'Tatiana', 'Úrsula', 'Víctor', 'Ximena', 'Yolanda']
APELLIDOS = ['Gómez', 'Rodríguez', 'Martínez', 'Ramírez', 'López', 'Díaz', 'Torres',
             'Vargas', 'Castro', 'Moreno', 'Rojas', 'Herrera', 'Jiménez', 'Ruiz']
CIUDADES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga',
            'Pereira', 'Manizales', 'Santa Marta', 'Cúcuta']
PLANES = ['Básico', 'Plus', 'Premium', 'Corporativo']

# Columnas extra = las variables que se pueden usar en la plantilla. Se incluyen a
# propósito varios TIPOS (texto, número con decimales, fecha) para ver cómo se renderizan.
ENCABEZADO = ['Identificacion', 'Correo', 'Nombre', 'Ciudad', 'Plan', 'Saldo', 'Vence']
ENCABEZADO_SMS = ['Identificacion', 'Celular', 'Nombre', 'Ciudad', 'Plan', 'Saldo', 'Vence']


def _persona(rnd, i):
    """Datos de relleno DETERMINISTAS (semilla fija): dos corridas del script producen el
    mismo archivo, así una prueba se puede repetir tal cual."""
    nombre = '{} {}'.format(rnd.choice(NOMBRES), rnd.choice(APELLIDOS))
    return [
        str(1000000000 + i),                       # Identificación (10 dígitos, como una cédula)
        None,                                      # el contacto lo pone quien llama
        nombre,
        rnd.choice(CIUDADES),
        rnd.choice(PLANES),
        '{:,.0f}'.format(rnd.randrange(15000, 4000000, 1000)).replace(',', '.'),
        '{:02d}/{:02d}/2026'.format(rnd.randrange(1, 29), rnd.randrange(1, 13)),
    ]


def base_email(filas, semilla=42, solo=None):
    """Base de correo contra el simulador de SES. `solo` fuerza un único resultado
    (p. ej. 'bounce' para una base que rebota entera)."""
    rnd = random.Random(semilla)
    out = [ENCABEZADO]
    for i in range(1, filas + 1):
        buzon = solo or rnd.choice(MEZCLA)
        fila = _persona(rnd, i)
        # La ETIQUETA hace único el contacto (si no, la deduplicación colapsa la base).
        fila[1] = '{}+{:06d}@{}'.format(buzon, i, SIM)
        out.append(fila)
    return out


def base_email_sucia(filas, semilla=7):
    """Base con basura DELIBERADA para el botón "Verificar higiene" y para ver qué
    descarta Prepare-batch: sintaxis rota, duplicados exactos, dominios desechables,
    cuentas de rol y celdas vacías. Ninguna de estas sale a la red."""
    rnd = random.Random(semilla)
    out = [ENCABEZADO]
    defectuosas = [
        ('sin-arroba.com', 'correo sin @'),
        ('dos@@arrobas.com', 'doble @'),
        ('espacio en@medio.com', 'espacio en el nombre'),
        ('sin-dominio@', 'sin dominio'),
        ('@sin-usuario.com', 'sin usuario'),
        ('', 'celda vacía'),
        ('tirame@mailinator.com', 'dominio desechable'),
        ('temporal@10minutemail.com', 'dominio desechable'),
        ('info@empresa-ejemplo.com', 'cuenta de rol'),
        ('noreply@empresa-ejemplo.com', 'cuenta de rol'),
        ('nadie@dominio-que-no-existe-jamas-xyz.co', 'dominio que no resuelve'),
    ]
    for i in range(1, filas + 1):
        fila = _persona(rnd, i)
        if i <= len(defectuosas):
            fila[1] = defectuosas[i - 1][0]
        elif i <= len(defectuosas) + 6:            # duplicados EXACTOS del mismo contacto
            fila[1] = 'success+repetido@{}'.format(SIM)
        else:
            fila[1] = 'success+{:06d}@{}'.format(i, SIM)
        out.append(fila)
    return out


def base_sms(filas, numero, semilla=42):
    rnd = random.Random(semilla)
    out = [ENCABEZADO_SMS]
    for i in range(1, filas + 1):
        fila = _persona(rnd, i)
        fila[1] = numero
        out.append(fila)
    return out


def escribir(ruta, filas):
    with open(ruta, 'w', newline='', encoding='utf-8') as fh:
        # QUOTE_MINIMAL + `;`: el mismo dialecto que generan el portal y el conversor de
        # Excel/JSON, y el que `csv.reader` del backend lee sin configurar nada.
        csv.writer(fh, delimiter=';', quoting=csv.QUOTE_MINIMAL).writerows(filas)
    kb = ruta.stat().st_size / 1024
    print('  {:<34} {:>7} filas  {:>8.1f} KB'.format(ruta.name, len(filas) - 1, kb))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--salida', default='09_Herramientas/bases-prueba', help='carpeta destino')
    ap.add_argument('--filas', type=int, help='genera SOLO una base de correo de N filas')
    ap.add_argument('--sms-ok', default=SMS_OK, help='destino simulador de entrega correcta')
    ap.add_argument('--sms-fallo', default=SMS_FALLO, help='destino simulador de fallo')
    args = ap.parse_args()

    destino = Path(args.salida)
    destino.mkdir(parents=True, exist_ok=True)

    if args.filas:
        print('Base de correo a la medida:')
        escribir(destino / 'email-{}.csv'.format(args.filas), base_email(args.filas))
        return

    print('CORREO (simulador de SES · no afecta la reputación):')
    escribir(destino / 'email-01-humo-10.csv', base_email(10))
    escribir(destino / 'email-02-pocos-100.csv', base_email(100))
    escribir(destino / 'email-03-medio-1000.csv', base_email(1000))
    escribir(destino / 'email-04-muchos-10000.csv', base_email(10000))
    escribir(destino / 'email-05-todo-rebota-50.csv', base_email(50, solo='bounce'))
    escribir(destino / 'email-06-todo-queja-50.csv', base_email(50, solo='complaint'))
    escribir(destino / 'email-07-sucia-60.csv', base_email_sucia(60))

    print('\nSMS (simulador de End User Messaging · VERIFICAR los números en la consola):')
    escribir(destino / 'sms-01-humo-10.csv', base_sms(10, args.sms_ok))
    escribir(destino / 'sms-02-pocos-100.csv', base_sms(100, args.sms_ok))
    escribir(destino / 'sms-03-medio-1000.csv', base_sms(1000, args.sms_ok))
    escribir(destino / 'sms-04-fallos-50.csv', base_sms(50, args.sms_fallo))

    print('\n⚠️  Las bases de SMS repiten el mismo número: súbelas con "Permitir duplicados"')
    print('    marcado, o la deduplicación las reducirá a UN destinatario.')


if __name__ == '__main__':
    main()
