import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';
import type { CampaignSummary } from './campaignsService';

/**
 * Servicio ADMIN: vista GLOBAL de campañas de todos los clientes (ruta /Admin/Campaigns).
 * A diferencia de campaignsService.list (acotada al tenant del token), esta une el nombre
 * de la empresa a cada campaña y admite filtros. Solo la usa el panel admin.
 *
 * ⚠️ Endpoint administrativo: la lambda valida el rol admin.
 */

export interface AdminCampaignRow extends CampaignSummary {
  company: string;
  companyTin?: string | number;
}

export interface AdminCampaignFilters {
  month?: string;
  state?: string;
  customerId?: string;
  channel?: string;
}

export interface AdminCampaignsData {
  campaigns: AdminCampaignRow[];
  customers: { customerId: string; company: string }[];
  count: number;
  truncated: boolean;
}

export const adminCampaignsService = {
  list: (filters: AdminCampaignFilters = {}): Promise<ApiResponse<AdminCampaignsData>> =>
    apiPost('/Admin/Campaigns', {
      month: filters.month || '',
      state: filters.state || '',
      customerId: filters.customerId || '',
      channel: filters.channel || '',
    }),
};
