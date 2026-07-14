import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de TRABAJOS / colas: visibilidad de los envíos en curso y recientes.
 *
 * Endpoint (no-proxy, envelope estándar):
 *  - POST /Admin/Jobs -> 200 { data: { jobs, counts, truncated } }
 *
 * ⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
 */

export const JOBS_ENDPOINTS = {
  LIST: '/Admin/Jobs',
};

export interface JobRow {
  processId: string;
  campaignId: string;
  campaignName: string;
  company: string;
  channel: string;
  channelLabel: string;
  processState: string;
  campaignState: string;
  registersToSend: number;
  sent: number;
  progress: number;
  blocked: { blacklist: number; unsubscribe: number; invalid: number };
  parts: number;
  date: string;
}

export interface JobsData {
  jobs: JobRow[];
  counts: Record<string, number>;
  truncated?: boolean;
}

export const jobsService = {
  /** Lista los trabajos. month='YYYY-MM' y state (processState) opcionales. */
  list: (month?: string, state?: string): Promise<ApiResponse<JobsData>> =>
    apiPost(JOBS_ENDPOINTS.LIST, {
      ...(month ? { month } : {}),
      ...(state ? { state } : {}),
    }),
};
