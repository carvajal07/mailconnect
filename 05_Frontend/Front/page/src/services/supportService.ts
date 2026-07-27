import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de la caja de SOPORTE:
 *  - Recipient-lookup : "¿qué le llegó a fulano@x.com?" (línea de tiempo por contacto).
 *  - User-support     : reenviar activación / forzar reseteo / cerrar sesiones.
 *  - Templates        : listado GLOBAL de plantillas SES.
 *  - Domains          : vista GLOBAL de dominios remitentes de todos los clientes.
 */

export interface TimelineEntry {
  date: string;
  campaignName: string;
  channel: string;
  state: number;
  stateLabel: string;
  detail: string;
  processId: string;
  messageId: string;
}

export interface RecipientLookupData {
  company: string;
  contact: string;
  timeline: TimelineEntry[];
  count: number;
  truncated: boolean;
  lists: { blacklisted: boolean; unsubscribed: boolean };
}

export type UserSupportAction = 'resend-activation' | 'force-reset' | 'revoke-sessions';

export interface SesTemplateRow {
  name: string;
  customerPrefix: string;
  createdAt: string;
}

/** Contenido real de una plantilla SES (Admin/Templates action=get). */
export interface SesTemplateContent {
  name: string;
  subject: string;
  html: string;
  text: string;
}

export interface GlobalDomainRow {
  domainId: string;
  customerId: string;
  company: string;
  kind: 'domain' | 'email';
  domain: string;
  status: 'pending' | 'verified' | 'failed';
  createdAt: string;
  verifiedAt?: string;
}

export const supportService = {
  /** Línea de tiempo de TODO lo enviado a un contacto de un cliente (admin). */
  recipientLookup: (customerId: string, contact: string): Promise<ApiResponse<RecipientLookupData>> =>
    apiPost('/Admin/Recipient-lookup', { customerId, contact }),

  /** Acción de soporte sobre un usuario (admin, auditada). */
  userAction: (
    userId: string,
    action: UserSupportAction,
  ): Promise<ApiResponse<{ email?: string; revoked?: number; expirationMin?: number }>> =>
    apiPost('/Admin/User-support', { userId, action }),

  /** Listado global de plantillas SES de la cuenta (admin). */
  listTemplates: (): Promise<ApiResponse<{ templates?: SesTemplateRow[]; count?: number; truncated?: boolean }>> =>
    apiPost('/Admin/Templates', {}),

  /**
   * Contenido REAL de una plantilla SES (asunto + HTML + texto), por la ruta ADMIN.
   * No se usa /Template/Get-template: esa exige que el nombre empiece por el prefijo del
   * tenant del token, así que el admin recibía 403 al abrir la plantilla de otro cliente.
   */
  getTemplate: (name: string): Promise<ApiResponse<{ template?: SesTemplateContent }>> =>
    apiPost('/Admin/Templates', { action: 'get', name }),

  /** Elimina una plantilla de SES (admin; misma razón que getTemplate). */
  deleteTemplate: (name: string): Promise<ApiResponse<{ name?: string }>> =>
    apiPost('/Admin/Templates', { action: 'delete', name }),

  /** Dominios/correos remitentes de TODOS los clientes (admin). */
  listDomains: (): Promise<ApiResponse<{ domains?: GlobalDomainRow[]; count?: number }>> =>
    apiPost('/Admin/Domains', {}),
};
