import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de DOMINIOS de envío propios del cliente (identidades SES por dominio).
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - POST /Domain/Add    { domain } -> 201 { data: { domainId, domain, status, records } }
 *  - POST /Domain/List   {}         -> 200 { data: { domains, count } } (refresca estado SES)
 *  - POST /Domain/Delete { domainId } -> 200 ok
 */

export const DOMAIN_ENDPOINTS = {
  ADD: '/Domain/Add',
  LIST: '/Domain/List',
  DELETE: '/Domain/Delete',
};

export type DomainStatus = 'pending' | 'verified' | 'failed';

/** Registro DNS que el cliente debe publicar para verificar el dominio. */
export interface DnsRecord {
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
  purpose?: string;
}

export interface SenderDomain {
  domainId: string;
  domain: string;
  status: DomainStatus;
  records: DnsRecord[];
  createdAt?: string;
  verifiedAt?: string;
}

export const domainsService = {
  /** Registra un dominio y devuelve los registros DNS a publicar. */
  add: (domain: string): Promise<ApiResponse<SenderDomain>> =>
    apiPost(DOMAIN_ENDPOINTS.ADD, { domain }),

  /** Lista los dominios del cliente (refresca el estado de verificación desde SES). */
  list: (): Promise<ApiResponse<{ domains?: SenderDomain[]; count?: number }>> =>
    apiPost(DOMAIN_ENDPOINTS.LIST, {}),

  /** Elimina un dominio del cliente. */
  delete: (domainId: string): Promise<ApiResponse> =>
    apiPost(DOMAIN_ENDPOINTS.DELETE, { domainId }),
};
