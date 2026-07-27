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
  DETAIL: '/Customer/Detail',
  DELETE: '/Customer/Delete',
  SET_ROLE: '/User/SetRole',
  SET_TENANT_ROLE: '/User/SetTenantRole',
};

export interface CustomerSummary {
  customerId: string;
  company: string;
  companyTin?: string | number;
  realSendEnabled: boolean;
  /** Banderas de funciones del cliente ({clave: bool}); ausente/true = habilitada. */
  featureFlags?: Record<string, boolean>;
  /** Cuotas de envío ({maxPerCampaign, maxPerDay}); ausente/0 = sin tope. */
  sendingLimits?: SendingLimits;
  date?: string;
}

/** Cuotas de envío del cliente (0 o ausente = sin tope). */
export interface SendingLimits {
  maxPerCampaign?: number;
  maxPerDay?: number;
}

export type UserRole = 'admin' | 'client';
/** Sub-rol dentro de la empresa (RBAC del portal). */
export type TenantRole = 'owner' | 'approver' | 'operator';

export interface CustomerUser {
  userId: string;
  email: string;
  name: string;
  phone: string;
  role: UserRole;
  /** Sub-rol de empresa (RBAC): owner|approver|operator. */
  tenantRole?: TenantRole;
  active: boolean;
  date?: string;
}

export interface CustomerDetail {
  customer: CustomerSummary;
  users: CustomerUser[];
  count: number;
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

  /**
   * Enciende/apaga funciones (tabs y funciones) de un cliente (admin). `features` es
   * un map parcial {clave: bool} (se mergea con las banderas ya guardadas). Devuelve
   * el estado efectivo de todas las banderas tras el merge.
   */
  setFeatures: (
    customerId: string,
    features: Record<string, boolean>,
  ): Promise<ApiResponse<{ customerId?: string; featureFlags?: Record<string, boolean> }>> =>
    apiPost(CUSTOMER_ENDPOINTS.UPDATE, { customerId, features }),

  /**
   * Fija las CUOTAS de envío del cliente (admin): destinatarios máx. por campaña y
   * por día (0 = sin tope). Prepare-batch las aplica en el envío real (429 al exceder).
   */
  setLimits: (
    customerId: string,
    limits: SendingLimits,
  ): Promise<ApiResponse<{ customerId?: string; sendingLimits?: SendingLimits }>> =>
    apiPost(CUSTOMER_ENDPOINTS.UPDATE, { customerId, limits }),

  /** Ficha de un cliente: sus datos + los usuarios de la empresa (admin). */
  detail: (customerId: string): Promise<ApiResponse<CustomerDetail>> =>
    apiPost(CUSTOMER_ENDPOINTS.DETAIL, { customerId }),

  /**
   * Elimina un cliente (empresa) y sus cuentas de usuario (admin). NO purga el histórico
   * (campañas/envíos/saldo se conservan). No permite borrar la propia empresa del admin.
   */
  delete: (customerId: string): Promise<ApiResponse<{ customerId?: string; deletedUsers?: number }>> =>
    apiPost(CUSTOMER_ENDPOINTS.DELETE, { customerId }),

  /** Cambia el rol de un usuario entre admin y client (admin). */
  setUserRole: (
    userId: string,
    role: UserRole,
  ): Promise<ApiResponse<{ userId?: string; role?: UserRole }>> =>
    apiPost(CUSTOMER_ENDPOINTS.SET_ROLE, { userId, role }),

  /** Cambia el sub-rol de empresa (owner|approver|operator) de un usuario (admin). */
  setTenantRole: (
    userId: string,
    tenantRole: TenantRole,
  ): Promise<ApiResponse<{ userId?: string; tenantRole?: TenantRole }>> =>
    apiPost(CUSTOMER_ENDPOINTS.SET_TENANT_ROLE, { userId, tenantRole }),
};
