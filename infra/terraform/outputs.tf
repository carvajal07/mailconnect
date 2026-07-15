output "account_id" {
  value = local.account_id
}

output "api_id" {
  description = "Id de la REST API (úsalo como Variable API_ID del IaC ligero si quieres reusar el workflow)."
  value       = aws_api_gateway_rest_api.this.id
}

output "authorizer_id" {
  description = "Id del Lambda authorizer (para la Variable AUTHORIZER_ID del IaC ligero)."
  value       = aws_api_gateway_authorizer.this.id
}

output "invoke_url" {
  description = "URL base del stage."
  value       = "https://${aws_api_gateway_rest_api.this.id}.execute-api.${var.region}.amazonaws.com/${var.api_stage}"
}

output "lambda_functions" {
  description = "Funciones creadas."
  value       = sort([for f in aws_lambda_function.this : f.function_name])
}

output "dynamodb_tables" {
  value = sort([for t in aws_dynamodb_table.this : t.name])
}

output "queues" {
  value = { for k, q in aws_sqs_queue.this : k => q.url }
}
