import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de CASCADA omnicanal (Opción A — "entrega garantizada al menor costo").
 * Ver PLAN_CASCADA.md. Define un mensaje lógico + orden de canales; la plataforma escala
 * automáticamente hasta confirmar o agotar. Endpoints (no-proxy, envelope):
 *   - POST /Cascade/Dispatch  -> lanza la cascada (crea run + contactos, envía paso 0)
 *   - POST /Cascade/List      -> runs del tenant + progreso
 */
export const CASCADE_ENDPOINTS = {
  DISPATCH: '/Cascade/Dispatch',
  LIST: '/Cascade/List',
};

/** Canal soportado por la cascada v1 (sin adjuntos EAU/EAP). */
export type CascadeChannel = 'EM' | 'SMS' | 'WSP' | 'VOZ';
export type SuccessCriterion = 'sent' | 'delivered' | 'read';

export interface CascadeStep {
  channel: CascadeChannel;
  /** Contenido listo para enviar: plantilla SES (EM), texto (SMS/VOZ) o nombre HSM (WSP). */
  content: string;
  /** Espera (min) antes de escalar DESDE este paso. Si falta, usa la del run (flujo de decisión). */
  waitMinutes?: number;
  /** Qué cuenta como confirmado en este paso. Si falta, usa el del run. */
  successCriterion?: SuccessCriterion;
}

export interface CascadeDispatchPayload {
  name: string;
  dataPath: string;
  waitMinutes: number;
  successCriterion: SuccessCriterion;
  steps: CascadeStep[];
}

export interface CascadeRun {
  cascadeRunId: string;
  name: string;
  steps: CascadeStep[];
  successCriterion: SuccessCriterion;
  waitMinutes: number;
  status: 'running' | 'done' | 'canceled';
  counts?: { total: number; confirmed: number; exhausted: number; inFlight: number; budget: number };
  createdAt: string;
}

export const cascadeService = {
  dispatch: (payload: CascadeDispatchPayload): Promise<ApiResponse<{ cascadeRunId?: string; contacts?: number; debited?: number }>> =>
    apiPost(CASCADE_ENDPOINTS.DISPATCH, payload),

  list: (): Promise<ApiResponse<{ runs?: CascadeRun[]; count?: number }>> =>
    apiPost(CASCADE_ENDPOINTS.LIST, {}),
};
