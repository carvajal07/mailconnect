import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de ENVÍOS PROGRAMADOS (tabla `scheduledSend`).
 *
 * El cliente agenda el envío REAL de una campaña aprobada para una fecha/hora futura; un cron
 * (Api_V1_Schedule_Dispatch) lo dispara reusando Prepare-batch (mismos gates de aprobación,
 * saldo y RBAC que el envío on-demand).
 *
 * Endpoints (no-proxy, envelope estándar):
 *  - POST /Schedule/Create { campaignId, scheduledAt (ISO UTC), templateVersion? } -> 201
 *  - POST /Schedule/List   {}                                                      -> 200 { schedules }
 *  - POST /Schedule/Cancel { scheduleId }                                          -> 200
 */

export const SCHEDULE_ENDPOINTS = {
  CREATE: '/Schedule/Create',
  LIST: '/Schedule/List',
  CANCEL: '/Schedule/Cancel',
};

export type ScheduleStatus = 'pending' | 'firing' | 'sent' | 'canceled' | 'failed';

export interface ScheduledSend {
  scheduleId: string;
  campaignId: string;
  campaignName: string;
  /** Fecha-hora programada en UTC ISO 8601 (ej. 2026-07-20T15:30:00.000Z). */
  scheduledAt: string;
  status: ScheduleStatus;
  createdAt?: string;
  firedAt?: string;
  processId?: string;
  error?: string;
}

export const scheduleService = {
  /** Programa el envío real de una campaña para una fecha/hora futura (UTC ISO). */
  create: (
    campaignId: string,
    scheduledAt: string,
    templateVersion = 1,
  ): Promise<ApiResponse<{ scheduleId?: string; scheduledAt?: string; status?: ScheduleStatus }>> =>
    apiPost(SCHEDULE_ENDPOINTS.CREATE, { campaignId, scheduledAt, templateVersion }),

  /** Lista los envíos programados del cliente. */
  list: (): Promise<ApiResponse<{ schedules?: ScheduledSend[]; count?: number }>> =>
    apiPost(SCHEDULE_ENDPOINTS.LIST, {}),

  /** Cancela un envío programado que aún esté pendiente. */
  cancel: (scheduleId: string): Promise<ApiResponse> =>
    apiPost(SCHEDULE_ENDPOINTS.CANCEL, { scheduleId }),
};
