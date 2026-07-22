import { apiPost, isOk } from './apiClient';
import type { ApiResponse } from './apiClient';
import { API_CONFIG } from '../config/api';

/**
 * Servicio del EDITOR de plantillas PDF (PdfTemplatesSection). Habla con la lambda
 * `Api_V1_Template_Render-pdf` (POST /Template/Render-pdf), que toma el HTML del editor
 * + valores de muestra y devuelve el PDF renderizado (base64) o lo sube a S3.
 */

export interface RenderPdfPayload {
  /** HTML del editor (con variables {{campo}}). */
  html?: string;
  /** Alternativa: plantilla PDF ya guardada (channel=PDF). */
  messageTemplateId?: string;
  /** Valores de muestra para reemplazar {{campo}} en la vista previa. */
  variables?: Record<string, string>;
  /** Tamaño de hoja. */
  pageSize?: 'A4' | 'Carta';
  /** true = subir a S3 y devolver {path,url}; false (default) = devolver base64. */
  store?: boolean;
  /** Nombre del archivo (se sanea en el backend). */
  filename?: string;
}

export interface RenderPdfResult {
  /** store=false → PDF en base64. */
  pdfBase64?: string;
  filename?: string;
  contentType?: string;
  /** store=true → ubicación en S3. */
  path?: string;
  url?: string;
}

/**
 * Borradores de plantillas PDF del editor (PdfTemplatesSection), en localStorage.
 * Fuente única de la key para que el editor y el form de campaña compartan el mismo
 * almacén (name → HTML).
 */
export const PDF_DRAFTS_KEY = 'mc_pdf_drafts';
export const readPdfDrafts = (): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(PDF_DRAFTS_KEY) || '{}'); } catch { return {}; }
};
export const writePdfDrafts = (drafts: Record<string, string>): void =>
  localStorage.setItem(PDF_DRAFTS_KEY, JSON.stringify(drafts));

/** Convierte el base64 del backend en un Blob PDF para previsualizar/descargar. */
export const base64ToPdfBlob = (base64: string): Blob => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
};

export const pdfTemplatesService = {
  render: (payload: RenderPdfPayload): Promise<ApiResponse<RenderPdfResult>> =>
    apiPost(API_CONFIG.TEMPLATES.RENDER_PDF, payload),
};

export { isOk };
