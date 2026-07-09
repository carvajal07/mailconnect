import boto3

def create_sqs_queue(queue_name):
    sqs = boto3.client('sqs')
    
    # Crear la cola SQS
    response = sqs.create_queue(
        QueueName=queue_name
    )
    
    # Obtener la URL de la cola recién creada
    queue_url = response['QueueUrl']
    
    return queue_url

# Nombre de la cola que deseas crear
queue_name = 'MiNuevaColaSQS'

# Crear la cola y obtener la URL
queue_url = create_sqs_queue(queue_name)
print(f"La cola SQS '{queue_name}' ha sido creada con URL: {queue_url}")