import csv
import json
import boto3
import base64

def lambda_handler(event, context):
    # Parámetros
    cliente = event['cliente']
    producto = event['producto']
    codificacion = event['codificacion']

    # Obtener el archivo CSV desde el evento S3
    csv_data = base64.b64decode(event['csv'])
    csv_rows = csv_data.decode(codificacion).splitlines()

    # Dividir el archivo en lotes de 5 registros
    batch_size = 5
    batches = [csv_rows[i:i+batch_size] for i in range(0, len(csv_rows), batch_size)]

    # Configurar cliente SQS
    sqs = boto3.client('sqs')

    # URL de la cola SQS
    sqs_queue_url = 'URL_de_tu_cola_SQS'

    # Enviar cada lote a la cola SQS
    for batch in batches:
        # Crear mensaje SQS
        message_body = {
            'cliente': cliente,
            'producto': producto,
            'registros': batch
        }

        # Enviar mensaje a la cola SQS
        response = sqs.send_message(
            QueueUrl=sqs_queue_url,
            MessageBody=json.dumps(message_body)
        )

        print(f'Mensaje enviado: {response["MessageId"]}')

    return {
        'statusCode': 200,
        'body': json.dumps('Proceso completado exitosamente.')
    }