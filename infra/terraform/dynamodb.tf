# Tablas del "plano de control" (fijas). Las tablas por-tenant ({customer}_blackList,
# {customer}_unsubscribe, {customer}_sendStatus_{proceso}, {customer}_processDetail, …)
# NO se gestionan aquí: las crean las lambdas en runtime por cliente.
#
# Claves (hash/range) inferidas del código en 04_Backend/lambdas. Las marcadas con
# VERIFICAR conviene confirmarlas contra la tabla real antes de un import.

locals {
  dynamo_tables = {
    # panel / negocio
    # GSIs OBLIGATORIOS: las list-lambdas consultan SIEMPRE por Query (escalable por
    # defecto) y FALLAN si el índice no existe (no caen a Scan). Provisionar antes de
    # desplegar/usar esas lambdas.
    customer        = { hash = "customerId" }
    user            = { hash = "userId", gsis = [{ name = "email-index", hash = "email" }] }
    userData        = { hash = "userDataId" }
    userActivation  = { hash = "userActivationId" }
    session         = { hash = "sessionId" }
    campaign        = { hash = "campaignId", gsis = [{ name = "customerId-index", hash = "customerId" }] }
    campaignControl = { hash = "campaignControlId" }
    process         = { hash = "processId" }
    databaseFile    = { hash = "databaseFileId", gsis = [{ name = "customerId-index", hash = "customerId" }] }
    messageTemplate = { hash = "messageTemplateId", gsis = [{ name = "customerId-index", hash = "customerId" }] }
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

    # cobro PREPAGO / monedero (jul 2026)
    # customerBalance: saldo por cliente (COP). Débito/crédito ATÓMICO (UpdateItem
    # condicional). walletTransaction: ledger AUDITABLE de todo movimiento de dinero
    # (recargas manuales/Wompi, débitos por envío, reembolsos). En Wompi el txId de la
    # recarga = la `reference` (idempotencia pending→approved del webhook). El GSI
    # customerId-createdAt-index sirve el historial del cliente (Query por fecha desc).
    customerBalance   = { hash = "customerId" }
    walletTransaction = {
      hash = "txId"
      gsis = [{ name = "customerId-createdAt-index", hash = "customerId", range = "createdAt" }]
    }
  }
}

resource "aws_dynamodb_table" "this" {
  for_each = local.dynamo_tables

  name         = each.key
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = each.value.hash
  range_key    = try(each.value.range, null)

  # Declara TODOS los atributos que son llave (de la tabla o de algún GSI), sin duplicar.
  dynamic "attribute" {
    for_each = toset(compact(concat(
      [each.value.hash, try(each.value.range, null)],
      flatten([for g in try(each.value.gsis, []) : [g.hash, try(g.range, null)]])
    )))
    content {
      name = attribute.value
      type = "S"
    }
  }

  dynamic "global_secondary_index" {
    for_each = try(each.value.gsis, [])
    content {
      name            = global_secondary_index.value.name
      hash_key        = global_secondary_index.value.hash
      range_key       = try(global_secondary_index.value.range, null)
      projection_type = "ALL"
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
