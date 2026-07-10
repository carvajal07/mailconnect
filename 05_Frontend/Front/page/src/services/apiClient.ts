import { AUTH_API_BASE } from '../config/api';
import { getToken } from './authService';

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
  try {
    json = await res.json();
  } catch {
    return { status: false, statusCode: res.status, description: 'Respuesta inválida del servidor.' };
  }

  // Lambda-proxy: cuerpo como string JSON dentro de "body".
  if (json && typeof json === 'object' && typeof (json as { body?: unknown }).body === 'string') {
    try { json = JSON.parse((json as { body: string }).body); } catch { /* se deja tal cual */ }
  }

  // Envelope estándar del backend. Soporta 'statusCode' (no-proxy) y 'status_code'
  // (snake_case, como devuelve Prepare-batch-template), normalizando a ApiResponse.
  if (json && typeof json === 'object' && 'status' in json && ('statusCode' in json || 'status_code' in json)) {
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
