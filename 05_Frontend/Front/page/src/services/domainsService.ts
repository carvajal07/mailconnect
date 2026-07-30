import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de REMITENTES de envío propios del cliente (identidades SES: DOMINIO o CORREO).
 *
 * SES soporta dos tipos de identidad de remitente:
 *  - DOMINIO (empresa.com): se verifica por DNS (1 TXT + 3 CNAME) → enviar desde *@empresa.com.
 *  - CORREO  (ventas@empresa.com): se verifica por un enlace que SES envía a esa dirección →
 *    enviar solo desde esa dirección exacta (no requiere DNS).
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - POST /Domain/Add    { identity } -> 201 { data: { domainId, kind, domain, status, records } }
 *  - POST /Domain/List   {}           -> 200 { data: { domains, count } } (refresca estado SES)
 *  - POST /Domain/Delete { domainId } -> 200 ok
 */

export const DOMAIN_ENDPOINTS = {
  ADD: '/Domain/Add',
  LIST: '/Domain/List',
  DELETE: '/Domain/Delete',
};

export type DomainStatus = 'pending' | 'verified' | 'failed';
/** Tipo de identidad de remitente. */
export type SenderKind = 'domain' | 'email';

/** Registro DNS que el cliente debe publicar para verificar el dominio. */
export interface DnsRecord {
  type: 'TXT' | 'CNAME';
  name: string;
  value: string;
  purpose?: string;
}

/**
 * Estado de un mecanismo de autenticación (SPF/DKIM/DMARC). `unknown` es distinto de
 * `pending`: `pending` significa "se consultó y el registro no está publicado";
 * `unknown` significa "no se pudo consultar" (sin el layer de DNS, o SES no respondió) —
 * en la UI las dos se ven grises, pero el motivo que se explica en el tooltip cambia.
 */
export type MechanismStatus = 'verified' | 'pending' | 'failed' | 'unknown';

export interface Deliverability {
  /** Real: si SES ya firma los correos de este dominio con DKIM. */
  dkim: { status: MechanismStatus };
  /** Recomendado, NO obligatorio para enviar (ver DominiosSection). */
  spf: { status: MechanismStatus; record: string };
  /** Recomendado, NO obligatorio para enviar. */
  dmarc: { status: MechanismStatus; name: string; record: string };
}

export interface SenderDomain {
  domainId: string;
  /** 'domain' | 'email'. El backend lo devuelve; para filas legacy se autodetecta por '@'. */
  kind?: SenderKind;
  /** El valor de la identidad: el dominio (empresa.com) o el correo (ventas@empresa.com). */
  domain: string;
  status: DomainStatus;
  records: DnsRecord[];
  /** Solo para `kind:'domain'` — un correo suelto no firma con Easy DKIM. */
  deliverability?: Deliverability;
  createdAt?: string;
  verifiedAt?: string;
}

/** Tipo efectivo de una identidad (autodetecta por '@' si el backend no mandó kind). */
export const senderKindOf = (d: Pick<SenderDomain, 'kind' | 'domain'>): SenderKind =>
  d.kind ?? (d.domain.includes('@') ? 'email' : 'domain');

export const domainsService = {
  /**
   * Registra una identidad de remitente (dominio o correo; se detecta por el '@').
   * Devuelve los registros DNS a publicar (dominio) o un estado 'pending' a verificar por
   * correo. Se envía `identity` (canónico) y `domain` (alias legacy) por compatibilidad.
   */
  add: (identity: string): Promise<ApiResponse<SenderDomain>> =>
    apiPost(DOMAIN_ENDPOINTS.ADD, { identity, domain: identity }),

  /** Lista los remitentes del cliente (refresca el estado de verificación desde SES). */
  list: (): Promise<ApiResponse<{ domains?: SenderDomain[]; count?: number }>> =>
    apiPost(DOMAIN_ENDPOINTS.LIST, {}),

  /** Elimina un remitente del cliente. */
  delete: (domainId: string): Promise<ApiResponse> =>
    apiPost(DOMAIN_ENDPOINTS.DELETE, { domainId }),
};
