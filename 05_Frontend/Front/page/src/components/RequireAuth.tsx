import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { isAuthenticated } from '../services/authService';

/**
 * Protege rutas privadas: si no hay sesión activa, redirige al login.
 * Uso: <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
 */
export const RequireAuth = ({ children }: { children: ReactNode }) => {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
};

export default RequireAuth;
