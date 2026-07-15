# Colas de envío por canal + fan-out de preparación. Cada una con su DLQ.
# Los nombres siguen la convención del proyecto (ver CLAUDE.md: Sms_Send-batch, etc.).

locals {
  queues = {
    EM           = "Email_Send-batch-EM"
    EAU          = "Email_Send-batch-EAU"
    EAP          = "Email_Send-batch-EAP"
    EAP_PDF      = "Email_Send-batch-EAP-PDF"
    PREPARE_PART = "Email_Prepare-part"
    SMS          = "Sms_Send-batch"
    WSP          = "Wsp_Send-batch"
    VOICE        = "Voice_Send-batch"
  }

  # Qué función consume cada cola (event source mapping SQS → Lambda).
  queue_consumers = {
    EM           = "Api_V1_Email_Send-batch-template-EM"
    EAU          = "Api_V1_Email_Send-batch-template-EAU"
    EAP          = "Api_V1_Email_Send-batch-template-EAP"
    PREPARE_PART = "Api_V1_Email_Prepare-batch-template"
    SMS          = "Api_V1_Sms_Send-batch"
    WSP          = "Api_V1_Wsp_Send-batch"
    VOICE        = "Api_V1_Voice_Send-batch"
  }

  # Env vars con las URLs de las colas (se inyectan en TODAS las funciones; las
  # que no las usan las ignoran). Los productores (Prepare-batch) las leen.
  queue_env = {
    URL_SQS_EM           = aws_sqs_queue.this["EM"].url
    URL_SQS_EAU          = aws_sqs_queue.this["EAU"].url
    URL_SQS_EAP          = aws_sqs_queue.this["EAP"].url
    URL_SQS_EAP_PDF      = aws_sqs_queue.this["EAP_PDF"].url
    URL_SQS_PREPARE_PART = aws_sqs_queue.this["PREPARE_PART"].url
    URL_SQS_SMS          = aws_sqs_queue.this["SMS"].url
    URL_SQS_WSP          = aws_sqs_queue.this["WSP"].url
    URL_SQS_VOICE        = aws_sqs_queue.this["VOICE"].url
  }
}

resource "aws_sqs_queue" "dlq" {
  for_each                  = local.queues
  name                      = "${each.value}-dlq"
  message_retention_seconds = 1209600 # 14 días
}

resource "aws_sqs_queue" "this" {
  for_each                   = local.queues
  name                       = each.value
  visibility_timeout_seconds = 300 # ≥ 6× timeout de la lambda consumidora
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.key].arn
    maxReceiveCount     = 5
  })
}

resource "aws_lambda_event_source_mapping" "sqs" {
  for_each         = local.queue_consumers
  event_source_arn = aws_sqs_queue.this[each.key].arn
  function_name    = aws_lambda_function.this[each.value].arn
  batch_size       = 10
  enabled          = true
}
