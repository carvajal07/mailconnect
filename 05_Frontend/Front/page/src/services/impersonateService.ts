import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de IMPERSONACIÓN ("ver como cliente", Bloque D).
 * POST /Admin/Impersonate → token de SESIÓN del tenant en SOLO LECTURA (readonly +
 * impersonatedBy), auditado. El front lo usa para entrar al portal del cliente.
 */
export const IMPERSONATE_ENDPOINT = '/Admin/Impersonate';

export interface ImpersonateData {
  token: string;
  customer: string;
  customerId: string;
  companyTin?: string;
  expiresInMinutes: number;
  impersonatedBy: string;
}

export const impersonateService = {
  start: (customerId: string): Promise<ApiResponse<ImpersonateData>> =>
    apiPost(IMPERSONATE_ENDPOINT, { customerId }),
};
