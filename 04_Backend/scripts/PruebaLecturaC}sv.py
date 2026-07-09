import csv
import boto3
import json

def read_csv_from_s3(bucket_name, file_key):
    s3 = boto3.client('s3')
    obj = s3.get_object(Bucket=bucket_name, Key=file_key)
    csv_content = obj['Body'].read().decode('utf-8')
    
    csv_lines = csv_content.splitlines()
    # Omitir la primera línea (encabezados)
    csv_data = csv_lines[1:]
    return csv_data

def divide_into_batches(data, batch_size):
    return [data[i:i+batch_size] for i in range(0, len(data), batch_size)]

def read_csv(file_path):
    data = []
    with open(file_path, 'r', newline='') as csvfile:
        csvreader = csv.reader(csvfile)
        next(csvreader)  # Omitir la primera fila (encabezados)
        for row in csvreader:
            data.append(','.join(row)) 
    return data

def format_records(records):
    formatted_records = []
    for record in records:
        # Parsear el registro CSV
        Identificacion, Nombre, Correo, Celular, Opcional1, Opcional2 = record.split(';')
        
        # Crear el objeto de mensaje según la estructura requerida
        message = {
            "identificacion": Identificacion,
            "email": Correo,
            "subjectData": {
                "nombre": Nombre
            },
            "bodyData": {
                "nombre": Nombre,
                "opcional1": Opcional1,
                "celular": Celular
            }
        }
        formatted_records.append(message)
    return formatted_records

def send_batches_to_sqs(batched_data, queue_url):
    sqs = boto3.client('sqs')
    for batch in batched_data:
        sqs.send_message_batch(
            QueueUrl=queue_url,
            Entries=[
                {
                    'Id': str(i),
                    'MessageBody': json.dumps(batch[i])
                } for i in range(len(batch))
            ]
        )

#def lambda_handler(event, context):
# Obtener la información del evento S3
#bucket_name = event['Records'][0]['s3']['bucket']['name']
#file_key = event['Records'][0]['s3']['object']['key']

# Leer el archivo CSV desde S3
#desde S3
#csv_content = read_csv_from_s3(bucket_name, file_key)

#desde local
file_path = 'D:\ProyectoComunicaciones\ArchivoPruebas_10Registros.csv'
csv_content = read_csv(file_path)


# Dividir los registros en lotes de 50
batches = divide_into_batches(csv_content, 2)

# Formatear cada lote de registros según la estructura requerida
formatted_batches = [format_records(batch) for batch in batches]
print(formatted_batches)
# Dividir cada lote en lotes de 5 para enviar a SQS
final_batches = [divide_into_batches(batch, 5) for batch in formatted_batches]

# Obtener la URL de la cola SQS
queue_url = 'URL_DE_TU_COLA_SQS'

# Enviar cada lote de 5 registros a SQS
for batch in final_batches:
    send_batches_to_sqs(batch, queue_url)

'''
return {
    'statusCode': 200,
    'body': 'Datos procesados y enviados a SQS correctamente.'
}
'''
