// Configuración de URLs del backend
// La base de la API se toma de la variable de entorno VITE_API_BASE_URL
// (crea un archivo .env con VITE_API_BASE_URL=... ) o usa el valor por defecto.
//
// Los endpoints de este archivo son RELATIVOS a la base (ej. "/login",
// "/create-template", "/email/config/create-campaign"). Por eso la base debe
// incluir TODO lo anterior a esas rutas. Si tus recursos en API Gateway están
// bajo "/api", la base termina en "/api".
//   Dominio propio (prod):  https://api.mailconnect.com.co/V1/api
//   Stage de pruebas:       https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api

/** Base de la API (se le quita la barra final para no duplicar "/"). */
export const AUTH_API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  'https://mtgt9qpb77.execute-api.us-east-1.amazonaws.com/Test/api'
).replace(/\/+$/, '');

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

// NOTA: los módulos del panel usan la capa de servicios (services/*.ts), que solo
// llama a endpoints REALES del backend. Los marcados como (⚠️ no existe aún) son
// placeholders sin lambda desplegada; la UI los deshabilita hasta que existan.
export const API_CONFIG = {
  // URL base (para módulos de negocio del panel).
  BASE_URL: AUTH_API_BASE,

  // Endpoints de Clientes (los clientes son usuarios; solo hay registro real).
  CLIENTS: {
    REGISTER: '/register',            // ✅ real (Api_V1_Security_Register)
    LIST: '/clients/list',            // ⚠️ no existe aún
    GET_BY_ID: '/clients/:id',        // ⚠️ no existe aún
    UPDATE: '/clients/:id',           // ⚠️ no existe aún
    DELETE: '/clients/:id',           // ⚠️ no existe aún
    SEARCH: '/clients/search',        // ⚠️ no existe aún
  },

  // Endpoints de Plantillas (ver services/templatesService.ts)
  TEMPLATES: {
    CREATE: '/create-template',       // ✅ real
    GET: '/get-template',             // ✅ real
    DELETE: '/delete-template',       // ✅ real
    LIST: '/templates/list',          // ⚠️ no existe aún
    UPDATE: '/templates/update',      // ⚠️ no existe aún
    SEARCH: '/templates/search',      // ⚠️ no existe aún
  },

  // Endpoints de Campañas (ver services/campaignsService.ts)
  CAMPAIGNS: {
    CREATE: '/email/config/create-campaign',       // ✅ real
    LIST: '/campaigns/list',                       // ⚠️ no existe aún
    GET_BY_CLIENT: '/campaigns/client/:clientId',  // ⚠️ no existe aún
    UPDATE: '/campaigns/:id',                      // ⚠️ no existe aún
    DELETE: '/campaigns/:id',                      // ⚠️ no existe aún
    SEND_SAMPLES: '/campaigns/send-samples',       // ⚠️ no existe aún
    SEND_REAL: '/campaigns/send-real',             // ⚠️ no existe aún
  },

  // Endpoints de archivos
  FILES: {
    PRESIGN_URL: '/get-urlS3',        // ✅ real
    UPLOAD: '/files/upload',          // ⚠️ no existe aún (se usa PUT prefirmado)
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
