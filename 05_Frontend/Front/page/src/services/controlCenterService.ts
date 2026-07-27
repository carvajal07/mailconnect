import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN del CENTRO DE MANDO (tablero de operación en vivo).
 * POST /Admin/Control-center → una sola llamada con todas las secciones.
 */

export interface StuckProcess {
  processId: string;
  customerName: string;
  campaignName: string;
  processState: string;
  date: string;
  hoursStuck: number;
}

export interface FailedSchedule {
  scheduleId: string;
  campaignName: string;
  customerId: string;
  scheduledAt: string;
  error: string;
}

export interface QueueStatus {
  queue: string;
  depth: number;
  oldestSeconds: number;
  dlqDepth: number;
  level: 'ok' | 'warning' | 'critical';
  error?: string;
}

export interface ReputationRow {
  company: string;
  tenant: string;
  sent: number;
  bounceRate: number;
  complaintRate: number;
  prevBounceRate: number | null;
  level: 'ok' | 'warning' | 'critical';
  trend: 'up' | 'down' | 'flat';
}

export interface ServiceHealth {
  service: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
  metric?: { used: number; max: number; pct: number };
}

export interface AuditEntry {
  date: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface ControlCenterData {
  pipeline: {
    stuckProcesses: StuckProcess[];
    stuckCount: number;
    failedSchedules: FailedSchedule[];
    queues: QueueStatus[];
    error?: string;
  };
  money: {
    todayDebits: number;
    todayDebitsCount: number;
    todayTopups: number;
    todayTopupsCount: number;
    pendingTopups: { count: number; amount: number };
    /** Saldo sumado de los clientes EXISTENTES (coincide con el tab Saldos). */
    platformBalance: number;
    /** Saldo que quedó en customerBalance de clientes ya eliminados (informativo). */
    orphanBalance?: number;
    orphanCount?: number;
    error?: string;
  };
  reputation: { top: ReputationRow[]; truncated?: boolean; error?: string };
  health: { services: ServiceHealth[] };
  audit: AuditEntry[];
  generatedAt: string;
}

export const controlCenterService = {
  get: (): Promise<ApiResponse<ControlCenterData>> => apiPost('/Admin/Control-center', {}),
};
