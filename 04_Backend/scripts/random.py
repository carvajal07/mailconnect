import random

def generar_codigo_alfanumerico_con_semilla(semilla, longitud=5):
    random.seed(semilla)
    caracteres = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    codigo = ''.join(random.choice(caracteres) for _ in range(longitud))
    return codigo

# Ejemplo de uso con semilla
semilla = 12345
codigo_generado = generar_codigo_alfanumerico_con_semilla(semilla)
print("Código alfanumérico generado con semilla:", codigo_generado)