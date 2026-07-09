import time
import boto3

ddb = boto3.client("dynamodb")
dynamodb = boto3.resource("dynamodb")

BUCKET = "email-campaign-archive"
REGION = "us-east-1"
ACCOUNT = "ACCOUNT_ID"

def ensure_lifecycle_rule(s3_days, glacier_days):
    rule_id = f"lifecycle_S3-{s3_days}Dias_Glacier-{glacier_days}Dias"
    prefix = f"retention_S3-{s3_days}Dias_Glacier-{glacier_days}Dias/"

    # 1. Obtener reglas actuales
    try:
        config = s3.get_bucket_lifecycle_configuration(Bucket=BUCKET)
        rules = config.get("Rules", [])
    except s3.exceptions.ClientError as e:
        # No tiene ninguna regla aún
        if "NoSuchLifecycleConfiguration" in str(e):
            rules = []
        else:
            raise

    # 2. Verificar si ya existe
    if any(r["ID"] == rule_id for r in rules):
        return  # Ya existe, no hacer nada

    # 3. Crear la nueva regla
    new_rule = {
        "ID": rule_id,
        "Filter": {"Prefix": prefix},
        "Status": "Enabled",
        "Transitions": [
            {
                "Days": s3_days,
                "StorageClass": "GLACIER"
            }
        ],
        "Expiration": {
            "Days": s3_days + glacier_days
        }
    }

    rules.append(new_rule)

    # 4. Aplicar toda la configuración (se reemplaza completa)
    s3.put_bucket_lifecycle_configuration(
        Bucket=BUCKET,
        LifecycleConfiguration={"Rules": rules}
    )

def lambda_handler(event, context):
    nombre_funcion = context.function_name
    environment = context.invoked_function_arn.split(":")[-1]
    environment = "Dev" if environment == nombre_funcion else environment

    table = dynamodb.Table(f"{environment}_TableLifecycle")
    table_name = event["tableName"]
    customer_id = event["customerId"]
    s3_days = event["expirationDaysS3"]
    glacier_days = event["expirationDaysGlacier"]

    prefix = f"retention_S3-{s3_days}Dias_Glacier-{glacier_days}Dias/customerId={customer_id}/table={table_name}"

    arn = f"arn:aws:dynamodb:{REGION}:{ACCOUNT}:table/{table_name}"

    # 1. Marcar como DELETING
    key = {
        "customerId": customer_id,
        "tableName": table_name
    }
    table.update_item(
        Key=key,
        UpdateExpression="SET lifeCycleStatus = :s",
        ExpressionAttributeValues={
            ":s": "TABLE-DELETING"
        }
    )

    # Asegurar que la regla existe antes de exportar
    ensure_lifecycle_rule(s3_days, glacier_days)

    # 2. Exportar (asíncrono)
    export = ddb.export_table_to_point_in_time(
        TableArn=arn,
        S3Bucket=BUCKET,
        S3Prefix=prefix,
        ExportFormat="ION"
    )
    export_arn = export["ExportDescription"]["ExportArn"]

    # 3. Esperar a que termine el export
    while True:
        status = ddb.describe_export(ExportArn=export_arn)
        state = status["ExportDescription"]["ExportStatus"]

        if state == "COMPLETED":
            break
        elif state == "FAILED":
            # Revertir estado si falla
            table.update_item(
                Key=key,
                UpdateExpression="SET lifecycleStatus = :s",
                ExpressionAttributeValues={":s": "TABLE-ACTIVE"}
            )
            raise Exception(f"Export falló: {status['ExportDescription'].get('FailureMessage')}")

        time.sleep(30)

    # 4. Eliminar la tabla de proceso
    ddb.delete_table(TableName=table_name)

    # 5. Actualizar lifecycle a DELETE
    table.update_item(
        Key=key,
        UpdateExpression="SET lifecycleStatus = :s, s3Prefix = :p",
        ExpressionAttributeValues={
            ":s": "TABLE-DELETE",
            ":p": f"s3://{BUCKET}/{prefix}"
        }
    )

    return {"status": "ok", "table": table_name}