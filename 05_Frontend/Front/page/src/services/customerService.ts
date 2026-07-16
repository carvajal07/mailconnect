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
  SET_ROLE: '/User/SetRole',
  SET_TENANT_ROLE: '/User/SetTenantRole',
};

export interface CustomerSummary {
  customerId: string;
  company: string;
  companyTin?: string | number;
  realSendEnabled: boolean;
  date?: string;
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

  /** Ficha de un cliente: sus datos + los usuarios de la empresa (admin). */
  detail: (customerId: string): Promise<ApiResponse<CustomerDetail>> =>
    apiPost(CUSTOMER_ENDPOINTS.DETAIL, { customerId }),

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
