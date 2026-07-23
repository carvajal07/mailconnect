import { useUIStore } from '@/store/uiStore';
import AppShell from './app/layout/AppShell';
import './styles/tokens.css';
import './styles/globals.css';

/**
 * Punto de entrada del editor pdfsketch DENTRO del portal MailConnect
 * (reemplaza al main.tsx/App.tsx del prototipo standalone).
 *
 * - Todo el editor vive bajo el wrapper `.mc-sketch` (tokens y estilos
 *   scopeados; el tema dark/light se aplica como clase del wrapper, no sobre
 *   document.documentElement).
 * - Se monta lazy desde `PdfStudioSection` (nivel MEDIO de plantillas PDF).
 */
export default function SketchEditor() {
  const theme = useUIStore((s) => s.theme);

  return (
    <div className={`mc-sketch ${theme === 'light' ? 'light' : 'dark'}`} style={{ height: '100%' }}>
      <AppShell />
    </div>
  );
}
