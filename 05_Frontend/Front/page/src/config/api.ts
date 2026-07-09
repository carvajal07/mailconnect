// Configuración de URLs del backend
// La base de la API se toma de la variable de entorno VITE_API_BASE_URL
// (crea un archivo .env con VITE_API_BASE_URL=... ) o usa el valor por defecto.
//
// Estructura real de la API (API Gateway): base .../V1 + rutas agrupadas por módulo
// en PascalCase, ej. /V1/Security/Login, /V1/Template/Create-template,
// /V1/Campaign/Prefirm-url, /V1/Email/Send-batch-template-samples, /V1/Report.
// Los endpoints de este archivo son RELATIVOS a la base (sin la parte /V1).

/** Base de la API (se le quita la barra final para no duplicar "/"). */
export const AUTH_API_BASE = (
  import.meta.env.VITE_API_BASE_URL ??
  'https://api.mailconnect.com.co/V1'
).replace(/\/+$/, '');

/** Endpoints de seguridad (módulo /Security). */
export const AUTH_ENDPOINTS = {
  LOGIN: '/Security/Login',
  REGISTER: '/Security/Register',
  LOGOUT: '/Security/Logout',
  VERIFY_CODE: '/Security/Verify-code',
  ACCOUNT_ACTIVATION: '/Security/Acount-activation',
  FORGOT_PASSWORD: '/Security/Recovery-password',
  CHANGE_PASSWORD: '/Security/Change-password',
  CREATE_OTP: '/Security/Create-otp',
  VALIDATE_OTP: '/Security/Validate-otp',
  REFRESH_TOKEN: '/Security/Refresh-token',
};

// NOTA: los módulos del panel usan la capa de servicios (services/*.ts), que solo
// llama a endpoints REALES del backend. Los marcados como (⚠️ no existe aún) son
// placeholders sin lambda desplegada; la UI los deshabilita hasta que existan.
export const API_CONFIG = {
  // URL base (para módulos de negocio del panel).
  BASE_URL: AUTH_API_BASE,

  // Endpoints de Clientes (los clientes son usuarios; solo hay registro real).
  CLIENTS: {
    REGISTER: '/Security/Register',   // ✅ real
    LIST: '/clients/list',            // ⚠️ no existe aún
    GET_BY_ID: '/clients/:id',        // ⚠️ no existe aún
    UPDATE: '/clients/:id',           // ⚠️ no existe aún
    DELETE: '/clients/:id',           // ⚠️ no existe aún
    SEARCH: '/clients/search',        // ⚠️ no existe aún
  },

  // Endpoints de Plantillas (ver services/templatesService.ts)
  TEMPLATES: {
    CREATE: '/Template/Create-template',  // ✅ real
    GET: '/Template/Get-template',        // ✅ real
    DELETE: '/Template/Delete-template',  // ✅ real
    LIST: '/templates/list',              // ⚠️ no existe aún
    UPDATE: '/templates/update',          // ⚠️ no existe aún
    SEARCH: '/templates/search',          // ⚠️ no existe aún
  },

  // Endpoints de Campañas (ver services/campaignsService.ts)
  CAMPAIGNS: {
    CREATE: '/Campaign/Create-campaign',            // ✅ real
    SEND_SAMPLES: '/Email/Send-batch-template-samples', // ✅ real (ruta existe)
    LIST: '/campaigns/list',                        // ⚠️ no existe aún
    GET_BY_CLIENT: '/campaigns/client/:clientId',   // ⚠️ no existe aún
    UPDATE: '/campaigns/:id',                       // ⚠️ no existe aún
    DELETE: '/campaigns/:id',                       // ⚠️ no existe aún
    SEND_REAL: '/Email/Send-batch-template',        // ⚠️ ruta existe; lambda por confirmar
  },

  // Endpoints de archivos
  FILES: {
    PRESIGN_URL: '/Campaign/Prefirm-url', // ✅ real (URL prefirmada de S3)
    UPLOAD: '/files/upload',              // ⚠️ no existe aún (se usa PUT prefirmado)
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
