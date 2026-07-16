import { AUTH_API_BASE, AUTH_ENDPOINTS } from '../config/api';
import { MOCK_ENABLED, mockLogin } from './mockAuth';
import { clearPortalCache } from './portalCache';

/**
 * Servicio de autenticación de MailConnect.
 * Conecta el front con los endpoints de seguridad del backend (AWS API Gateway).
 * La URL base se toma de VITE_API_BASE_URL (ver .env) o del valor por defecto.
 *
 * Estado del backend (jul. 2026):
 *  - /login, /register, /logout, /account-activation -> IMPLEMENTADOS.
 *  - /create-otp, /validate-otp, /change-password, /forgot-password -> IMPLEMENTADOS.
 *    La recuperación de contraseña es: /forgot-password (envía OTP al correo) y
 *    luego /change-password con { user, password, otp } desde la pantalla de reseteo.
 *  - /verify-code, /token/refresh -> STUBS en el backend (cliente ya conectado).
 */

export interface ApiResponse<T = unknown> {
  status: boolean;
  statusCode: number;
  description: string;
  data?: T;
}

export interface LoginData {
  token: string;
  customer: string;
  /** Id del cliente (uuid) — necesario para crear plantillas/campañas. */
  customerId?: string;
  /** NIT de la empresa. */
  companyTin?: string;
  userId: string;
  name: string;
  /** ¿El cliente tiene habilitados los envíos reales? (default true si no viene). */
  realSendEnabled?: boolean;
  /** Rol del usuario: 'admin' (interno MailConnect) o 'client' (default). */
  role?: string;
}

export interface RegisterPayload {
  name: string;
  phone: string;
  email: string;
  company: string;
  companyTin: number;
  password: string;
  /** Aceptación de términos + Habeas Data (el front la exige antes de registrar). */
  acceptedTerms?: boolean;
}

export interface SessionUser {
  userId: string;
  name: string;
  /** Nombre de la empresa (customer). Define buckets/tablas: {customer}.database, {customer}_... */
  customer: string;
  /** Id del cliente (uuid) — para crear plantillas/campañas sin pedirlo en el formulario. */
  customerId?: string;
  /** NIT de la empresa. */
  nit?: string;
  /** ¿El cliente tiene habilitados los envíos reales? Si es false, el portal
   *  deshabilita "Enviar campaña real" (el backend también lo bloquea). */
  realSendEnabled?: boolean;
  /** Rol del usuario: 'admin' (interno) o 'client'. Controla el acceso a /admin. */
  role?: string;
  email: string;
}

/** ¿La sesión corresponde a un administrador? */
export const isAdmin = (user: SessionUser | null): boolean => (user?.role ?? 'client') === 'admin';

const TOKEN_KEY = 'mc_token';
const USER_KEY = 'mc_user';

