import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import {
  isAuthenticated,
  isTokenExpired,
  clearSession,
  sessionExpired,
} from '../services/authService';

/**
 * Protege rutas privadas:
 *  - Sin sesión → redirige al login.
 *  - Con token vencido → cierra la sesión y redirige con aviso.
 *  - Con sesión activa → vigila la INACTIVIDAD: si el usuario no interactúa
 *    durante VITE_IDLE_MINUTES (default 15), cierra la sesión automáticamente.
 *
 * Uso: <Route path="/panel" element={<RequireAuth><PortalPage /></RequireAuth>} />
 */

const IDLE_MINUTES = Number(import.meta.env.VITE_IDLE_MINUTES) > 0
  ? Number(import.meta.env.VITE_IDLE_MINUTES)
  : 15;

const LAST_ACTIVITY_KEY = 'mc_last_activity';
const CHECK_EVERY_MS = 30_000; // frecuencia del chequeo de inactividad/expiración
const TOUCH_THROTTLE_MS = 5_000; // no escribir la marca de actividad más seguido que esto

export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const authed = isAuthenticated() && !isTokenExpired();

  useEffect(() => {
    if (!authed) return;

    let lastTouch = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastTouch < TOUCH_THROTTLE_MS) return;
      lastTouch = now;
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(now)); } catch { /* sin storage */ }
    };

    // Marca inicial + eventos que cuentan como actividad del usuario.
    touch();
    const events: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    const onVisible = () => { if (!document.hidden) touch(); };
    document.addEventListener('visibilitychange', onVisible);

    const interval = window.setInterval(() => {
      // 1) Token vencido mientras la pestaña estaba abierta.
      if (isTokenExpired()) {
        sessionExpired('expired');
        return;
      }
      // 2) Inactividad prolongada (la marca se comparte entre pestañas).
      const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY)) || Date.now();
      if (Date.now() - last > IDLE_MINUTES * 60_000) {
        sessionExpired('inactive');
      }
    }, CHECK_EVERY_MS);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, touch));
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
    };
  }, [authed]);

  if (!authed) {
    // Si había token pero venció, dejar el aviso para la pantalla de login.
    if (isAuthenticated() && isTokenExpired()) {
      clearSession();
      try { sessionStorage.setItem('mc_logout_reason', 'expired'); } catch { /* sin storage */ }
    }
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export default RequireAuth;
