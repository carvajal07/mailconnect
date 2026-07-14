import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de AUDITORÍA. Lee la bitácora de acciones administrativas sensibles
 * (tabla adminAudit) que escriben las lambdas que mutan.
 *
 * Endpoint (no-proxy, envelope estándar):
 *  - POST /Admin/Audit -> 200 { data: { entries, count, actions } }
 *
 * ⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
 */

export const AUDIT_ENDPOINTS = {
  LIST: '/Admin/Audit',
};

export interface AuditEntry {
  auditId: string;
  date: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
  customer: string;
}

export interface AuditData {
  entries: AuditEntry[];
  count: number;
  actions: string[];
  truncated?: boolean;
}

export const auditService = {
  /** Lista la bitácora. month='YYYY-MM', action y actor opcionales. */
  list: (month?: string, action?: string, actor?: string): Promise<ApiResponse<AuditData>> =>
    apiPost(AUDIT_ENDPOINTS.LIST, {
      ...(month ? { month } : {}),
      ...(action ? { action } : {}),
      ...(actor ? { actor } : {}),
    }),
};
