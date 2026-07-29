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

/**
 * CENTRO DE NOTIFICACIONES del portal (POST /Notifications/List).
 *
 * ⚠️ Son notificaciones POR USUARIO, no por empresa: quien aprueba una campaña no es quien
 * la preparó, y mostrarle a todo el equipo los avisos de todos convierte el panel en ruido.
 * El destinatario sale del token, nunca del body.
 */
export const NOTIFICATIONS_LIST_ENDPOINT = '/Notifications/List';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export interface PortalNotification {
  notificationId: string;
  /** `campaign.approval` · `campaign.approved` · `campaign.rejected` · `balance.low` … */
  kind: string;
  title: string;
  body: string;
  level: NotificationLevel;
  /** Tab del portal al que lleva el aviso (ej. `aprobaciones`). Vacío = no navega. */
  link: string;
  read: boolean;
  createdAt: string;
}

interface InboxData {
  items?: PortalNotification[];
  unread?: number;
}

export const notificationsInbox = {
  list: (limit?: number): Promise<ApiResponse<InboxData>> =>
    apiPost(NOTIFICATIONS_LIST_ENDPOINT, limit ? { limit } : {}),

  markRead: (notificationId: string): Promise<ApiResponse<InboxData>> =>
    apiPost(NOTIFICATIONS_LIST_ENDPOINT, { action: 'read', notificationId }),

  markAllRead: (): Promise<ApiResponse<InboxData>> =>
    apiPost(NOTIFICATIONS_LIST_ENDPOINT, { action: 'read-all' }),
};
