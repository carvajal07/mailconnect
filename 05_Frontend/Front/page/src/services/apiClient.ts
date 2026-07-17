import { AUTH_API_BASE } from '../config/api';
import { getToken, isTokenExpired, sessionExpired } from './authService';

/**
 * Cliente HTTP compartido para los módulos del panel (plantillas, campañas...).
 *
 * - Agrega el token de sesión (Authorization: Bearer) por defecto.
 * - Normaliza la respuesta al envelope estándar del backend
 *   { status, statusCode, description, data } — leyendo del cuerpo, no del HTTP
 *   status (integración no-proxy) y soportando también Lambda-proxy (body string).
 */

export interface ApiResponse<T = unknown> {
  status: boolean;
  statusCode: number;
  description: string;
  data?: T;
}

type Method = 'GET' | 'POST';

async function request<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
  useAuth = true,
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (useAuth) {
    const token = getToken();
    // Si el JWT ya venció, no vale la pena pegarle a la API: se cierra la
    // sesión y se redirige al login con el aviso correspondiente.
    if (token && isTokenExpired()) {
      sessionExpired('expired');
      return { status: false, statusCode: 401, description: 'Tu sesión expiró. Inicia sesión nuevamente.' };
    }
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${AUTH_API_BASE}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    return {
      status: false,
      statusCode: 0,
      description: 'No se pudo conectar con el servidor. Verifica tu conexión.',
    };
  }

  let json: unknown;
  let parseFailed = false;
  try {
    json = await res.json();
  } catch {
    parseFailed = true;
  }

  // Lambda-proxy: cuerpo como string JSON dentro de "body".
  if (json && typeof json === 'object' && typeof (json as { body?: unknown }).body === 'string') {
    try { json = JSON.parse((json as { body: string }).body); } catch { /* se deja tal cual */ }
  }

  // ¿El cuerpo es el ENVELOPE estándar del backend? (status + statusCode/status_code).
  // OJO: hay que distinguir un 403/401 de NEGOCIO (envelope con description; p. ej.
  // envío real deshabilitado, saldo insuficiente, rol sin permiso) de un 401/403 del
  // AUTHORIZER (API Gateway devuelve {message:'Unauthorized'} SIN envelope). Solo el
  // segundo debe cerrar la sesión; un 403 de negocio NO debe sacar al usuario al login.
  const isEnvelope = !!json && typeof json === 'object'
    && 'status' in json && ('statusCode' in json || 'status_code' in json);

  // Rechazo del Authorizer (token vencido/inválido): SIN envelope y con 401/403 →
  // cerrar sesión y volver al login. Un envelope de negocio con 401/403 NO cae aquí.
  if ((res.status === 401 || res.status === 403) && useAuth && getToken() && !isEnvelope) {
    sessionExpired('expired');
    return { status: false, statusCode: 401, description: 'Tu sesión expiró. Inicia sesión nuevamente.' };
  }

  if (parseFailed) {
    return { status: false, statusCode: res.status, description: 'Respuesta inválida del servidor.' };
  }

  // Envelope estándar del backend. Soporta 'statusCode' (no-proxy) y 'status_code'
  // (snake_case, como devuelve Prepare-batch-template), normalizando a ApiResponse.
  if (isEnvelope) {
    const j = json as Record<string, unknown>;
    return {
      status: Boolean(j.status),
      statusCode: Number(j.statusCode ?? j.status_code),
      description: typeof j.description === 'string' ? j.description : '',
      data: j.data as T,
    };
  }

  // Respuesta no estándar: normalizar usando el HTTP status.
  return {
    status: res.ok,
    statusCode: res.status,
    description: typeof json === 'string' ? json : '',
    data: json as T,
  };
}

export const apiPost = <T = unknown>(path: string, body: unknown, useAuth = true) =>
  request<T>('POST', path, body, useAuth);

export const apiGet = <T = unknown>(path: string, useAuth = true) =>
  request<T>('GET', path, undefined, useAuth);

/** ¿La respuesta indica éxito? (status del envelope o HTTP 2xx). */
export const isOk = (res: ApiResponse): boolean =>
  res.status === true || (res.statusCode >= 200 && res.statusCode < 300);
