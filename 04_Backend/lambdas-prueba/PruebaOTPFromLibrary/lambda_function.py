import json
from OneTimePassword import createOTP
import OneTimePassword as otp

def lambda_handler(event, context):
    # TODO implement
    print("Nuevo:" + otp.createOTP("Auth","Jhon","1.45.32.56",5))
    print(createOTP("Auth","Jhon","1.45.32.56",5))
    return {
        'statusCode': 200,
        'body': json.dumps('Hello from Lambda!')
    }
