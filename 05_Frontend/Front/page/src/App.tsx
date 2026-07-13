import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { LandingPage } from './pages/landing/LandingPage';
import { LegalPage } from './pages/legal/LegalPage';
import { LoginPage } from './pages/auth/LoginPage';
import { RegisterPage } from './pages/auth/RegisterPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import { AccountActivatedPage } from './pages/auth/AccountActivatedPage';
import { AdminPage } from './pages/admin/AdminPage';
import { PortalPage } from './pages/portal/PortalPage';
import { RequireAuth } from './components/RequireAuth';
import { ThemeProvider } from './contexts/ThemeContext';

function App() {
  return (
    <ThemeProvider>
      <CssBaseline />
      <Router>
        <Routes>
          {/* Landing pública (marketing) */}
          <Route path="/" element={<LandingPage />} />

          {/* Páginas legales públicas (Habeas Data, Términos, Anti-spam, Privacidad) */}
          <Route path="/legal/:slug" element={<LegalPage />} />

          {/* Rutas de autenticación */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          {/* Resultado de la activación de cuenta (destino del enlace del correo) */}
          <Route path="/cuenta-activada" element={<AccountActivatedPage />} />

          {/* Portal del cliente (protegido) — destino del login */}
          <Route
            path="/panel"
            element={
              <RequireAuth>
                <PortalPage />
              </RequireAuth>
            }
          />

          {/* Ruta de administración interna (protegida, solo rol admin) */}
          <Route
            path="/admin"
            element={
              <RequireAuth requireAdmin>
                <AdminPage />
              </RequireAuth>
            }
          />

          {/* Páginas no encontradas → landing */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </ThemeProvider>
  );
}

export default App;
