#!/usr/bin/env python3
"""
Backfill del RESUMEN pre-agregado por proceso ({customer}_sendSummary).

Reconstruye el resumen (enviados/entregados/abiertos/clics/rebotes/quejas) de TODOS
los procesos de un cliente a partir de la tabla {customer}_sendStatus (la fuente de
verdad), usando la MISMA agregación que Reports_Statistics (estado de mayor prioridad
por messageId). Es idempotente: sobrescribe el resumen con el valor recalculado.

Orden de rollout de la pre-agregación:
  1) Provisiona las tablas {customer}_sendState y {customer}_sendSummary por cliente.
  2) Activa la ESCRITURA: SEND_SUMMARY_ENABLED=true en Email/Messaging ReceptionStatus.
  3) Corre ESTE backfill (deja el resumen consistente con lo ya recibido).
  4) Activa la LECTURA: SEND_SUMMARY_READ=true en Reports_Statistics y Portal_Bootstrap.
Antes del paso 4, los reportes leen por scan (correcto, solo más lento).

Uso:
  python scripts/backfill_send_summary.py --customer empresa
  python scripts/backfill_send_summary.py --customer empresa --plan   # no escribe
"""
import argparse
import boto3
from boto3.dynamodb.conditions import Key

STATE_PRIORITY = {1: 1, 9: 2, 8: 3, 3: 4, 2: 5, 6: 6, 10: 7, 7: 8, 4: 9, 5: 10}
FIELDS = ('enviados', 'entregados', 'abiertos', 'clics', 'rebotes', 'quejas')


def _to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _counts_from_states(states):
    enviados = len(states)
    entregados = abiertos = clics = rebotes = quejas = 0
    for st in states.values():
        if st in (2, 4, 5, 7):
            entregados += 1
        if st in (4, 5):
            abiertos += 1
        if st == 5:
            clics += 1
        if st in (3, 6):
            rebotes += 1
        if st == 7:
            quejas += 1
    return {'enviados': enviados, 'entregados': entregados, 'abiertos': abiertos,
            'clics': clics, 'rebotes': rebotes, 'quejas': quejas}


def _process_ids(dynamodb, customer):
    """Procesos del cliente (tabla process por customerName)."""
    table = dynamodb.Table('process')
    ids, last = [], None
    while True:
        kwargs = {'FilterExpression': Key('customerName').eq(customer),
                  'ProjectionExpression': 'processId'}
        if last:
            kwargs['ExclusiveStartKey'] = last
        resp = table.scan(**kwargs)
        ids.extend(i['processId'] for i in resp.get('Items', []) if i.get('processId'))
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
    return ids


def _states_of_process(status_table, process_id):
    """{messageId: estado de mayor prioridad} para un proceso."""
    states, last = {}, None
    while True:
        kwargs = {'KeyConditionExpression': Key('processId').eq(process_id)}
        if last:
            kwargs['ExclusiveStartKey'] = last
        resp = status_table.query(**kwargs)
        for rec in resp.get('Items', []):
            mid = rec.get('messageId') or rec.get('MessageId')
            if not mid:
                continue
            st = _to_int(rec.get('state'))
            if mid not in states or STATE_PRIORITY.get(st, 0) > STATE_PRIORITY.get(states[mid], 0):
                states[mid] = st
        last = resp.get('LastEvaluatedKey')
        if not last:
            break
    return states


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--customer', required=True, help='nombre de empresa (tenant)')
    ap.add_argument('--region', default='us-east-1')
    ap.add_argument('--plan', action='store_true', help='no escribe, solo muestra')
    args = ap.parse_args()

    dynamodb = boto3.resource('dynamodb', region_name=args.region)
    status_table = dynamodb.Table('{}_sendStatus'.format(args.customer))
    summary_table = dynamodb.Table('{}_sendSummary'.format(args.customer))

    process_ids = _process_ids(dynamodb, args.customer)
    print('Procesos del cliente {}: {}'.format(args.customer, len(process_ids)))
    total = 0
    for pid in process_ids:
        counts = _counts_from_states(_states_of_process(status_table, pid))
        print('  {} -> {}'.format(pid, counts))
        if not args.plan:
            summary_table.put_item(Item={'processId': pid, **counts})
            total += 1
    print('Resúmenes escritos: {}'.format('(plan, 0)' if args.plan else total))


if __name__ == '__main__':
    main()
