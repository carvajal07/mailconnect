import type { TenantRole } from '../services/authService';

/**
 * RBAC del PORTAL — matriz rol → módulos/tabs (ver PLAN_APROBACIONES.md §3.2).
 *
 * Fuente ÚNICA de qué tabs ve cada sub-rol de empresa. Fácil de mover a config del
 * backend luego. Cada tab lista los roles que pueden entrar; un tab no listado aquí es
 * accesible por todos los roles.
 *
 * Roles:
 *  - owner    (dueño/admin del cliente): todo.
 *  - approver (aprobador/jefe): aprueba/rechaza + envío real; NO gestiona el saldo.
 *  - operator (funcional): prepara + prueba + solicita aprobación; NO aprueba ni envía,
 *              ni ve Aprobaciones / Lista negra / Saldo.
 */
export const TAB_ACCESS: Record<string, TenantRole[]> = {
  aprobaciones: ['owner', 'approver'],
  listanegra: ['owner', 'approver'],
  saldo: ['owner'],
  // Configuración de dominios de envío (identidades SES): sensible → solo owner.
  dominios: ['owner'],
};

/** ¿El rol puede acceder al tab? (tab no listado en la matriz → visible para todos). */
export const canAccessTab = (role: TenantRole, tabId: string): boolean => {
  const allowed = TAB_ACCESS[tabId];
  return !allowed || allowed.includes(role);
};