/** POST genérico que normaliza la respuesta a ApiResponse. */
async function post<T = unknown>(path: string, body: unknown, useAuth = false): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useAuth) {
    const t = getToken();
    if (t) headers['Authorization'] = `Bearer ${t}`;
  }

  let res: Response;
  try {
    res = await fetch(`${AUTH_API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return { status: false, statusCode: 0, description: 'No se pudo conectar con el servidor. Verifica tu conexión.' };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { status: false, statusCode: res.status, description: 'Respuesta inválida del servidor.' };
  }

  // Soportar integración Lambda-proxy (cuerpo como string JSON dentro de "body").
  if (json && typeof json === 'object' && typeof (json as { body?: unknown }).body === 'string') {
    try { json = JSON.parse((json as { body: string }).body); } catch { /* se deja tal cual */ }
  }

  // Forma estándar del backend { status, statusCode, description, data }
  if (json && typeof json === 'object' && 'statusCode' in json && 'status' in json) {
    return json as ApiResponse<T>;
  }

  // Respuesta no estándar (stub / proxy simple): normalizar usando el HTTP status.
  return {
    status: res.ok,
    statusCode: res.status,
    description: typeof json === 'string' ? json : '',
    data: json as T,
  };
}

export const authService = {
  login: (user: string, password: string): Promise<ApiResponse<LoginData>> => {
    // Modo demo: pasa el login sin backend (VITE_AUTH_MOCK=true).
    if (MOCK_ENABLED) return Promise.resolve(mockLogin(user, password));
    return post<LoginData>(AUTH_ENDPOINTS.LOGIN, { user, password });
  },

  register: (payload: RegisterPayload) => {
    // En modo demo, el registro "funciona" para poder seguir el flujo.
    if (MOCK_ENABLED) {
      return Promise.resolve<ApiResponse>({
        status: true,
        statusCode: 201,
        description: 'Registro simulado (modo demo). Ya puedes iniciar sesión.',
      });
    }
    return post(AUTH_ENDPOINTS.REGISTER, payload);
  },

  /**
   * Solicita el envío de un OTP de recuperación al correo del usuario.
   * Por seguridad el backend responde siempre 200 (no revela si el correo existe).
   */
  forgotPassword: (user: string) =>
    post(AUTH_ENDPOINTS.FORGOT_PASSWORD, { user }),

  /** Crear OTP (requiere token). */
  createOtp: (userId: string, ip: string, system = 'Autenticacion', expiration = 5) =>
    post(AUTH_ENDPOINTS.CREATE_OTP, { userId, ip, system, expiration }, true),

  /** Validar OTP. */
  validateOtp: (otp: number, userId: string, ip: string) =>
    post(AUTH_ENDPOINTS.VALIDATE_OTP, { otp, userId, ip }),

  /**
   * Cambiar contraseña. Si se pasa `otp` es una recuperación (no requiere sesión);
   * sin `otp` requiere un token de sesión válido (Authorization: Bearer).
   */
  changePassword: (user: string, password: string, otp?: number) => {
    // Recuperación (con OTP): no requiere sesión.
    if (otp !== undefined) {
      return post(AUTH_ENDPOINTS.CHANGE_PASSWORD, { user, password, otp }, false);
    }
    // Logueado (sin OTP): autoriza por token de sesión. Lo mandamos en el header
    // Authorization Y en el body (`token`), porque si el endpoint está en
    // integración no-proxy en API Gateway el header no llega a la Lambda; la
    // Lambda ya acepta el token por cualquiera de las dos vías.
    const token = getToken();
    return post(
      AUTH_ENDPOINTS.CHANGE_PASSWORD,
      token ? { user, password, token } : { user, password },
      true,
    );
  },

  /** Renueva el JWT. Manda el token en header y en body (para integración no-proxy). */
  refreshToken: (): Promise<ApiResponse<{ token?: string }>> => {
    const token = getToken();
    return post<{ token?: string }>(AUTH_ENDPOINTS.REFRESH_TOKEN, token ? { token } : {}, true);
  },

  logout: (user?: string) => post(AUTH_ENDPOINTS.LOGOUT, { user }),
};

/* ------------------------- Manejo de sesión ------------------------- */

export function saveSession(token: string, user: SessionUser): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionUser; } catch { return null; }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearPortalCache(); // limpia la caché precargada del portal (no mezclar cuentas)
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

/* --------------------- Expiración y cierre de sesión --------------------- */

/** Decodifica el payload del JWT SIN validar la firma (solo para leer `exp`). */
function decodeJwtPayload(token: string): { exp?: number } | null {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64)))) as { exp?: number };
  } catch {
    return null;
  }
}

/**
 * ¿El token de la sesión ya venció? (con 30 s de margen para evitar mandar
 * peticiones que van a morir en el Authorizer). Sin token o token ilegible → true.
 */
export function isTokenExpired(): boolean {
  const token = getToken();
  if (!token) return true;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false; // token sin exp: se deja pasar (el backend decide)
  return Date.now() / 1000 > payload.exp - 30;
}

/** Segundos hasta que expire el token (Infinity si no tiene exp; 0 si venció/no hay). */
export function secondsUntilExpiry(): number {
  const token = getToken();
  if (!token) return 0;
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return Infinity;
  return Math.max(0, payload.exp - Date.now() / 1000);
}

let refreshing = false;

/**
 * Renueva el token de forma proactiva (sesión deslizante). Solo intenta una vez a
 * la vez y solo si el token sigue vigente. Devuelve true si se renovó.
 */
export async function refreshSession(): Promise<boolean> {
  if (refreshing || isTokenExpired()) return false;
  refreshing = true;
  try {
    const res = await authService.refreshToken();
    if (res.status && res.statusCode === 200 && res.data?.token) {
      localStorage.setItem(TOKEN_KEY, res.data.token);
      return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    refreshing = false;
  }
}

export type LogoutReason = 'expired' | 'inactive';

const LOGOUT_REASON_KEY = 'mc_logout_reason';

/** Motivo del último cierre de sesión automático (lo lee la pantalla de login). */
export function consumeLogoutReason(): LogoutReason | null {
  const reason = sessionStorage.getItem(LOGOUT_REASON_KEY) as LogoutReason | null;
  sessionStorage.removeItem(LOGOUT_REASON_KEY);
  return reason;
}

/**
 * Cierra la sesión automáticamente (token vencido / inactividad) y lleva al login.
 * Usa navegación dura para limpiar cualquier estado en memoria del panel.
 */
export function sessionExpired(reason: LogoutReason): void {
  clearSession();
  try { sessionStorage.setItem(LOGOUT_REASON_KEY, reason); } catch { /* sin sessionStorage */ }
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  }
}
