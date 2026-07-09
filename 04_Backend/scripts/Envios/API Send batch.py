import pandas as pd
import boto3
import json
import datetime
import time
import io
import re

#Debo revisar si existen las tablas:
#Customer_processDetail
#Customer_sendDetail
#Customer_BlackList

#Debo pasar cada registyro por la expresion regular
#Debo consultar cada registro en la lista negra
#Debo consultar cada registro en las desinscripciones

#Contar la cantidad de registros en lista negra
#Contar la cantidad de registros desinscritos
#Contaar el total de registros que entraron

# Crea un cliente de SES
ses_client = boto3.client('ses', region_name='us-east-1')

# Define la plantilla de correo electrónico
template_name = 'mi_plantilla'
template_data = {
    'subject': 'Asunto de mi correo',
    'body': 'Cuerpo de mi correo para ${name}',
}

csv_text = """
Identificacion;Nombre;Correo;Celular;Factura;Opcional1;Opcional2
123456789;Ana García;anagarcia@ejemplo.com;1234567890;123456789;calle Mayor 12;Madrid
987654321;Pedro López;pedrolopez@ejemplo.com;9876543210;987654321;calle Menor 23;Barcelona
"""
#From text
#df = pd.read_csv(io.StringIO(csv_text), delimiter=";")
#From file
csv = "D:\\ProyectoComunicaciones\\ArchivoPruebas_100Registros_ConMalos.csv"
df = pd.read_csv(csv, delimiter=";")
patron_email = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'
data = []
email = ""
start_time = time.time()

print(df)

for i in range(len(df)):
    email = df["Correo"].iloc[i]
    #print(email)
    if re.match(patron_email, email):
        data.append({
            "ToAddresses": [email],
            "ReplacementTemplateData": {
                column: df.iloc[i, j] for j, column in enumerate(df.columns)
            }
        })
    else:
        print(email + " No valido")
print(data)
end_time = time.time()
print(f"Tiempo de ejecución2: {end_time - start_time} segundos")
data = []
start_time = time.time()

for i in range(len(df)):
    replacement_data = {}
    for col_index, col_name in enumerate(df.columns):
        replacement_data[col_name] = df.iloc[i, col_index]
    
    data.append({
        "ToAddresses": [df["Correo"].iloc[i]],
        "ReplacementTemplateData": replacement_data,
    })
print(data)
end_time = time.time()
print(f"Tiempo de ejecución3: {end_time - start_time} segundos")


# Define la lista de destinatarios
destination_list = [
    {
        'Destination': {
            'ToAddresses': ['destinatario1@example.com'],
        },
        'ReplacementTemplateData': '{"name": "Juan"}',
    },
    {
        'Destination': {
            'ToAddresses': ['destinatario2@example.com'],
        },
        'ReplacementTemplateData': '{"name": "María"}',
    },
    # Agrega más destinatarios según sea necesario
]

# Envía el lote de correos electrónicos
#Maximo 50.000 destinatarios o envios de email
response = ses_client.send_bulk_templated_email(
    Source='noreply@example.com',
    Template=template_name,
    DefaultTemplateData=json.dumps(template_data),
    Destinations=destination_list,
)

# Imprime la respuesta (incluidos los identificadores de mensaje para cada destinatario)
print(response)
