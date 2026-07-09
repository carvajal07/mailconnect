import json
import boto3

def lambda_handler(event, context):
    # Obtiene el nombre del bucket y la clave del objeto de S3 desde el evento
    bucket = event['Records'][0]['s3']['bucket']['name']
    key = event['Records'][0]['s3']['object']['key']

    # Crea un cliente de S3
    s3_client = boto3.client('s3')

    # Lee la actividad del objeto de S3
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content = response['Body'].read()

    # Procesa la actividad (puedes implementar tu lógica aquí)
    print(f"Acceso a la URL de la imagen: {key}, Actividad: {content}")

    # Puedes retornar algo si lo necesitas
    return {
        'statusCode': 200,
        'body': json.dumps('Actividad leída exitosamente.')
    }