from faker import Faker
import csv
import random

# Inicializar el generador de datos Faker
faker = Faker()

def generar_registro():
    identificacion = faker.random_number(digits=10)
    nombre = faker.name()
    correo = faker.email()
    celular = faker.random_number(digits=10)
    factura = faker.random_number(digits=8)
    opcional1 = faker.word()
    opcional2 = faker.word()
    return [identificacion, nombre, correo, celular, factura, opcional1, opcional2]

# Generar datos de ejemplo
cantidad_registros = 100000
# Nombre del archivo CSV
nombre_archivo = "D:\ProyectoComunicaciones\ArchivoPruebas_100000Registros.csv"
# Abrir el archivo en modo de escritura
with open(nombre_archivo, mode='w', newline='') as archivo_csv:
    # Crear un objeto escritor CSV
    escritor_csv = csv.writer(archivo_csv,delimiter=';')
    # Escribir encabezados
    escritor_csv.writerow(["Identificacion","Nombre","Correo","Celular","Factura","Opcional1","Opcional2"])

    for _ in range(cantidad_registros):            
        escritor_csv.writerow(generar_registro())