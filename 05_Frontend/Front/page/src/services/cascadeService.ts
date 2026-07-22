import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Cascada omnicanal — "entrega garantizada al menor costo". Define un mensaje lógico
 * (base + orden de canales + criterio de éxito) y la plataforma escala sola hasta
 * confirmar entrega/lectura. Backend: Api_V1_Cascade_{Create,Start,Status,List,Cancel}.
 */

export const CASCADE_ENDPOINTS = {
  CREATE: '/Cascade/Create',
  START: '/Cascade/Start',
  STATUS: '/Cascade/Status',
  LIST: '/Cascade/List',
  CANCEL: '/Cascade/Cancel',
};

export type CascadeChannel = 'EM' | 'SMS' | 'WSP' | 'VOZ';
export type ConfirmOn = 'delivered' | 'read';
export type CascadeRunStatus = 'draft' | 'running' | 'paused' | 'done' | 'canceled';

export interface CascadeStep {
  channel: CascadeChannel;
  /** EM: nombre de plantilla SES. */
  template?: string;
  /** EM: remitente (correo verificado). */
  from?: string;
  /** SMS: texto con {{variables}}. */
  body?: string;
  /** WSP: nombre de la plantilla HSM aprobada. */
  hsm?: string;
  /** VOZ: texto a leer con {{variables}}. */
  voiceText?: string;
}

export interface CascadeCounts {
  total?: number;
  confirmed?: number;
  exhausted?: number;
  inProgress?: number;
  spent?: number;
}

export interface CreateCascadePayload {
  name: string;
  databaseFileId: string;
  emailCol: number;
  phoneCol: number;
  nameCol: number;
  steps: CascadeStep[];
  confirmOn: ConfirmOn;
  stepTimeoutMin: number;
  budgetCap?: number;
}

export interface CascadeRunSummary {
  cascadeRunId: string;
  name: string;
  status: CascadeRunStatus;
  confirmOn: ConfirmOn;
  channels: CascadeChannel[];
  counts: CascadeCounts;
  budgetCap?: number | null;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface CascadeContactRow {
  cascadeContactId: string;
  contactId: string;
  name?: string;
  email?: string;
  phone?: string;
  status: string;
  currentChannel?: string;
  stepIndex?: number;
  spent?: number;
  attempts?: { channel: string; at: string; outcome: string; cost: number }[];
}

export interface CascadeStatusData {
  run: CascadeRunSummary & { steps: CascadeStep[]; stepTimeoutMin: number };
  contacts: CascadeContactRow[];
  byChannel: Record<string, { attempts: number; confirmed: number }>;
}

export const CHANNEL_LABEL: Record<CascadeChannel, string> = {
  EM: 'Correo', SMS: 'SMS', WSP: 'WhatsApp', VOZ: 'Voz',
};

export const cascadeService = {
  create: (payload: CreateCascadePayload): Promise<ApiResponse<{ cascadeRunId?: string; total?: number; truncated?: boolean }>> =>
    apiPost(CASCADE_ENDPOINTS.CREATE, payload),
  start: (cascadeRunId: string): Promise<ApiResponse> =>
    apiPost(CASCADE_ENDPOINTS.START, { cascadeRunId }),
  status: (cascadeRunId: string): Promise<ApiResponse<CascadeStatusData>> =>
    apiPost(CASCADE_ENDPOINTS.STATUS, { cascadeRunId }),
  list: (): Promise<ApiResponse<{ runs?: CascadeRunSummary[]; count?: number }>> =>
    apiPost(CASCADE_ENDPOINTS.LIST, {}),
  cancel: (cascadeRunId: string): Promise<ApiResponse> =>
    apiPost(CASCADE_ENDPOINTS.CANCEL, { cascadeRunId }),
};
