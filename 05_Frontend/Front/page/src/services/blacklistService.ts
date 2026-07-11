import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de LISTA NEGRA por cliente (contactos que NO deben recibir envíos).
 * La tabla es {customer}_blackList (PK 'email'); el backend la resuelve por el
 * nombre de empresa del token. Prepare-batch filtra contra ella en el envío real.
 *
 * Endpoints (no-proxy, envelope estándar):
 *  - POST /Blacklist/List   -> 200 { data: { items, count } }
 *  - POST /Blacklist/Add    -> 201 (agrega un contacto)
 *  - POST /Blacklist/Delete -> 200 (quita un contacto)
 */

export const BLACKLIST_ENDPOINTS = {
  LIST: '/Blacklist/List',
  ADD: '/Blacklist/Add',
  DELETE: '/Blacklist/Delete',
};

export interface BlacklistItem {
  email: string; // el contacto (correo o celular)
  rejectionType?: string;
  description?: string;
  date?: string;
}

export const blacklistService = {
  list: (customerId: string, customer?: string): Promise<ApiResponse<{ items?: BlacklistItem[]; count?: number }>> =>
    apiPost(BLACKLIST_ENDPOINTS.LIST, { customerId, customer }),

  add: (email: string, reason?: string): Promise<ApiResponse> =>
    apiPost(BLACKLIST_ENDPOINTS.ADD, { email, reason }),

  remove: (email: string): Promise<ApiResponse> =>
    apiPost(BLACKLIST_ENDPOINTS.DELETE, { email }),
};
