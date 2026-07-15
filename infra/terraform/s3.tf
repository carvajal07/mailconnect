# Bucket de salida para reportes/combinaciones (opcional).
# Los buckets por-tenant ({customer}.database, {customer} adjuntos, …) los usan las
# lambdas por cliente; créalos aparte o parametrízalos si los quieres en Terraform.

resource "aws_s3_bucket" "output" {
  count  = var.output_bucket == "" ? 0 : 1
  bucket = var.output_bucket
}

resource "aws_s3_bucket_public_access_block" "output" {
  count                   = var.output_bucket == "" ? 0 : 1
  bucket                  = aws_s3_bucket.output[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
