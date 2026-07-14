import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN del PANEL DE CONTROL GLOBAL. Agrega métricas macro de todos los
 * clientes: volumen, embudo, por canal y salud de envíos (reputación).
 *
 * Endpoint (no-proxy, envelope estándar):
 *  - POST /Admin/Dashboard -> 200 { data: { kpis, funnel, byChannel, health } }
 *
 * ⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
 */

export const DASHBOARD_ENDPOINTS = {
  SUMMARY: '/Admin/Dashboard',
};

export type HealthLevel = 'ok' | 'warning' | 'critical';

export interface DashboardKpis {
  customers: number;
  activeCampaigns: number;
  pendingCampaigns: number;
  totalSent: number;
  delivered: number;
  deliveryRate: number;
  bounceRate: number;
  complaintRate: number;
  atRisk: number;
}

export interface FunnelStepData {
  label: string;
  value: number;
}

export interface ChannelVolume {
  channel: string;
  label: string;
  sent: number;
}

export interface HealthRow {
  customerId: string;
  company: string;
  sent: number;
  delivered: number;
  bounces: number;
  complaints: number;
  bounceRate: number;
  complaintRate: number;
  level: HealthLevel;
  reason: string;
}

export interface DashboardData {
  month: string;
  generatedAt: string;
  kpis: DashboardKpis;
  funnel: FunnelStepData[];
  byChannel: ChannelVolume[];
  health: HealthRow[];
  truncated?: boolean;
}

export const dashboardService = {
  /** Panel global. month='YYYY-MM' opcional (vacío = todo). */
  summary: (month?: string): Promise<ApiResponse<DashboardData>> =>
    apiPost(DASHBOARD_ENDPOINTS.SUMMARY, month ? { month } : {}),
};
