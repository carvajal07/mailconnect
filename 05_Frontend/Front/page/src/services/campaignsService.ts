import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de Campañas — conectado a las lambdas reales.
 *
 * Endpoints disponibles en el backend (integración no-proxy, envelope estándar):
 *  - create-campaign  (POST /email/config/create-campaign)
 *      { customerId, campaignName, channelName, attachmentType, dataPath, template, from }
 *      -> 201 { data: { campaignId } }
 *  - get-urlS3        (POST /get-urlS3)
 *      { customer, documentName, documentType } -> 200 { data: { url, path } }
 *      La `url` es prefirmada para subir el archivo con PUT directo a S3.
 *
 * ⚠️ El backend NO expone "listar campañas", "enviar muestras" ni "envío real"
 * como endpoints REST todavía; esas acciones quedan deshabilitadas en la UI.
 */

export const CAMPAIGN_ENDPOINTS = {
  CREATE: '/email/config/create-campaign',
  PRESIGN_URL: '/get-urlS3',
};

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

  /** Solicita una URL prefirmada de S3 para subir el archivo (CSV/documento). */
  presignUrl: (payload: PresignPayload): Promise<ApiResponse<{ url?: string; path?: string }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.PRESIGN_URL, payload),

  /** Sube el archivo a S3 con la URL prefirmada (PUT directo). Devuelve true si OK. */
  uploadToS3: async (url: string, file: File): Promise<boolean> => {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'text/csv' },
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
