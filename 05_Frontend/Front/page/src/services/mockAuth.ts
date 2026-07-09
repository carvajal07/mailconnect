import type { ApiResponse, LoginData } from './authService';

/**
 * Modo de autenticación "mock" para desarrollo/demo.
 *
 * Se activa con la variable de entorno VITE_AUTH_MOCK=true (ver .env.example).
 * Sirve para poder pasar el login y navegar el frontend MIENTRAS el backend real
 * aún no está disponible. NO debe activarse en producción.
 *
 * Con el modo activo:
 *  - Cualquier credencial no vacía inicia sesión (o usa la demo de abajo).
 *  - Se genera un token tipo JWT (firma falsa) y un usuario de demostración.
 *
 * Ojo: solo simula el LOGIN. Las llamadas del panel (plantillas, campañas...) sí
 * pegan al backend real y fallarán si no está arriba; eso es lo esperado.
 */

export const MOCK_ENABLED = import.meta.env.VITE_AUTH_MOCK === 'true';

/** Credencial de demostración sugerida (en mock, igual sirve cualquiera). */
export const DEMO_CREDENTIALS = {
  email: 'demo@mailconnect.com.co',
  password: 'Demo1234',
};

function base64url(obj: unknown): string {
  const json = JSON.stringify(obj);
  // btoa espera Latin1; codificamos UTF-8 de forma segura.
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Token con forma de JWT (HS256) pero firma ficticia; suficiente para la sesión del front. */
function fakeJwt(email: string): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  // exp ~ 1 día. Date.now() está disponible en el navegador.
  const payload = base64url({ user: email, exp: Math.floor(Date.now() / 1000) + 86400, mock: true });
  return `${header}.${payload}.mock-signature`;
}

/** Respuesta de login simulada, con la misma forma que la del backend real. */
export function mockLogin(user: string, _password: string): ApiResponse<LoginData> {
  const email = user?.trim() || DEMO_CREDENTIALS.email;
  return {
    status: true,
    statusCode: 200,
    description: 'Sesión iniciada en modo demo (VITE_AUTH_MOCK).',
    data: {
      token: fakeJwt(email),
      customer: 'Empresa Demo',
      userId: 'mock-user-1',
      name: email.split('@')[0] || 'Usuario Demo',
    },
  };
}
