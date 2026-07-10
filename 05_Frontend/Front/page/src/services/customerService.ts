import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de clientes (tabla `customer`). Lista los clientes y permite
 * habilitar/deshabilitar sus envíos reales.
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - POST /Customer/List   -> 200 { data: { customers, count } }
 *  - POST /Customer/Update -> 200 (toggle realSendEnabled)
 *
 * ⚠️ Son endpoints administrativos (devuelven/afectan todos los clientes); deben
 * quedar restringidos a un rol admin en el despliegue.
 */

export const CUSTOMER_ENDPOINTS = {
  LIST: '/Customer/List',
  UPDATE: '/Customer/Update',
};

export interface CustomerSummary {
  customerId: string;
  company: string;
  companyTin?: string | number;
  realSendEnabled: boolean;
  date?: string;
}

export const customerService = {
  /** Lista todos los clientes (admin). */
  list: (): Promise<ApiResponse<{ customers?: CustomerSummary[]; count?: number }>> =>
    apiPost(CUSTOMER_ENDPOINTS.LIST, {}),

  /** Habilita/deshabilita los envíos reales de un cliente (admin). */
  setRealSendEnabled: (
    customerId: string,
    realSendEnabled: boolean,
  ): Promise<ApiResponse<{ customerId?: string; realSendEnabled?: boolean }>> =>
    apiPost(CUSTOMER_ENDPOINTS.UPDATE, { customerId, realSendEnabled }),
};
