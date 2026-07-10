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
};

export interface StatsResult {
  campaigns: CampaignStat[];
  truncated?: boolean;
}

export const statsService = {
  statistics: (customerId: string, customer: string): Promise<ApiResponse<StatsResult>> =>
    apiPost(STATS_ENDPOINTS.STATISTICS, { customerId, customer }),
};
