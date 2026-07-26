import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN del PANEL DE SALUD DE DESPLIEGUE (Bloque K).
 * POST /Admin/Deployment-health → verifica contra AWS si las lambdas/tablas/colas/envs
 * que el repo declara [J] existen de verdad (deriva "construido pero no desplegado").
 */
export const DEPLOYMENT_HEALTH_ENDPOINT = '/Admin/Deployment-health';

export type HealthItemStatus =
  | 'ok' | 'missing' | 'inactive' | 'unwired' | 'no-secret' | 'unknown';
export type SectionLevel = 'ok' | 'warning' | 'error';

export interface HealthItem {
  name: string;
  status: HealthItemStatus;
  detail: string;
}

export interface HealthSection {
  key: string;
  title: string;
  level: SectionLevel;
  ok: number;
  total: number;
  items: HealthItem[];
}

export interface DeploymentHealthData {
  sections: HealthSection[];
  summary: { ok: number; warning: number; error: number; unknown: number };
  generatedAt: string;
}

export const deploymentHealthService = {
  check: (): Promise<ApiResponse<DeploymentHealthData>> =>
    apiPost(DEPLOYMENT_HEALTH_ENDPOINT, {}),
};
