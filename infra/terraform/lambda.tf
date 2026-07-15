# Empaqueta y crea TODAS las funciones descubiertas en lambdas_dir (una por carpeta).
# El código se zipea desde la carpeta; el CD de código (deploy-lambdas.yml) puede
# seguir actualizando el código, o puedes dejar que Terraform lo haga en cada apply.

data "archive_file" "lambda" {
  for_each    = local.lambda_dirs
  type        = "zip"
  source_dir  = "${var.lambdas_dir}/${each.value}"
  output_path = "${path.module}/.build/${each.value}.zip"
  excludes    = ["__pycache__", "*.pyc"]
}

# --- Layer de PyJWT (opcional) ------------------------------------------------
resource "aws_lambda_layer_version" "pyjwt" {
  count               = var.pyjwt_layer_zip == "" ? 0 : 1
  layer_name          = "${var.project}-pyjwt"
  filename            = var.pyjwt_layer_zip
  source_code_hash    = filebase64sha256(var.pyjwt_layer_zip)
  compatible_runtimes = ["python3.9", "python3.11"]
}

resource "aws_lambda_function" "this" {
  for_each = local.lambda_dirs

  function_name    = each.value
  role             = aws_iam_role.lambda_exec.arn
  runtime          = lookup(local.lambda_runtime_override, each.value, var.lambda_runtime)
  handler          = "lambda_function.lambda_handler"
  filename         = data.archive_file.lambda[each.value].output_path
  source_code_hash = data.archive_file.lambda[each.value].output_base64sha256
  timeout          = var.lambda_timeout
  memory_size      = var.lambda_memory

  # Adjunta el layer de PyJWT solo a las funciones que lo necesitan (si existe).
  layers = (var.pyjwt_layer_zip != "" && contains(local.jwt_functions, each.value)) ? [aws_lambda_layer_version.pyjwt[0].arn] : []

  environment {
    variables = merge(local.common_env, local.queue_env)
  }

  # El código puede actualizarse por fuera (deploy-lambdas.yml). Descomenta para
  # que Terraform NO pise el código en cada apply y solo gestione la config:
  # lifecycle {
  #   ignore_changes = [filename, source_code_hash]
  # }
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambda_dirs
  name              = "/aws/lambda/${each.value}"
  retention_in_days = 30
}
