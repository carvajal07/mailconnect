import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de Campañas — conectado a las lambdas reales.
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - Create-campaign  (POST /Campaign/Create-campaign)
 *      { customerId, campaignName, channelName, attachmentType, dataPath, template, from }
 *      -> 201 { data: { campaignId } }
 *  - Prefirm-url      (POST /Campaign/Prefirm-url) — URL prefirmada de S3
 *      { customer, documentName, documentType } -> 200 { data: { url, path } }
 *  - Send-batch-template-samples (POST /Email/Send-batch-template-samples) — muestras
 *
 * Aún NO hay rutas para "listar campañas" ni "envío real" confirmado; esas acciones
 * quedan deshabilitadas o marcadas en la UI.
 */

export const CAMPAIGN_ENDPOINTS = {
  CREATE: '/Campaign/Create-campaign',
  LIST: '/Campaign/List',
  UPDATE: '/Campaign/Update',
  PRESIGN_URL: '/Campaign/Prefirm-url',
  SEND_SAMPLES: '/Email/Send-batch-template-samples',
  SEND_REAL: '/Email/Send-batch-template',
};

/** Campos editables de una campaña (solo si está en estado Pendiente). */
export interface CampaignUpdatePayload {
  campaignId: string;
  campaignName?: string;
  channelName?: string;
  attachmentType?: string;
  dataPath?: string;
  template?: string;
  from?: string;
}

/** Campaña como la devuelve POST /Campaign/List (tabla `campaign`). */
export interface CampaignSummary {
  campaignId: string;
  customerId: string;
  campaignName: string;
  consecutive: string;
  channel: string;
  campaignState: string;
  dataPath: string;
  template: string;
  originEmail: string;
  date: string;
}

export interface SamplesPayload {
  customerName: string;
  campaignName: string;
  userId: string;
  template: string;
  templateVersion: number;
  quantitySamples: number;
  selectiveSamples: boolean;
  recipients: string[];
  identifications: string[];
}

/**
 * Envío REAL de la campaña (la "aprobación"). Va a la misma Lambda que las muestras
 * (Prepare-batch-template) pero por la ruta /Email/Send-batch-template; al no contener
 * "samples", la Lambda entra al flujo de envío real y deja la campaña en "Enviando".
 * Requiere que la campaña esté en estado "Pendiente" o "Muestras".
 */
export interface RealSendPayload {
  customerName: string;
  campaignName: string;
  userId: string;
  template: string;
  templateVersion: number;
}

export interface CampaignPayload {
  customerId: string;
  campaignName: string;
  channelName: string;
  attachmentType: string;
  dataPath: string;
  template: string;
  from: string;
}

export interface PresignPayload {
  customer: string;
  documentName: string;
  documentType: 'database' | 'document';
}

export const campaignsService = {
  create: (payload: CampaignPayload): Promise<ApiResponse<{ campaignId?: string }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.CREATE, payload),

  /** Lista las campañas del cliente (ruta /Campaign/List). */
  list: (customerId: string): Promise<ApiResponse<{ campaigns?: CampaignSummary[]; count?: number }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.LIST, { customerId }),

  /** Edita una campaña en estado Pendiente (ruta /Campaign/Update). */
  update: (payload: CampaignUpdatePayload): Promise<ApiResponse<{ campaignId?: string }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.UPDATE, payload),

  /** Solicita una URL prefirmada de S3 para subir el archivo (CSV/documento). */
  presignUrl: (payload: PresignPayload): Promise<ApiResponse<{ url?: string; path?: string }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.PRESIGN_URL, payload),

  /** Envía muestras de la campaña (ruta /Email/Send-batch-template-samples). */
  sendSamples: (payload: SamplesPayload): Promise<ApiResponse> =>
    apiPost(CAMPAIGN_ENDPOINTS.SEND_SAMPLES, payload),

  /** Dispara el envío REAL de la campaña tras la aprobación (ruta /Email/Send-batch-template). */
  sendReal: (payload: RealSendPayload): Promise<ApiResponse> =>
    apiPost(CAMPAIGN_ENDPOINTS.SEND_REAL, payload),

  /** Sube el archivo a S3 con la URL prefirmada (PUT directo). Devuelve true si OK. */
  uploadToS3: async (url: string, file: File): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * URL pública (lectura) de un objeto ya subido a S3. Se usa para el src de las
   * imágenes del correo. Usa estilo path (compatible con buckets con punto, p. ej.
   * "cliente.document"). El objeto/bucket debe permitir lectura pública para que la
   * imagen se vea en los clientes de correo.
   */
  publicUrl: (customer: string, documentType: 'database' | 'document', path: string): string =>
    `https://s3.us-east-1.amazonaws.com/${customer.toLowerCase()}.${documentType}/${path}`,
};
