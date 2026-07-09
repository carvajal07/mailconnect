import boto3
import ast
import json
import csv
import io
from datetime import datetime, timedelta

# Config
LOG_GROUP_NAME = '/aws/lambda/Api_V1_Email_ReceptionStatus'
DYNAMO_TABLE_NAME = 'merkacaldas_sendStatus_146a5fe8-1c94-4718-88d7-452986e017d7'
BUCKET_NAME = 'merkacaldas.database'
PREFIX = 'reportes/'
DYNAMO_CSV_KEY = f'{PREFIX}dynamo_raw_20250702_112555.csv'

logs_client = boto3.client('logs')
dynamo_client = boto3.client('dynamodb')
s3_client = boto3.client('s3')

def lambda_handler(event, context):
    # 1. Obtener todos los datos de Dynamo
    #dynamo_items = scan_dynamo_table(DYNAMO_TABLE_NAME)
    # 1. Leer CSV desde S3 (datos Dynamo)
    dynamo_items = read_csv_from_s3(BUCKET_NAME, DYNAMO_CSV_KEY)

    # 2. Obtener todos los logs recientes
    logs_map = get_logs_messageid_to_map()
    print(logs_map)

    # 3. Unir datos por messageId
    combined = []
    correos_unicos = set()

    for item in dynamo_items:
        message_id = item.get('messageId')
        if message_id in logs_map:
            #print("Encontrado")
            item['to'] = logs_map[message_id]
            #print(item['to'])
            correos_unicos.add(logs_map[message_id])
        combined.append(item)

    # 4. Guardar CSVs
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    #save_csv_to_s3(dynamo_items, f"{PREFIX}dynamo_raw_{timestamp}.csv")
    save_csv_to_s3(combined, f"{PREFIX}dynamo_plus_to_{timestamp}.csv")
    save_csv_to_s3([{"to": email} for email in correos_unicos], f"{PREFIX}correos_unicos_{timestamp}.csv")

    return {
        "status": "success",
        "dynamo_records": len(dynamo_items),
        "matched": len(combined),
        "unique_emails": len(correos_unicos)
    }

def read_csv_from_s3(bucket, key):
    """Lee un archivo CSV desde S3 y devuelve una lista de dicts."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content = response['Body'].read().decode('utf-8')
    reader = csv.DictReader(io.StringIO(content))
    return list(reader)

def scan_dynamo_table(table_name):
    """Escanea todos los registros de la tabla Dynamo."""
    items = []
    paginator = dynamo_client.get_paginator('scan')
    for page in paginator.paginate(TableName=table_name):
        for raw_item in page.get('Items', []):
            # Convertir a diccionario plano
            item = {k: list(v.values())[0] for k, v in raw_item.items()}
            items.append(item)
    return items

import ast

def get_logs_messageid_to_map():
    """Extrae {messageId: to} de logs con paginación."""
    end_time = int(datetime.utcnow().timestamp() * 1000)
    start_time = int((datetime.utcnow() - timedelta(days=4)).timestamp() * 1000)

    mapping = {}
    next_token = None

    while True:
        params = {
            'logGroupName': LOG_GROUP_NAME,
            'startTime': start_time,
            'endTime': end_time,
        }
        if next_token:
            params['nextToken'] = next_token

        response = logs_client.filter_log_events(**params)

        for event in response.get('events', []):
            linea = event.get('message', '')
            if linea.startswith("{'Type': 'Notification'") and "'Message': " in linea:
                try:
                    log_data = ast.literal_eval(linea)
                    message = json.loads(log_data.get('Message', '{}'))
                    message_id = message.get('mail', {}).get('messageId')

                    to_list = message.get('mail', {}).get('commonHeaders', {}).get('to', [])
                    to_field = to_list[0] if isinstance(to_list, list) and to_list else ''

                    if message_id and to_field and message_id not in mapping:
                        mapping[message_id] = to_field
                except Exception as e:
                    print(f"[Error parsing SES Message]: {e}\nLinea:\n{linea}")

        next_token = response.get('nextToken')
        if not next_token:
            break

    return mapping


def save_csv_to_s3(data, key):
    if not data:
        print(f"Sin datos para guardar en {key}")
        return

    # Asegurarse de capturar todas las posibles claves de todos los dicts
    all_keys = set()
    for row in data:
        all_keys.update(row.keys())

    headers = list(all_keys)

    csv_buffer = io.StringIO()
    writer = csv.DictWriter(csv_buffer, fieldnames=headers)
    writer.writeheader()
    writer.writerows(data)

    s3_client.put_object(
        Bucket=BUCKET_NAME,
        Key=key,
        Body=csv_buffer.getvalue(),
        ContentType='text/csv'
    )
    print(f"Archivo {key} guardado en S3.")

