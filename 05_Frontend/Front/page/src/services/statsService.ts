import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';
import type { CampaignStat } from '../components/portal/campaignData';

/**
 * Servicio de Estadísticas — métricas agregadas por campaña.
 *
 * Endpoint real: Api_V1_Reports_Statistics (POST /Report/Statistics). NO usa Bedrock;
 * lee DynamoDB directo (campaign + process + {customer}_sendStatus_{proceso}), así
 * que es barato de llamar cada vez que se abre el tablero.
 *
 * Request:  { customerId, customer }
 * Response: 200 { data: { campaigns: CampaignStat[], truncated } }
 */

export const STATS_ENDPOINTS = {
  STATISTICS: '/Report/Statistics',
  SERIES: '/Report/Series',
};

export interface StatsResult {
  campaigns: CampaignStat[];
  truncated?: boolean;
}

/** Un día de la serie de actividad (Report/Series — rollup sendSummary). */
export interface SeriesDay {
  date: string; // YYYY-MM-DD
  enviados: number;
  entregados: number;
  abiertos: number;
  clics: number;
  rebotes: number;
  quejas: number;
}

export interface SeriesResult {
  from: string;
  to: string;
  days: SeriesDay[];
  totals: Omit<SeriesDay, 'date'>;
  withoutRollup?: number;
}

export const statsService = {
  statistics: (customerId: string, customer: string): Promise<ApiResponse<StatsResult>> =>
    apiPost(STATS_ENDPOINTS.STATISTICS, { customerId, customer }),
  /** Serie diaria de los últimos N días (default 30) del tenant del token. */
  series: (days = 30): Promise<ApiResponse<SeriesResult>> =>
    apiPost(STATS_ENDPOINTS.SERIES, { days }),
};
