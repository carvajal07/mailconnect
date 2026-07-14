import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de TARIFAS (tabla `pricingRate`). Lista y edita las tarifas por
 * canal, a nivel GLOBAL ('*') o por cliente (override). Consistente con el estimador
 * de costos (Api_V1_Cost_Estimate).
 *
 * Endpoints (no-proxy, envelope estándar):
 *  - POST /Pricing/List   -> 200 { data: { customerId, defaults, effective, overrides } }
 *  - POST /Pricing/Update -> 200 ok
 *
 * ⚠️ Endpoints administrativos: restringir a rol admin en el despliegue.
 */

export const PRICING_ENDPOINTS = {
  LIST: '/Pricing/List',
  UPDATE: '/Pricing/Update',
};

export type PricingChannel = 'EMAIL' | 'SMS' | 'WHATSAPP' | 'VOICE';
export type PricingUpdateChannel = PricingChannel | 'COMMON';

/** Mapa campo -> valor por canal. */
export type ChannelRates = Record<string, number>;
export type RatesByChannel = Record<PricingChannel, ChannelRates>;

export interface PricingListData {
  customerId: string;
  currency: string;
  /** Valores por defecto embebidos (lo que aplica sin nada en la tabla). */
  defaults: RatesByChannel;
  /** Lo que realmente aplicaría el estimador (defaults → global → cliente). */
  effective: RatesByChannel;
  /** Solo lo guardado explícitamente en ESTE alcance. */
  overrides: RatesByChannel;
}

export const pricingService = {
  /** Tarifas de un alcance: '*' (global) o un customerId de cliente. */
  list: (customerId = '*'): Promise<ApiResponse<PricingListData>> =>
    apiPost(PRICING_ENDPOINTS.LIST, { customerId }),

  /** Guarda campos de un canal (o COMMON para taxRate/minCampaign en todos). */
  update: (
    customerId: string,
    channel: PricingUpdateChannel,
    fields: ChannelRates,
  ): Promise<ApiResponse<{ customerId?: string; channel?: string; fields?: string[] }>> =>
    apiPost(PRICING_ENDPOINTS.UPDATE, { customerId, channel, fields }),
};
