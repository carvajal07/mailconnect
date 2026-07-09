// Configuración de URLs del backend
// Modifica estas URLs con los endpoints reales de tu API

export const API_CONFIG = {
  // URLs base
  BASE_URL: 'http://localhost:3000/api', // Cambia esto por la URL real

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
    CREATE: '/templates/create',
    LIST: '/templates/list',
    GET: '/templates/get',
    UPDATE: '/templates/update',
    DELETE: '/templates/delete',
    SEARCH: '/templates/search',
  },

  // Endpoints de Campañas
  CAMPAIGNS: {
    CREATE: '/campaigns/create',
    LIST: '/campaigns/list',
    GET_BY_CLIENT: '/campaigns/client/:clientId',
    UPDATE: '/campaigns/:id',
    DELETE: '/campaigns/:id',
    SEND_SAMPLES: '/campaigns/send-samples',
    SEND_REAL: '/campaigns/send-real',
  },

  // Endpoints de archivos
  FILES: {
    PRESIGN_URL: '/files/presign-url',
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
