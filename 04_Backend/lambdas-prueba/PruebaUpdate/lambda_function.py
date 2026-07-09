import json
import boto3
from boto3.dynamodb.conditions import Key

#Configurar el cliente de DynamoDB
dynamodb = boto3.resource('dynamodb')

table_user = dynamodb.Table('user')
userId = '0ed991f9-9828-479a-9e6b-3d84f737104a'

#customerId = 488ce65d-3081-40e6-a274-782bee8ebd05
customerNuevo = 'Nuevo'
def lambda_handler(event, context):
    # TODO implement
    response = table_user.update_item(
        Key={'userId':userId},
        UpdateExpression='SET customerId = :s',
        ExpressionAttributeValues={':s': 'Nuevo'},
        ReturnValues='UPDATED_NEW'
    )
    print(response['Attributes'])
    return {
        'statusCode': 200,
        'body': json.dumps('Hello from Lambda !')
    }
