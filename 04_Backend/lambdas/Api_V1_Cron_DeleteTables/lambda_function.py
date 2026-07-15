import os
import boto3
import time
import json
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
sqs = boto3.client("sqs")

# URL de la cola SQS que dispara el borrado de tablas (SQS_DeleteTables).
QUEUE_URL = os.environ.get("QUEUE_URL", "")


def _flush(batch):
    """Envía el lote a SQS y reporta los que no se pudieron encolar."""
    if not batch:
        return
    resp = sqs.send_message_batch(QueueUrl=QUEUE_URL, Entries=batch)
    failed = resp.get("Failed") or []
    if failed:
        print(f"send_message_batch: {len(failed)} entradas fallidas: {failed}")


def lambda_handler(event, context):
    if not QUEUE_URL:
        raise RuntimeError("Falta la variable de entorno QUEUE_URL")

    nombre_funcion = context.function_name
    environment = context.invoked_function_arn.split(":")[-1]
    environment = "Dev" if environment == nombre_funcion else environment

    table = dynamodb.Table(f"{environment}_TableLifecycle")
    now = int(time.time())
    count = 0
    last_key = None
    batch = []

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
            # El Id del batch debe ser único y <=80 chars alfanuméricos/-/_;
            # el nombre de tabla puede exceder eso, así que usamos el índice.
            batch.append({
                "Id": str(count),
                "MessageBody": json.dumps(item, default=str)
            })
            count += 1
            if len(batch) == 10:
                _flush(batch)
                batch = []

        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            break

    _flush(batch)
    return {"tables": count}