import { apiPost, type ApiResponse } from './apiClient';
import type { CampaignSummary } from './campaignsService';
import type { DatabaseFile } from './databaseService';
import type { BlacklistItem } from './blacklistService';
import type { MessageTemplate } from './messageTemplatesService';

/**
 * Servicio de ARRANQUE del portal (Capa 2 del caché): una sola llamada que trae
 * campañas + bases + lista negra + plantillas de mensaje del cliente. Colapsa el
 * "waterfall" de 4 peticiones tras el login en 1 (gran mejora en redes móviles).
 *
 * Endpoint real: POST /Portal/Bootstrap  (tenant del token; no recibe body).
 * Las ESTADÍSTICAS se cargan aparte (agregación pesada, tab Estadísticas).
 */
export const BOOTSTRAP_ENDPOINT = '/Portal/Bootstrap';

export interface BootstrapData {
  campaigns?: CampaignSummary[];
  databases?: DatabaseFile[];
  blacklist?: BlacklistItem[];
  messageTemplates?: MessageTemplate[];
  errors?: Record<string, string>;
}

export const bootstrapService = {
  load: (): Promise<ApiResponse<BootstrapData>> => apiPost(BOOTSTRAP_ENDPOINT, {}),
};
