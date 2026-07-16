data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = var.region

  # --- Descubrimiento de funciones -------------------------------------------
  # Cada subcarpeta de lambdas_dir con un lambda_function.py es una función.
  lambda_dirs = toset([
    for d in fileset(var.lambdas_dir, "*/lambda_function.py") : dirname(d)
  ])

  # Runtime por función (override del default). CombinacionPython3-9 va en 3.9.
  lambda_runtime_override = {
    "CombinacionPython3-9" = "python3.9"
  }

  # Funciones que necesitan el layer de PyJWT (firman/validan JWT).
  jwt_functions = toset([
    "Authorizer",
    "Authorizer2",
    "Api_V1_Security_Login",
    "Api_V1_Security_Register",
    "Api_V1_Security_Change-password",
    "Api_V1_Security_Refresh-token",
    "Api_V1_Security_Logout",
    "Api_V1_Email_Unsubscribe",
    "Api_V1_Email_Send-batch-template-EM",
    "Api_V1_Email_Send-batch-template-EAU",
  ])

  # Env vars comunes a todas las funciones (las que no la usan, la ignoran).
  common_env = merge({
    SECRET_KEY             = var.secret_key
    SENDER_EMAIL           = var.sender_email
    ACTIVATION_URL         = var.activation_url
    ACTIVATION_SUCCESS_URL = var.activation_success_url
    ACTIVATION_ERROR_URL   = var.activation_error_url
    ACTIVATION_EXPIRED_URL = var.activation_expired_url
    UNSUBSCRIBE_URL        = var.unsubscribe_url
    OTP_EXPIRATION_MIN     = var.otp_expiration_min
    TOKEN_TTL_DAYS         = var.token_ttl_days
  }, var.channel_env, var.wompi_env)

  # --- Rutas de API (fuente de verdad compartida con el IaC ligero) ----------
  routes_catalog = jsondecode(file(var.routes_file))
  route_prefix   = coalesce(var.api_prefix, try(local.routes_catalog.prefix, "/V1"))
  routes = [
    for r in local.routes_catalog.routes : {
      key    = replace("${local.route_prefix}${r.path}", "/", "_")
      path   = "${local.route_prefix}${r.path}"
      lambda = r.lambda
      method = upper(try(r.method, "POST"))
      admin  = try(r.admin, false)
      auth   = try(r.auth, true)
      proxy  = try(r.proxy, false)
      cors   = try(r.cors, true)
    }
  ]

  # Mapping template no-proxy: body como objeto + context del Authorizer (rol/tenant).
  admin_template = jsonencode({
    body = "__BODY__"
    requestContext = {
      authorizer = {
        role       = "$context.authorizer.role"
        user       = "$context.authorizer.user"
        userId     = "$context.authorizer.userId"
        customerId = "$context.authorizer.customerId"
        customer   = "$context.authorizer.customer"
      }
    }
  })
}
