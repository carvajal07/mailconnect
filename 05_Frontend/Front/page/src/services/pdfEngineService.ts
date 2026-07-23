import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';
import { API_CONFIG } from '../config/api';

/**
 * Servicio del MOTOR DE PDF ESTÁNDAR (`Api_V1_Template_Render-engine`).
 *
 * Es el motor que comparten los niveles MEDIO (pdfsketch → `sketch`) y FULL
 * (DocumentDesigner → `templateJson`) de plantillas PDF del portal. El nivel
 * básico (editor tipo Word) sigue en `pdfTemplatesService` (Render-pdf).
 */

export interface RenderEnginePayload {
  /** Nivel FULL: templateJson del DocumentDesigner. */
  templateJson?: Record<string, unknown>;
  /** Nivel MEDIO: JSON de pdfsketch ({schema:'pdfsketch@1', document} o el DocumentModel). */
  sketch?: Record<string, unknown>;
  /** Alternativa: plantilla guardada (channel=PDF con sketchJson/templateJson). */
  messageTemplateId?: string;
  /** Variables del destinatario (rutas con punto soportadas: cliente.nombre). */
  data?: Record<string, unknown>;
  /** true = subir a S3 y devolver {path,url}; false (default) = base64. */
  store?: boolean;
  filename?: string;
}

export interface RenderEngineResult {
  pdfBase64?: string;
  filename?: string;
  contentType?: string;
  path?: string;
  url?: string;
  /** Avisos del traductor (elementos no soportados, etc.). */
  warnings?: string[];
}

export const pdfEngineService = {
  render: (payload: RenderEnginePayload): Promise<ApiResponse<RenderEngineResult>> =>
    apiPost(API_CONFIG.TEMPLATES.RENDER_ENGINE, payload),
};
