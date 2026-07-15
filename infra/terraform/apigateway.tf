# REST API cuyas rutas salen del MISMO routes.json que usa el IaC ligero.
# Añade una ruta ahí → Terraform (y el workflow) la crean. Una sola fuente de verdad.

resource "aws_api_gateway_rest_api" "this" {
  name = var.api_name
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

# --- Árbol de recursos (crea /V1, /V1/Customer, /V1/Customer/List, …) ----------
locals {
  route_full_paths = [for r in local.routes : r.path]

  # Todos los prefijos acumulados de cada ruta (segmentos del árbol).
  resource_paths = toset(flatten([
    for p in local.route_full_paths : [
      for i in range(length(split("/", trimprefix(p, "/")))) :
      "/${join("/", slice(split("/", trimprefix(p, "/")), 0, i + 1))}"
    ]
  ]))

  resource_meta = {
    for rp in local.resource_paths : rp => {
      part = element(split("/", rp), length(split("/", rp)) - 1)
      parent = (
        length(split("/", trimprefix(rp, "/"))) == 1
        ? "" # hijo directo del root
        : "/${join("/", slice(split("/", trimprefix(rp, "/")), 0, length(split("/", trimprefix(rp, "/"))) - 1))}"
      )
    }
  }

  # Rutas que necesitan OPTIONS de preflight (CORS).
  cors_paths = toset([for r in local.routes : r.path if r.cors])

  # Lambdas únicas referenciadas por rutas (para el permiso de invocación).
  route_lambdas = toset([for r in local.routes : r.lambda])
}

resource "aws_api_gateway_resource" "this" {
  for_each    = local.resource_meta
  rest_api_id = aws_api_gateway_rest_api.this.id
  parent_id   = each.value.parent == "" ? aws_api_gateway_rest_api.this.root_resource_id : aws_api_gateway_resource.this[each.value.parent].id
  path_part   = each.value.part
}

# --- Authorizer (REQUEST, identity source header 'token') ----------------------
resource "aws_api_gateway_authorizer" "this" {
  name                             = "${var.project}-authorizer"
  rest_api_id                      = aws_api_gateway_rest_api.this.id
  type                             = "REQUEST"
  identity_source                  = "method.request.header.token"
  authorizer_uri                   = aws_lambda_function.this["Authorizer"].invoke_arn
  authorizer_result_ttl_in_seconds = 0
}

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "apigw-invoke-authorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["Authorizer"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/authorizers/${aws_api_gateway_authorizer.this.id}"
}

# --- Métodos + integraciones por ruta -----------------------------------------
resource "aws_api_gateway_method" "route" {
  for_each         = { for r in local.routes : r.key => r }
  rest_api_id      = aws_api_gateway_rest_api.this.id
  resource_id      = aws_api_gateway_resource.this[each.value.path].id
  http_method      = each.value.method
  authorization    = each.value.auth ? "CUSTOM" : "NONE"
  authorizer_id    = each.value.auth ? aws_api_gateway_authorizer.this.id : null
  api_key_required = false
}

resource "aws_api_gateway_integration" "route" {
  for_each                = { for r in local.routes : r.key => r }
  rest_api_id             = aws_api_gateway_rest_api.this.id
  resource_id             = aws_api_gateway_resource.this[each.value.path].id
  http_method             = aws_api_gateway_method.route[each.key].http_method
  integration_http_method = "POST"
  type                    = each.value.proxy ? "AWS_PROXY" : "AWS"
  uri                     = aws_lambda_function.this[each.value.lambda].invoke_arn

  # Mapping template de rol/tenant solo para rutas admin no-proxy.
  request_templates = (!each.value.proxy && each.value.admin) ? {
    "application/json" = replace(local.admin_template, "\"__BODY__\"", "$input.json('$')")
  } : null
  passthrough_behavior = (!each.value.proxy && each.value.admin) ? "WHEN_NO_TEMPLATES" : null
}

