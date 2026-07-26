import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Preferencias de NOTIFICACIÓN del cliente (Bloque H) — endpoint
 * Api_V1_Notifications_Prefs (POST /Notifications/Prefs, tenant del token; guardar
 * solo el owner). El aviso de saldo bajo lo dispara Prepare-batch; reputación/resumen
 * la lambda programada Api_V1_Notifications_Scan.
 */
export const NOTIFICATIONS_ENDPOINT = '/Notifications/Prefs';

export interface NotifyPrefs {
  /** Aviso cuando la reputación (rebote/queja) cruza los umbrales de SES. */
  reputation: boolean;
  /** Resumen diario de la actividad de envío. */
  digest: boolean;
  /** Aviso de saldo bajo tras un envío. */
  lowBalance: boolean;
  /** Umbral (COP) por debajo del cual avisar saldo bajo. */
  lowBalanceThreshold: number;
}

export const notificationsService = {
  get: (): Promise<ApiResponse<{ notify: NotifyPrefs }>> =>
    apiPost(NOTIFICATIONS_ENDPOINT, { action: 'get' }),
  set: (prefs: Partial<NotifyPrefs>): Promise<ApiResponse<{ notify: NotifyPrefs }>> =>
    apiPost(NOTIFICATIONS_ENDPOINT, { action: 'set', prefs }),
};
