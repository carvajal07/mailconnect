import boto3
import time
import json
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
sqs = boto3.client("sqs")

QUEUE_URL = "SQS_QUEUE_URL"

def lambda_handler(event, context):
    nombre_funcion = context.function_name
    environment = context.invoked_function_arn.split(":")[-1]
    environment = "Dev" if environment == nombre_funcion else environment

    table = dynamodb.Table(f"{environment}_TableLifecycle")
    now = int(time.time())
    count = 0
    last_key = None

    while True:
        params = {
            "IndexName": "lifeCycleStatus-expirationTimeDynamo",
            "KeyConditionExpression":
                Key("lifeCycleStatus").eq("TABLE-ACTIVE") &
                Key("expirationTimeDynamo").lte(now)
        }
        if last_key:
            params["ExclusiveStartKey"] = last_key

        response = table.query(**params)

        for item in response["Items"]:
            batch.append({
                "Id": item["tableName"],
                "MessageBody": json.dumps(item, default=str)
            })
            if len(batch) == 10:
                sqs.send_message_batch(QueueUrl=QUEUE_URL, Entries=batch)
                batch = []
            count += 1
        
        if batch:
            sqs.send_message_batch(QueueUrl=QUEUE_URL, Entries=batch)
        
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break

    return {"tables": count}