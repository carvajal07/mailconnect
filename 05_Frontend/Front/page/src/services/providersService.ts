import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN del PROVEEDOR de envío por canal (tabla `providerConfig`).
 *
 * Modelo: cada canal (EMAIL/SMS/WSP/VOZ) tiene un proveedor GLOBAL (customerId `*`,
 * default aws) y, opcionalmente, un override POR CLIENTE. Prepare-batch resuelve
 * (cliente → global → aws) y el proveedor viaja en el mensaje SQS; el worker del canal
 * despacha al adaptador (AWS, Twilio, Infobip, SocketLabs).
 *
 * ⚠️ La MATRIZ de capacidades viene del backend (`capabilities`): el desplegable solo
 * ofrece proveedores con adaptador implementado. No duplicarla aquí — si divergieran, la
 * UI ofrecería opciones que el envío no sabe cumplir.
 *
 * Endpoints (no-proxy, envelope estándar, admin-only):
 *  - POST /Provider/List → { capabilities, labels, defaultProvider, global, overrides }
 *  - POST /Provider/Set  → upsert { customerId?, channel, provider } o herencia (remove)
 */

export const PROVIDER_ENDPOINTS = {
  LIST: '/Provider/List',
  SET: '/Provider/Set',
};

export type ProviderChannel = 'EMAIL' | 'SMS' | 'WSP' | 'VOZ';

export interface ProviderOverride {
  customerId: string;
  channel: string;
  provider: string;
  updatedAt?: string;
}

export interface ProviderListData {
  capabilities?: Record<string, string[]>;
  labels?: Record<string, string>;
  defaultProvider?: string;
  global?: Record<string, string>;
  overrides?: ProviderOverride[];
  count?: number;
}

export const providersService = {
  /** Matriz de capacidades + configuración global y overrides por cliente (admin). */
  list: (): Promise<ApiResponse<ProviderListData>> => apiPost(PROVIDER_ENDPOINTS.LIST, {}),

  /** Fija el proveedor de un canal. Sin `customerId` aplica al GLOBAL (`*`). */
  set: (channel: ProviderChannel, provider: string, customerId?: string):
    Promise<ApiResponse<{ channel?: string; provider?: string }>> =>
    apiPost(PROVIDER_ENDPOINTS.SET, { channel, provider, ...(customerId ? { customerId } : {}) }),

  /** Quita la fila → el canal vuelve a HEREDAR (el cliente al global; el global a aws). */
  inherit: (channel: ProviderChannel, customerId?: string):
    Promise<ApiResponse<{ removed?: boolean }>> =>
    apiPost(PROVIDER_ENDPOINTS.SET, { channel, remove: true, ...(customerId ? { customerId } : {}) }),
};
