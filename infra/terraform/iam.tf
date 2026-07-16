data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name               = "${var.project}-lambda-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Logs a CloudWatch.
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Permisos de datos/servicios que usan las lambdas. Amplio pero acotado a los
# recursos del proyecto. Endurécelo por función si tu política de seguridad lo pide.
data "aws_iam_policy_document" "lambda_app" {
  # DynamoDB: tablas del panel + tablas por-tenant ({customer}_*).
  statement {
    sid = "DynamoDB"
    actions = [
      "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem",
      "dynamodb:Query", "dynamodb:Scan", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
      "dynamodb:CreateTable", "dynamodb:DescribeTable",
      # TransactWriteItems: acreditación atómica del webhook Wompi (txn + saldo).
      "dynamodb:TransactWriteItems", "dynamodb:TransactGetItems"
    ]
    resources = [
      "arn:aws:dynamodb:${local.region}:${local.account_id}:table/*"
    ]
  }

  # SES: envío de correos.
  statement {
    sid       = "SES"
    actions   = ["ses:SendEmail", "ses:SendRawEmail", "ses:SendTemplatedEmail", "ses:SendBulkTemplatedEmail", "ses:GetTemplate", "ses:CreateTemplate", "ses:UpdateTemplate", "ses:DeleteTemplate", "ses:ListTemplates"]
    resources = ["*"]
  }

  # SQS: enrutamiento y consumo de lotes.
  statement {
    sid       = "SQS"
    actions   = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"]
    resources = ["arn:aws:sqs:${local.region}:${local.account_id}:*"]
  }

  # S3: bases de datos, adjuntos, reportes.
  statement {
    sid       = "S3"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::*"]
  }

  # End User Messaging (SMS/Voz).
  statement {
    sid       = "EndUserMessaging"
    actions   = ["sms-voice:SendTextMessage", "sms-voice:SendVoiceMessage"]
    resources = ["*"]
  }

  # End User Messaging Social (WhatsApp).
  statement {
    sid       = "SocialMessaging"
    actions   = ["social-messaging:SendWhatsAppMessage"]
    resources = ["*"]
  }

  # Secrets Manager (para migrar SECRET_KEY fuera de env vars).
  statement {
    sid       = "Secrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:${var.project}/*"]
  }
}

resource "aws_iam_role_policy" "lambda_app" {
  name   = "${var.project}-lambda-app"
  role   = aws_iam_role.lambda_exec.id
  policy = data.aws_iam_policy_document.lambda_app.json
}
