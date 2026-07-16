import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Alert, AlertTitle, Box, Button } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';

interface Props {
  children: ReactNode;
  /** Etiqueta de la sección/área para el mensaje (opcional). */
  label?: string;
  /** Cambia este valor (p. ej. el id del tab activo) para reintentar el render al navegar. */
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  message: string;
}

/**
 * Límite de error de React. Si una sección lanza durante el render (p. ej. una respuesta
 * con forma inesperada), en vez de dejar TODA la app en blanco (la app no tenía ningún
 * ErrorBoundary), atrapa el fallo y muestra un aviso acotado con botón de reintentar.
 * Se resetea automáticamente cuando cambia `resetKey` (al cambiar de tab).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(prev: Props) {
    // Al navegar a otra sección (cambia resetKey) se limpia el error y se reintenta.
    if (this.state.hasError && prev.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary atrapó un error de render:', error, info);
  }

  handleReset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 1 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={this.handleReset}>
                Reintentar
              </Button>
            }
          >
            <AlertTitle>No se pudo mostrar {this.props.label || 'esta sección'}</AlertTitle>
            Ocurrió un error inesperado al presentar los datos. Puedes reintentar o cambiar de
            sección; el resto del panel sigue funcionando.
            {this.state.message && (
              <Box component="div" sx={{ mt: 1, fontSize: 12, opacity: 0.8, wordBreak: 'break-word' }}>
                {this.state.message}
              </Box>
            )}
          </Alert>
        </Box>
      );
    }
    return this.props.children;
  }
}
