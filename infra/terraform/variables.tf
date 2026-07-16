variable "region" {
  description = "Región de AWS."
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Ambiente lógico (dev|test|prod). Solo para tags y nombres de stage."
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Prefijo/identificador del proyecto (para nombres de buckets globales, etc.)."
  type        = string
  default     = "mailconnect"
}

# ---------------------------------------------------------------------------
# API Gateway
# ---------------------------------------------------------------------------
variable "api_name" {
  description = "Nombre de la REST API en API Gateway."
  type        = string
  default     = "MailConnect-API"
}

variable "api_stage" {
  description = "Nombre del stage a desplegar (p. ej. V1, Dev, Test, prod)."
  type        = string
  default     = "V1"
}

variable "api_prefix" {
  description = "Prefijo de recursos bajo el root (V1 es un recurso). Debe casar con routes.json."
  type        = string
  default     = "/V1"
}

variable "cors_origin" {
  description = "Origen permitido para CORS. En prod, pon tu dominio del front (no '*')."
  type        = string
  default     = "*"
}

variable "routes_file" {
  description = "Ruta al catálogo de rutas (fuente de verdad compartida con el IaC ligero)."
  type        = string
  default     = "../api/routes.json"
}

# ---------------------------------------------------------------------------
# Lambdas
# ---------------------------------------------------------------------------
variable "lambdas_dir" {
  description = "Directorio con una carpeta por función (cada una con lambda_function.py)."
  type        = string
  default     = "../../04_Backend/lambdas"
}

variable "lambda_runtime" {
  description = "Runtime por defecto de las funciones Python."
  type        = string
  default     = "python3.11"
}

variable "lambda_timeout" {
  description = "Timeout (s) por defecto de las funciones."
  type        = number
  default     = 30
}

variable "lambda_memory" {
  description = "Memoria (MB) por defecto de las funciones."
  type        = number
  default     = 256
}

variable "pyjwt_layer_zip" {
  description = "Ruta a un .zip del layer con PyJWT (python/ dentro). Si es vacío, NO se crea el layer y los Authorizers/Login deben traer PyJWT por otro medio. Ver README."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Configuración funcional (env vars / secretos)
# ---------------------------------------------------------------------------
variable "secret_key" {
  description = "SECRET_KEY para firmar/validar JWT (HS256). Déjala vacía aquí y pásala por TF_VAR_secret_key o Secrets Manager. NO la commitees."
  type        = string
  default     = ""
  sensitive   = true
}

variable "sender_email" {
  description = "Remitente SES por defecto."
  type        = string
  default     = "comunicaciones@mailconnect.com.co"
}

variable "activation_url" {
  description = "URL pública de activación de cuenta (va en el correo de registro)."
  type        = string
  default     = "https://api.mailconnect.com.co/V1/Security/Acount-activation"
}

variable "activation_success_url" {
  type    = string
  default = "https://app.mailconnect.com.co/login?activated=1"
}

variable "activation_error_url" {
  type    = string
  default = "https://app.mailconnect.com.co/login?activated=0"
}

variable "activation_expired_url" {
  type    = string
  default = "https://app.mailconnect.com.co/login?activated=expired"
}

variable "unsubscribe_url" {
  type    = string
  default = "https://api.mailconnect.com.co/V1/Email/Unsubscribe"
}

variable "otp_expiration_min" {
  type    = string
  default = "5"
}

variable "token_ttl_days" {
  type    = string
  default = "1"
}

# Canales (End User Messaging) — opcionales; se dejan como env para las lambdas de envío.
variable "channel_env" {
  description = "Env vars de canales SMS/WhatsApp/Voz (orígenes, configuration sets, etc.)."
  type        = map(string)
  default     = {}
}

# Wompi (recarga PREPAGO). Claves de la pasarela. Pásalas por TF_VAR_wompi_env o tfvars;
# NO las commitees. Claves esperadas: WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY,
# WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET, WOMPI_REDIRECT_URL, WOMPI_CURRENCY, MIN_TOPUP.
# ⚠️ Pendiente moverlas a AWS Secrets Manager.
variable "wompi_env" {
  description = "Env vars de Wompi (llaves de la pasarela + config de recarga)."
  type        = map(string)
  default     = {}
  sensitive   = true
}

# ---------------------------------------------------------------------------
# SES / dominio
# ---------------------------------------------------------------------------
variable "ses_domain" {
  description = "Dominio a verificar en SES (vacío = no gestionar SES desde Terraform)."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------
variable "output_bucket" {
  description = "Bucket de salida para reportes/combinaciones (vacío = no crear)."
  type        = string
  default     = ""
}
