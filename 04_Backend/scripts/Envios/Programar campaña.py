import boto3
import datetime

def create_scheduled_event(event_name, function_arn, schedule_time):
    # Creamos un cliente de CloudWatch Events
    events_client = boto3.client('events')

    # Formateamos la fecha y hora en el formato necesario para la regla de evento
    schedule_time_formatted = schedule_time.strftime('%Y-%m-%dT%H:%M:%SZ')

    # Creamos la regla de evento en CloudWatch Events
    response = events_client.put_rule(
        Name=event_name,
        ScheduleExpression='cron({})'.format(schedule_time_formatted),
        State='ENABLED'
    )

    # Configuramos la acción de la regla para que invoque la función Lambda
    events_client.put_targets(
        Rule=event_name,
        Targets=[
            {
                'Id': '1',
                'Arn': function_arn
            }
        ]
    )

    print("Regla de evento creada correctamente")

# Nombre de la regla de evento
event_name = 'ScheduledEvent'

# ARN de la función Lambda que queremos invocar
function_arn = 'ARN_DE_TU_FUNCION_LAMBDA'

# Fecha y hora en la que queremos que se ejecute el evento
scheduled_time = datetime.datetime(2024, 2, 15, 21, 0, 0)  # Ejemplo: 15 de febrero de 2024, 9:00 PM

# Creamos el evento programado
create_scheduled_event(event_name, function_arn, scheduled_time)

def create_scheduled_event(event_name, function_arn, schedule_time):
    # Creamos un cliente de CloudWatch Events
    events_client = boto3.client('events')

    # Formateamos la fecha y hora en el formato necesario para la regla de evento
    schedule_time_formatted = schedule_time.strftime('%Y-%m-%dT%H:%M:%SZ')

    # JSON que se pasará como entrada a la función Lambda
    input_json = {
        "key1": "value1",
        "key2": "value2"
    }

    # Creamos la regla de evento en CloudWatch Events con la entrada especificada
    response = events_client.put_rule(
        Name=event_name,
        ScheduleExpression='cron({})'.format(schedule_time_formatted),
        State='ENABLED',
        # Aquí definimos el JSON de entrada para la función Lambda
        Description='Event triggered at {}'.format(schedule_time_formatted),
        EventBusName='default',
        RoleArn='<role_arn>',
        Tags={
            'Name': 'MyScheduledEvent'
        }
    )

    # Configuramos la acción de la regla para que invoque la función Lambda
    events_client.put_targets(
        Rule=event_name,
        Targets=[
            {
                'Id': '1',
                'Arn': function_arn,
                # Aquí pasamos el JSON de entrada a la función Lambda
                'Input': json.dumps(input_json)
            }
        ]
    )

    print("Regla de evento creada correctamente")