import boto3

def configure_lambda_trigger(lambda_function_name, queue_url):
    lambda_client = boto3.client('lambda')

    # Configurar la cola SQS como disparador de la Lambda
    response = lambda_client.create_event_source_mapping(
        EventSourceArn=queue_url,
        FunctionName=lambda_function_name,
        Enabled=True,
        BatchSize=10  # Tamaño del lote, puedes ajustarlo según tus necesidades
    )

    return response

# Nombre de la función Lambda
lambda_function_name = 'MiFuncionLambda'

# Configurar la cola SQS como disparador de la Lambda
response = configure_lambda_trigger(lambda_function_name, queue_url)
print(f"La cola SQS '{queue_name}' ha sido configurada como disparador de la Lambda '{lambda_function_name}'.")