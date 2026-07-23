import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Gestión del EQUIPO por el dueño (owner): crear/listar/eliminar usuarios de su empresa.
 * Backend: Api_V1_User_{Create,List,Delete} (rutas cliente, owner-only por tenantRole).
 * El usuario nuevo define su contraseña con "¿Olvidaste tu contraseña?" (OTP) — tras crearlo
 * se dispara authService.forgotPassword(email).
 */

export const USER_ENDPOINTS = {
  CREATE: '/User/Create',
  LIST: '/User/List',
  DELETE: '/User/Delete',
};

export type TenantRole = 'owner' | 'approver' | 'operator';

export interface TeamUser {
  userId: string;
  name: string;
  email: string;
  tenantRole: TenantRole;
  active: boolean;
  isOwner: boolean;
}

export interface CreateUserPayload {
  name: string;
  email: string;
  phone?: string;
  tenantRole: 'operator' | 'approver';
}

export const ROLE_LABEL: Record<TenantRole, string> = {
  owner: 'Dueño',
  approver: 'Aprobador',
  operator: 'Funcional',
};

export const usersService = {
  create: (payload: CreateUserPayload): Promise<ApiResponse<{ userId?: string; email?: string }>> =>
    apiPost(USER_ENDPOINTS.CREATE, payload),
  list: (): Promise<ApiResponse<{ users?: TeamUser[]; count?: number; max?: number; canAdd?: boolean }>> =>
    apiPost(USER_ENDPOINTS.LIST, {}),
  delete: (userId: string): Promise<ApiResponse> =>
    apiPost(USER_ENDPOINTS.DELETE, { userId }),
};
