import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de CONFIGURACIÓN de plataforma (tabla platformConfig). Centraliza
 * ajustes globales que las lambdas leen con fallback a su variable de entorno.
 *
 * Endpoints (no-proxy, envelope estándar):
 *  - POST /Config/Get -> 200 { data: { settings } }
 *  - POST /Config/Set -> 200 ok
 *
 * ⚠️ Endpoints administrativos: restringir a rol admin en el despliegue.
 */

export const CONFIG_ENDPOINTS = {
  GET: '/Config/Get',
  SET: '/Config/Set',
};

export type ConfigType = 'string' | 'email' | 'number';

export interface ConfigSetting {
  key: string;
  label: string;
  group: string;
  type: ConfigType;
  default: string | number;
  help: string;
  consumers: string[];
  value: string | number;
  isOverridden: boolean;
}

export const configService = {
  get: (): Promise<ApiResponse<{ settings: ConfigSetting[] }>> =>
    apiPost(CONFIG_ENDPOINTS.GET, {}),

  set: (key: string, value: string | number): Promise<ApiResponse<{ key?: string }>> =>
    apiPost(CONFIG_ENDPOINTS.SET, { key, value }),
};
