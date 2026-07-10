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
};

export type Channel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'VOICE';
export type EmailMode = 'EM' | 'EAU' | 'EAP';

export interface EstimatePayload {
  customerId?: string;
  channel: Channel;
  recipients: number;
  emailMode?: EmailMode;
  attachmentSizeMB?: number;
  attachmentType?: 'pdf' | 'docx';
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

export const costService = {
  estimate: (payload: EstimatePayload): Promise<ApiResponse<EstimateResult>> =>
    apiPost(COST_ENDPOINTS.ESTIMATE, payload),
};

/** Formatea un valor en pesos colombianos. */
export const formatCOP = (value: number): string =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
