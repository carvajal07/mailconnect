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
  DELETE: '/Campaign/Delete',
  REQUEST_APPROVAL: '/Campaign/Request-approval',
  APPROVE: '/Campaign/Approve',
  REJECT: '/Campaign/Reject',
  PRESIGN_URL: '/Campaign/Prefirm-url',
  SEND_SAMPLES: '/Email/Send-batch-template-samples',
  SEND_REAL: '/Email/Send-batch-template',
};

/** Estado del flujo de aprobación (maker-checker; ver PLAN_APROBACIONES.md). */
export type ApprovalStatus = 'none' | 'pending' | 'approved' | 'rejected';

/** Un envío de muestras registrado en la campaña (historial para el aprobador). */
export interface SampleBatch {
  batchId: string;
  tipo: 'aleatorias' | 'selectivas';
  recipients: string[];
  quantity: number;
  sentBy: string;
  sentByName?: string;
  sentAt: string;
}

/** Formato del documento en campañas EAP (adjunto personalizado por destinatario):
 *  - DOCX: combinación de correspondencia (.docx) → lambda de combinación Word.
 *  - PDF:  personalización de campos en un PDF → lambda de armado de PDF (distinto costo/flujo).
 *  EAU y el resto de canales no usan este campo. */
export type EapDocumentFormat = 'DOCX' | 'PDF';

/** Campos editables de una campaña (solo si está en estado Pendiente). */
export interface CampaignUpdatePayload {
  campaignId: string;
  campaignName?: string;
  channelName?: string;
  attachmentType?: string;
  dataPath?: string;
  template?: string;
  from?: string;
  documentFormat?: EapDocumentFormat;
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
  /** Envíos de muestras ya realizados (máx. 5 por campaña; lo controla el backend). */
  samplesSentCount?: number;
  /** Formato del documento EAP (DOCX/PDF), si aplica. */
  documentFormat?: EapDocumentFormat;
  /** Modo de entrega del adjunto (NONE/ONFILE/ONLINE), si aplica (EAU/EAP). Afecta la tarifa. */
  attachmentType?: string;
  /** processId del envío real (lo fija Prepare-batch al enviar). Sirve para el reporte de estado. */
  sendProcessId?: string;
  /** Flujo de aprobación (maker-checker). Ver PLAN_APROBACIONES.md. */
  approvalStatus?: ApprovalStatus;
  approvalRequestedBy?: string;
  approvalRequestedByName?: string;
  approvalRequestedAt?: string;
  approvalReviewedBy?: string;
  approvalReviewedByName?: string;
  approvalReviewedAt?: string;
  approvalRejectReason?: string;
  /** Historial de envíos de muestras (para la bandeja de aprobación). */
  sampleBatches?: SampleBatch[];
}

/** Máximo de envíos de muestras por campaña (debe coincidir con MAX_SAMPLE_SENDS del backend). */
export const MAX_SAMPLE_SENDS = 5;

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
  /** Documento(s) adjunto(s) para EAU/EAP: lista de { path } (ruta en S3). */
  attachment?: { path: string }[];
  /** ¿El adjunto (EAP) usa combinación de correspondencia por destinatario? */
  variableDocument?: boolean;
  /** Formato del documento EAP: DOCX (combinación Word) o PDF (campos personalizados). */
  documentFormat?: EapDocumentFormat;
}

/**
 * Tipo de documento = PREFIJO de la key dentro del bucket único del cliente:
 *  - database:   bases (CSV) de los envíos.            [privado]
 *  - document:   archivos del cliente (comprobantes).  [privado]
 *  - resources:  imágenes de las plantillas.           [público]
 *  - attachment: plantillas docx/pdf y combinados.     [público]
 */
export type DocumentType = 'database' | 'document' | 'resources' | 'attachment';

export interface PresignPayload {
  customer: string;
  /** NIT del cliente (companyTin): define el bucket único {prefix}-{nit}. */
  nit?: string;
  documentName: string;
  documentType: DocumentType;
}

/** Prefijo de los buckets por cliente (debe coincidir con el backend BUCKET_PREFIX). */
export const BUCKET_PREFIX = 'mailconnect';

/** Bucket ÚNICO del cliente por NIT: {prefix}-{nit} (DNS-safe). El tipo va como prefijo
 *  de la key (database/document/resources/attachment), no como bucket separado. */
export const tenantBucket = (nit: string): string =>
  `${BUCKET_PREFIX}-${(nit || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

export const campaignsService = {
  create: (payload: CampaignPayload): Promise<ApiResponse<{ campaignId?: string }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.CREATE, payload),

  /** Lista las campañas del cliente (ruta /Campaign/List). */
  list: (customerId: string): Promise<ApiResponse<{ campaigns?: CampaignSummary[]; count?: number }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.LIST, { customerId }),

  /** Edita una campaña en estado Pendiente (ruta /Campaign/Update). */
  update: (payload: CampaignUpdatePayload): Promise<ApiResponse<{ campaignId?: string }>> =>
    apiPost(CAMPAIGN_ENDPOINTS.UPDATE, payload),

  /** Elimina una campaña (ruta /Campaign/Delete). Verifica el tenant en el backend. */
  delete: (campaignId: string): Promise<ApiResponse> =>
    apiPost(CAMPAIGN_ENDPOINTS.DELETE, { campaignId }),

  /** Solicita la aprobación de una campaña (el funcional; requiere haber enviado muestras). */
  requestApproval: (campaignId: string): Promise<ApiResponse> =>
    apiPost(CAMPAIGN_ENDPOINTS.REQUEST_APPROVAL, { campaignId }),

  /** Aprueba una campaña pendiente (el aprobador). Habilita el envío real. */
  approve: (campaignId: string): Promise<ApiResponse> =>
    apiPost(CAMPAIGN_ENDPOINTS.APPROVE, { campaignId }),

  /** Rechaza una campaña pendiente con un motivo (el aprobador). */
  reject: (campaignId: string, reason: string): Promise<ApiResponse> =>
    apiPost(CAMPAIGN_ENDPOINTS.REJECT, { campaignId, reason }),

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
   * URL pública (lectura) de un objeto ya subido a S3, para el src de las imágenes del
   * correo o el enlace de descarga de un adjunto. `path` ya incluye el prefijo del tipo
   * (resources/… o attachment/…), que son los prefijos PÚBLICOS del bucket del cliente.
   */
  publicUrl: (nit: string, path: string): string =>
    `https://s3.us-east-1.amazonaws.com/${tenantBucket(nit)}/${path}`,
};
