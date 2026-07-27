import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio del ESTIMADOR DE COSTOS (POST /Cost/Estimate, lambda Api_V1_Cost_Estimate).
 *
 * Devuelve un valor ESTIMADO de la campaña antes de enviarla, con el desglose por
 * concepto. Soporta los 4 canales: EMAIL (submodo EM/EAU/EAP), SMS, WHATSAPP, VOICE.
 */

export const COST_ENDPOINTS = {
  ESTIMATE: '/Cost/Estimate',
  ATTACHMENT_WEIGHT: '/Cost/Attachment-weight',
};

export type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'VOICE';
export type EmailMode = 'EM' | 'EAU' | 'EAP';

export interface EstimatePayload {
  customerId?: string;
  channel: Channel;
  recipients: number;
  emailMode?: EmailMode;
  attachmentSizeMB?: number;
  attachmentType?: 'pdf' | 'docx';                 // formato del documento (EAP)
  attachmentDelivery?: 'ONFILE' | 'ONLINE';        // modo de entrega del adjunto (EAU/EAP)
  smsSegments?: number;
  voiceMinutes?: number;
}

export interface EstimateLine {
  concept: string;
  detail: string;
  amount: number;
}

export interface EstimateResult {
  currency: string;
  channel: Channel;
  recipients: number;
  unitCost: number;
  subtotal: number;
  taxRate: number;
  tax: number;
  estimatedCost: number;
  appliedMinimum: boolean;
  breakdown: EstimateLine[];
  isEstimate: boolean;
  note: string;
}

/**
 * Peso REAL del adjunto de una campaña (POST /Cost/Attachment-weight).
 * EAU → tamaño exacto del archivo en S3. EAP-PDF → promedio de N PDFs generados con
 * registros reales de la base + margen de seguridad. EAP-DOCX → plantilla + margen.
 */
export interface AttachmentWeight {
  mode: 'EAU' | 'EAP';
  format: string;
  /** true = medida exacta (el archivo existe); false = estimada con margen. */
  exact: boolean;
  samples: number;
  avgBytes: number;
  minBytes: number;
  maxBytes: number;
  marginPct: number;
  /** Lo que se le pasa al estimador como `attachmentSizeMB`. */
  sizeMB: number;
  note: string;
}

export const costService = {
  estimate: (payload: EstimatePayload): Promise<ApiResponse<EstimateResult>> =>
    apiPost(COST_ENDPOINTS.ESTIMATE, payload),

  attachmentWeight: (campaignId: string, samples?: number): Promise<ApiResponse<AttachmentWeight>> =>
    apiPost(COST_ENDPOINTS.ATTACHMENT_WEIGHT, { campaignId, samples }),
};

/** Formatea un valor en pesos colombianos. */
export const formatCOP = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
