import { create } from 'zustand';

/**
 * Puente de SUBIDA DE IMÁGENES a S3. pdfsketch no conoce la capa de servicios de
 * MailConnect (sesión, bucket del cliente); `SketchStudio` inyecta aquí una función
 * `uploadImage(file)` que sube el archivo al bucket del cliente (prefijo público
 * `resources/`) y devuelve su URL pública `https://…` — la que el motor de PDF puede
 * descargar (una `blob:`/`data:` local solo sirve para la vista del lienzo).
 *
 * Si no hay uploader inyectado (o falla), el llamador cae a un `URL.createObjectURL`
 * local: la imagen se ve en el lienzo pero NO saldría en el PDF.
 */
interface UploadState {
  uploadImage: ((file: File) => Promise<string | null>) | null;
  setUploadImage: (fn: ((file: File) => Promise<string | null>) | null) => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  uploadImage: null,
  setUploadImage: (uploadImage) => set({ uploadImage }),
}));
