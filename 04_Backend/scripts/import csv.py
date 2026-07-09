import csv

def leer_csv(nombre_archivo):
    with open(nombre_archivo, newline='') as archivo_csv:
        lector_csv = csv.reader(archivo_csv, delimiter=';')
        
        # Lee la primera fila para obtener los nombres de los campos
        nombres_campos = next(lector_csv, None)
        if not nombres_campos:
            print("El archivo CSV está vacío.")
            return
        
        # Itera sobre las filas restantes
        for fila in lector_csv:
            # Procesa cada campo de la fila
            for nombre_campo, valor_campo in zip(nombres_campos, fila):
                prueba = f'{{"{nombre_campo}":"{valor_campo}"}}'
                print(prueba)
                print(f"{nombre_campo}: {valor_campo}")
            print()  # Agrega una línea en blanco entre las filas

# Ejemplo de uso
nombre_archivo = 'D:\ProyectoComunicaciones\ArchivoPruebas_10Registros.csv'
leer_csv(nombre_archivo)