# method/integration response 200 para las no-proxy (proxy controla su propia respuesta).
resource "aws_api_gateway_method_response" "route_200" {
  for_each    = { for r in local.routes : r.key => r if !r.proxy }
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value.path].id
  http_method = aws_api_gateway_method.route[each.key].http_method
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = true
  }
}

resource "aws_api_gateway_integration_response" "route_200" {
  for_each    = { for r in local.routes : r.key => r if !r.proxy }
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value.path].id
  http_method = aws_api_gateway_method.route[each.key].http_method
  status_code = aws_api_gateway_method_response.route_200[each.key].status_code
  response_parameters = {
    "method.response.header.Access-Control-Allow-Origin" = "'${var.cors_origin}'"
  }
  depends_on = [aws_api_gateway_integration.route]
}

resource "aws_lambda_permission" "route" {
  for_each      = local.route_lambdas
  statement_id  = "apigw-invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[each.value].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.this.execution_arn}/*/*"
}

# --- OPTIONS de preflight (CORS) por recurso ----------------------------------
resource "aws_api_gateway_method" "options" {
  for_each      = local.cors_paths
  rest_api_id   = aws_api_gateway_rest_api.this.id
  resource_id   = aws_api_gateway_resource.this[each.value].id
  http_method   = "OPTIONS"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "options" {
  for_each             = local.cors_paths
  rest_api_id          = aws_api_gateway_rest_api.this.id
  resource_id          = aws_api_gateway_resource.this[each.value].id
  http_method          = "OPTIONS"
  type                 = "MOCK"
  request_templates    = { "application/json" = "{\"statusCode\": 200}" }
  passthrough_behavior = "WHEN_NO_MATCH"
}

resource "aws_api_gateway_method_response" "options" {
  for_each    = local.cors_paths
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value].id
  http_method = "OPTIONS"
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = true
    "method.response.header.Access-Control-Allow-Methods" = true
    "method.response.header.Access-Control-Allow-Origin"  = true
  }
}

resource "aws_api_gateway_integration_response" "options" {
  for_each    = local.cors_paths
  rest_api_id = aws_api_gateway_rest_api.this.id
  resource_id = aws_api_gateway_resource.this[each.value].id
  http_method = "OPTIONS"
  status_code = "200"
  response_parameters = {
    "method.response.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,token'"
    "method.response.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
    "method.response.header.Access-Control-Allow-Origin"  = "'${var.cors_origin}'"
  }
  depends_on = [aws_api_gateway_integration.options]
}

# --- CORS en respuestas de error (para no enmascarar 4xx/5xx como CORS) --------
resource "aws_api_gateway_gateway_response" "cors_4xx" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "DEFAULT_4XX"
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.cors_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
  }
}

resource "aws_api_gateway_gateway_response" "cors_5xx" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  response_type = "DEFAULT_5XX"
  response_parameters = {
    "gatewayresponse.header.Access-Control-Allow-Origin"  = "'${var.cors_origin}'"
    "gatewayresponse.header.Access-Control-Allow-Headers" = "'Content-Type,Authorization,token'"
    "gatewayresponse.header.Access-Control-Allow-Methods" = "'POST,OPTIONS'"
  }
}

# --- Deployment + stage --------------------------------------------------------
resource "aws_api_gateway_deployment" "this" {
  rest_api_id = aws_api_gateway_rest_api.this.id

  triggers = {
    # Redepliega cuando cambia el catálogo de rutas o la config de este archivo.
    routes = filesha1(var.routes_file)
    hash   = filesha1("${path.module}/apigateway.tf")
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.route,
    aws_api_gateway_integration.options,
    aws_api_gateway_integration_response.route_200,
    aws_api_gateway_integration_response.options,
  ]
}

resource "aws_api_gateway_stage" "this" {
  rest_api_id   = aws_api_gateway_rest_api.this.id
  deployment_id = aws_api_gateway_deployment.this.id
  stage_name    = var.api_stage
}
