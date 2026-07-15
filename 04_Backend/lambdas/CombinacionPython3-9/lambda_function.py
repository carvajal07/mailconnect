from docxtpl import DocxTemplate
from datetime import datetime
import boto3
import json
import uuid
import csv
import io


REGION = 'us-east-1'

#Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

#Crea el cliente para S3
s3 = boto3.client('s3', region_name=REGION)

global formatted_date
global customer_name
global bucket_name

table_document = dynamodb.Table('document')

def download_attachments_data(campaign_id:str)->str:
    projection_document_expression = 'documentPath'  # Lista de campos a consultar

    response_document = table_document.scan(
        FilterExpression="campaignId = :value",
        ExpressionAttributeValues={":value": campaign_id},
        ProjectionExpression=projection_document_expression
    )

    #Revisar porque aca puede ser mas de un adjunto
    items = response_document['Items']
    
    if items:
        for item in items:
            attachment_path = item["documentPath"]

            # Descargar el objeto S3 en un objeto BytesIO
            file_name = attachment_path.split('/')[1]

            #Descargar la plantilla a un directorio temporal
            template_temp_file = f'/tmp/{customer_name}_{formatted_date}_file_name.tmp' 
            s3.download_file(bucket_name, attachment_path, template_temp_file)

            return template_temp_file
    else:
        print("Error, el adjunto para el envio no se encuentra registrado en la tabla de documentos")
        print(f"El id de campaña {campaign_id} no se encontro en la tabla document")

def lambda_handler(event, context):
    """
    Función principal

    Args:
        event (dict): Datos de evento
        context (dict): Datos de contexto
        
    Returns:
        None: Personalizado
    """

    # Procesa TODOS los records del batch SQS (antes solo se leia Records[0],
    # perdiendo el resto si el trigger usa BatchSize>1). Se re-invoca el handler
    # con un record a la vez para reutilizar el flujo existente por-registro.
    _records = event.get("Records") if isinstance(event, dict) else None
    if _records and len(_records) > 1:
        _results = []
        for _rec in _records:
            _results.append(lambda_handler({"Records": [_rec]}, context))
        return _results
    global formatted_date
    global customer_name
    global bucket_name

    # Obtener la fecha y hora actual
    now = datetime.utcnow()
    # Formatear la fecha y hora según un formato específico
    formatted_date = now.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + 'Z'
    id = str(uuid.uuid4())
    try:
        # Obtener datos del evento
        body = event["Records"][0]["body"]
        json_body = json.loads(body)
        customer_id = json_body["customerId"]
        customer_name = json_body["customerName"]
        process_id = json_body["processId"]
        campaign_id = json_body["campaignId"]
        attachment = json_body["attachment"]
        from_email = json_body["fromEmail"]
        headers = json_body["headers"]
        template_name = json_body["templateName"]
        part = json_body["part"]
        data = json_body["data"]
        registers = len(data)
        print(f"Customer: {customer_name}")
        print(f"Customer id: {customer_id}")
        print(f"Process id: {process_id}")
        print(f"Campaign id: {campaign_id}")
        print(f"From email: {from_email}")
        print(f"Headers: {headers}")
        print(f"Template name: {template_name}")
        print(f"Parte: {part}")
        print(f"Cantidad registros a procesar: {registers}")

    except Exception as e:
        print(e)
        status = False
        statusCode = 500
        description = "Error no controlado en el servicio"
    else:
        bucket_name = f'{customer_name}.document'
        template_file = download_attachments_data(campaign_id)
        # Carga la plantilla DOCX original
        doc = DocxTemplate(template_file)
        headers_list = headers.split(";")
        
        # Itera sobre cada fila del CSV
        for register in data:
            context = {}
            data_list = register.split(";")
            buffer = io.BytesIO()
            # Reemplaza el texto en la plantilla
            #context = {f"{key}": f"{value}" for key, value in register.items()}
            for i, valor in enumerate(data_list):
                context[headers_list[i]] = valor
            doc.render(context)
            buffer.seek(0)

            file_name = data_list[0]

            s3.upload_fileobj(buffer, Bucket=bucket_name, Key=f'{file_name}.pdf')
            #s3.put_object(Body=file_content, Bucket='my-bucket', Key='myfile.txt')
