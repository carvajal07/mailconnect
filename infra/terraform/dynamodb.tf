# Tablas del "plano de control" (fijas). Las tablas por-tenant ({customer}_blackList,
# {customer}_unsubscribe, {customer}_sendStatus_{proceso}, {customer}_processDetail, …)
# NO se gestionan aquí: las crean las lambdas en runtime por cliente.
#
# Claves (hash/range) inferidas del código en 04_Backend/lambdas. Las marcadas con
# VERIFICAR conviene confirmarlas contra la tabla real antes de un import.

locals {
  dynamo_tables = {
    # panel / negocio
    customer        = { hash = "customerId" }
    user            = { hash = "userId" }
    userData        = { hash = "userDataId" }
    userActivation  = { hash = "userActivationId" }
    session         = { hash = "sessionId" }
    campaign        = { hash = "campaignId" }
    campaignControl = { hash = "campaignControlId" }
    process         = { hash = "processId" }
    databaseFile    = { hash = "databaseFileId" }
    messageTemplate = { hash = "messageTemplateId" }
    document        = { hash = "documentId" } # VERIFICAR
    channel         = { hash = "channelId" }  # VERIFICAR
    templateControl = { hash = "templateControlId" }
    templateAudit   = { hash = "templateAuditId" }

    # seguridad / OTP
    oneTimePassword      = { hash = "oneTimePasswordId" }
    oneTimePasswordAudit = { hash = "oneTimePasswordAuditId" } # VERIFICAR

    # admin (panel jul 2026)
    platformConfig = { hash = "configKey" }
    adminAudit     = { hash = "auditId" }
    pricingRate    = { hash = "customerId", range = "channel" }
  }
}

resource "aws_dynamodb_table" "this" {
  for_each = local.dynamo_tables

  name         = each.key
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = each.value.hash
  range_key    = try(each.value.range, null)

  attribute {
    name = each.value.hash
    type = "S"
  }

  dynamic "attribute" {
    for_each = try(each.value.range, null) == null ? [] : [each.value.range]
    content {
      name = attribute.value
      type = "S"
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    # Evita borrar tablas de producción por un cambio de config.
    prevent_destroy = true
  }
}
