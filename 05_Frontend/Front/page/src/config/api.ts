// Configuración de URLs del backend
// La base de la API se toma de la variable de entorno VITE_API_BASE_URL
// (crea un archivo .env con VITE_API_BASE_URL=... ) o usa el valor por defecto.

/** Base de la API de seguridad/autenticación (AWS API Gateway). */
export const AUTH_API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api';

/** Endpoints de seguridad (login, registro, activación, OTP, etc.). */
export const AUTH_ENDPOINTS = {
  LOGIN: '/login',
  REGISTER: '/register',
  LOGOUT: '/logout',
  VERIFY_CODE: '/verify-code',
  VERIFY_EMAIL: '/verify-email', // + /{token}
  FORGOT_PASSWORD: '/forgot-password',
  CHANGE_PASSWORD: '/change-password',
  CREATE_OTP: '/create-otp',
  VALIDATE_OTP: '/validate-otp',
  REFRESH_TOKEN: '/token/refresh',
};

export const API_CONFIG = {
  // URL base (para módulos de negocio del panel).
  BASE_URL: AUTH_API_BASE,

  // Endpoints de Clientes
  CLIENTS: {
    REGISTER: '/clients/register',
    LIST: '/clients/list',
    GET_BY_ID: '/clients/:id',
    UPDATE: '/clients/:id',
    DELETE: '/clients/:id',
    SEARCH: '/clients/search',
  },

  // Endpoints de Plantillas
  TEMPLATES: {
    CREATE: '/create-template',
    LIST: '/templates/list',
    GET: '/get-template',
    UPDATE: '/templates/update',
    DELETE: '/delete-template',
    SEARCH: '/templates/search',
  },

  // Endpoints de Campañas
  CAMPAIGNS: {
    CREATE: '/email/config/create-campaign',
    LIST: '/campaigns/list',
    GET_BY_CLIENT: '/campaigns/client/:clientId',
    UPDATE: '/campaigns/:id',
    DELETE: '/campaigns/:id',
    SEND_SAMPLES: '/campaigns/send-samples',
    SEND_REAL: '/campaigns/send-real',
  },

  // Endpoints de archivos
  FILES: {
    PRESIGN_URL: '/get-urlS3',
    UPLOAD: '/files/upload',
  },
};

// Helper para construir URLs completas
export const buildUrl = (endpoint: string, params?: Record<string, string>) => {
  let url = `${API_CONFIG.BASE_URL}${endpoint}`;

  if (params) {
    Object.keys(params).forEach(key => {
      url = url.replace(`:${key}`, params[key]);
    });
  }

  return url;
};
