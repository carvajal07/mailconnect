import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de IP de envío dedicada por cliente (tabla `sendingConfig`).
 *
 * Modelo: un cliente que NO está aquí (o está deshabilitado) envía por el pool GENERAL
 * (config set por defecto, por donde envían todos). Un cliente habilitado envía por SU
 * `configurationSet`, que en SES está cableado a su pool de IP dedicada. El ruteo real
 * lo aplican Prepare-batch (resuelve el config set) y Send-EM/EAU/EAP (lo pasan a SES).
 *
 * Endpoints (no-proxy, envelope estándar, admin-only):
 *  - POST /SendingConfig/List -> 200 { data: { configs, count } }
 *  - POST /SendingConfig/Set  -> 200 (upsert o baja con remove:true)
 */

export const SENDING_CONFIG_ENDPOINTS = {
  LIST: '/SendingConfig/List',
  SET: '/SendingConfig/Set',
};

export interface SendingConfig {
  customerId: string;
  configurationSet: string;
  poolName?: string;
  ips?: string[];
  enabled: boolean;
  notes?: string;
  updatedAt?: string;
}

export interface SendingConfigInput {
  customerId: string;
  configurationSet: string;
  poolName?: string;
  ips?: string[];
  enabled?: boolean;
  notes?: string;
}

export const sendingConfigService = {
  /** Lista la configuración de IP dedicada de todos los clientes que la tienen (admin). */
  list: (): Promise<ApiResponse<{ configs?: SendingConfig[]; count?: number }>> =>
    apiPost(SENDING_CONFIG_ENDPOINTS.LIST, {}),

  /** Crea o actualiza la IP dedicada de un cliente (admin). */
  set: (input: SendingConfigInput): Promise<ApiResponse<{ customerId?: string; configurationSet?: string }>> =>
    apiPost(SENDING_CONFIG_ENDPOINTS.SET, input),

  /** Quita la IP dedicada de un cliente → vuelve al pool general (admin). */
  remove: (customerId: string): Promise<ApiResponse<{ customerId?: string; removed?: boolean }>> =>
    apiPost(SENDING_CONFIG_ENDPOINTS.SET, { customerId, remove: true }),
};
