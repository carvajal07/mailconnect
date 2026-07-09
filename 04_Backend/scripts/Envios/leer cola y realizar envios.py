import json
import boto3

def lambda_handler(event, context):
    # Configura el cliente de SQS y SES
    sqs = boto3.client('sqs')
    ses = boto3.client('ses')

    # Obtén la URL de la cola SQS
    queue_url = 'URL_DE_TU_COLA_SQS'

    # Procesa cada mensaje en la cola SQS
    for record in event['Records']:
        # Lee el cuerpo del mensaje
        body = json.loads(record['body'])

        # Procesa cada registro en el mensaje
        for registro in body['registros']:
            # Extrae información del registro
            destinatario = registro['destinatario']
            asunto = registro['asunto']
            cuerpo = registro['cuerpo']

            # Envía el correo electrónico utilizando SES
            response = ses.send_email(
                Source='TU_DIRECCION_DE_CORREO',
                Destination={
                    'ToAddresses': [destinatario],
                },
                Message={
                    'Subject': {'Data': asunto},
                    'Body': {'Text': {'Data': cuerpo}},
                }
            )

            # Puedes agregar lógica adicional según sea necesario, por ejemplo, manejo de errores o registro de eventos

    return {
        'statusCode': 200,
        'body': json.dumps('Proceso completado exitosamente.'),
    }