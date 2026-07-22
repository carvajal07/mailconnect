import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de PLANTILLAS DE MENSAJE por canal no-SES: SMS, WhatsApp (WSP) y DOCX
 * (combinación de correspondencia). Las plantillas de correo HTML siguen en SES
 * (templatesService); estas viven en la tabla DynamoDB `messageTemplate`.
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - POST /MessageTemplate/Create -> 201 { data: { messageTemplateId } }
 *  - POST /MessageTemplate/List   -> 200 { data: { templates, count } }
 *  - POST /MessageTemplate/Delete -> 200 ok
 */

export const MESSAGE_TEMPLATE_ENDPOINTS = {
  CREATE: '/MessageTemplate/Create',
  LIST: '/MessageTemplate/List',
  DELETE: '/MessageTemplate/Delete',
};

export type MessageChannel = 'SMS' | 'WSP' | 'DOCX' | 'PDF';

export interface MessageTemplate {
  messageTemplateId: string;
  customerId: string;
  customer?: string;
  channel: MessageChannel;
  name: string;
  /** SMS: texto con {{variables}}. */
  body?: string;
  /** WSP: nombre de la plantilla HSM aprobada por Meta. */
  hsmName?: string;
  /** WSP: idioma de la plantilla (default 'es'). */
  language?: string;
  /** DOCX: ruta del .docx ya subido a S3. */
  s3Path?: string;
  /** PDF: HTML del editor (con {{variables}}), que se renderiza por destinatario. */
  html?: string;
  /** WSP: etiquetas de los parámetros {{1}},{{2}}… · DOCX: campos de combinación. */
  params?: string[];
  created?: string;
}

export interface CreateMessageTemplatePayload {
  customerId: string;
  customer?: string;
  channel: MessageChannel;
  name: string;
  body?: string;
  hsmName?: string;
  language?: string;
  s3Path?: string;
  html?: string;
  params?: string[];
  /** Si se envía, la ruta Create ACTUALIZA esa plantilla (upsert) en vez de crear una nueva. */
  messageTemplateId?: string;
}

export const messageTemplatesService = {
  /** Crea (sin id) o ACTUALIZA (con messageTemplateId) una plantilla — upsert. */
  create: (payload: CreateMessageTemplatePayload): Promise<ApiResponse<{ messageTemplateId?: string }>> =>
    apiPost(MESSAGE_TEMPLATE_ENDPOINTS.CREATE, payload),

  /** Lista las plantillas del cliente; opcionalmente filtra por canal. */
  list: (customerId: string, channel?: MessageChannel): Promise<ApiResponse<{ templates?: MessageTemplate[]; count?: number }>> =>
    apiPost(MESSAGE_TEMPLATE_ENDPOINTS.LIST, channel ? { customerId, channel } : { customerId }),

  delete: (messageTemplateId: string): Promise<ApiResponse> =>
    apiPost(MESSAGE_TEMPLATE_ENDPOINTS.DELETE, { messageTemplateId }),
};
