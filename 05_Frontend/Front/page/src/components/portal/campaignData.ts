/**
 * Tipos de métricas de campaña compartidos por Estadísticas y Reportes.
 *
 * Los datos reales los provee `statsService` (POST /Report/Statistics, lambda
 * `Api_V1_Reports_Statistics`, sin Bedrock) con esta misma forma (`CampaignStat`).
 */

export type Estado = 'pendiente' | 'creada' | 'enviada';

export interface CampaignStat {
  id: string;
  name: string;
  estado: Estado;
  /** Estado real de la campaña en el backend (Pendiente/Muestras/Enviando/…). */
  rawState?: string;
  enviados: number;
  entregados: number;
  abiertos: number;
  clics: number;
  rebotes: number;
  quejas: number;
}

export const ESTADO_LABEL: Record<Estado, string> = {
  pendiente: 'Pendiente',
  creada: 'Creada',
  enviada: 'Enviada',
};

export const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
