import { useEffect } from 'react';
import { useUIStore } from '@/store/uiStore';
import { useDataSourceStore, type SketchDataSource } from '@/store/dataSourceStore';
import { useUploadStore } from '@/store/uploadStore';
import AppShell from './app/layout/AppShell';
import { useTheme } from '../contexts/ThemeContext';
import './styles/tokens.css';
import './styles/globals.css';

/**
 * Punto de entrada del editor pdfsketch DENTRO del portal MailConnect
 * (reemplaza al main.tsx/App.tsx del prototipo standalone).
 *
 * - Todo el editor vive bajo el wrapper `.mc-sketch` (tokens y estilos
 *   scopeados; el tema dark/light se aplica como clase del wrapper, no sobre
 *   document.documentElement).
 * - El tema SIGUE al de la página MailConnect (ThemeContext → claro/oscuro):
 *   los tokens `.light` del editor se activan cuando el portal está en claro.
 * - Se monta desde `SketchStudio` (overlay full-screen del nivel MEDIO).
 */
export default function SketchEditor({
  databases,
  uploadImage,
}: {
  databases?: SketchDataSource[];
  /** Sube una imagen a S3 y devuelve su URL pública (lo inyecta SketchStudio). */
  uploadImage?: (file: File) => Promise<string | null>;
}) {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const setSources = useDataSourceStore((s) => s.setSources);
  const setUploadImage = useUploadStore((s) => s.setUploadImage);
  const { mode } = useTheme();

  // Sincroniza el tema del editor con el modo claro/oscuro del portal.
  useEffect(() => {
    setTheme(mode === 'light' ? 'light' : 'dark');
  }, [mode, setTheme]);

  // Bases de datos del cliente disponibles como variables en el panel de Datos.
  useEffect(() => {
    setSources(databases ?? []);
  }, [databases, setSources]);

  // Inyecta el subidor de imágenes a S3 (o null si no viene) al store del editor.
  useEffect(() => {
    setUploadImage(uploadImage ?? null);
    return () => setUploadImage(null);
  }, [uploadImage, setUploadImage]);

  return (
    <div className={`mc-sketch ${theme === 'light' ? 'light' : 'dark'}`} style={{ height: '100%' }}>
      <AppShell />
    </div>
  );
}
