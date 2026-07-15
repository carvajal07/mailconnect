# Verificación de dominio en SES (opcional). Si ses_domain está vacío, no gestiona SES.
# NOTA: sacar SES del sandbox y verificar el dominio requiere pasos manuales/soporte AWS;
# esto solo crea la identidad de dominio y los tokens DKIM para que agregues los DNS.

resource "aws_ses_domain_identity" "this" {
  count  = var.ses_domain == "" ? 0 : 1
  domain = var.ses_domain
}

resource "aws_ses_domain_dkim" "this" {
  count  = var.ses_domain == "" ? 0 : 1
  domain = aws_ses_domain_identity.this[0].domain
}

output "ses_dkim_tokens" {
  description = "Agrega estos 3 tokens como CNAME en tu DNS para verificar DKIM."
  value       = var.ses_domain == "" ? [] : aws_ses_domain_dkim.this[0].dkim_tokens
}

output "ses_domain_verification_token" {
  description = "Agrega este valor como TXT en _amazonses.<dominio> para verificar el dominio."
  value       = var.ses_domain == "" ? "" : aws_ses_domain_identity.this[0].verification_token
}
