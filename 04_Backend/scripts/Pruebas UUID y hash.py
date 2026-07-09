import uuid
import bcrypt
#from passlib.context import CryptContext

# Configurar el contexto de hash con salt (bcrypt en este ejemplo)
# Configuración de Passlib para bcrypt
PWD_CONTEXT = bcrypt
#PWD_CONTEXT = CryptContext(schemes=["bcrypt"], deprecated="auto")

password = 'jdshhfgyafds'

customerId = str(uuid.uuid4())
userDataId = str(uuid.uuid4())
userId = str(uuid.uuid4())

# Generar un salt aleatorio
#salt = str(uuid.uuid4())
salt = bcrypt.gensalt() 

bytes = password.encode('utf-8') 
# Generar hash de la contraseña con salt
hashed_password = bcrypt.hashpw(bytes, salt)

print("Customer:" + customerId)
print("userData:" + userDataId)
print("user:" + userId)

print("salt:" + str(salt))
print("hash:" + str(hashed_password))