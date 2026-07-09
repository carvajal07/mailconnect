import json
import os

def lambda_handler(event, context):
    policy = {}
    statements = []
    permission = "Allow"
    
    statement = {
    "Effect": "Allow",
    "Action": "execute-api:Invoke",
    "Resource": "*"
    }
    
    statements.append(statement)
    
    policy = {
    'principalId': 'anonymous',
    'policyDocument': {
        'Version': '2012-10-17',
        'Statement': statements
    }
    }

    return policy