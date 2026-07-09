# Pruebas de seguridad (auth) — MailConnect

Pruebas de integración de las lambdas de seguridad, ejecutadas 100% en local con
[`moto`](https://docs.getmoto.org/) (mock de DynamoDB y SES). **No tocan AWS ni
envían correos reales**, así que puedes correrlas sin credenciales ni costo.

## Qué cubren

Flujo completo y casos de error de:

- `Api_V1_Security_Register` — registro (crea usuario inactivo + activación)
- `Api_V1_Security_Acount-activation` — activación de la cuenta
- `Api_V1_Security_Login` — inicio de sesión (token JWT)
- `Api_V1_Security_Create-otp` / `Validate-otp` — OTP
- `Api_V1_Security_Change-password` — cambio de contraseña (por OTP y por token)
- `Api_V1_Security_Logout` — cierre de sesión

## Cómo correrlas

```bash
cd 08_Pruebas/PruebasSeguridad

# (opcional) entorno virtual
python -m venv .venv && . .venv/Scripts/activate   # Windows
# python -m venv .venv && source .venv/bin/activate  # Linux/Mac

pip install -r requirements.txt
pytest -v
```

Deberías ver todas las pruebas en verde (`PASSED`).

## Cómo mantenerlas al día

Están pensadas para evolucionar con el backend:

- **Cada prueba crea su propio usuario** (email único), por lo que son
  independientes y puedes agregar/quitar casos sin romper las demás.
- Si **agregas o renombras** una lambda de seguridad, actualiza el diccionario
  `LAMBDA_FILES` en `test_seguridad.py`.
- Si **cambia el esquema** de una tabla (su clave primaria), actualiza `TABLES`.
- Las rutas se calculan desde la raíz del repo (`Path(__file__).parents[2]`), así
  que no dependen de la ubicación absoluta en tu disco.

## Notas

- El código OTP es aleatorio; en las pruebas se fija con `ctx.set_otp_code(...)`
  para poder validarlo.
- `SECRET_KEY` y `SENDER_EMAIL` se definen con valores de prueba dentro del test;
  no usan los reales.
