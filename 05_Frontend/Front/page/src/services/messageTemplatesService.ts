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

/** `HTML` = diseño del CONSTRUCTOR de correos (biblioteca compartida del equipo). */
export type MessageChannel = 'SMS' | 'WSP' | 'DOCX' | 'PDF' | 'HTML';

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
  /** HTML: modelo del constructor ({blocks, settings}) serializado. */
  designJson?: string;
  /** HTML: versiones ANTERIORES del diseño, la más reciente primero. */
  designHistory?: { at: string; designJson: string }[];
  /** DOCX: ruta del .docx ya subido a S3. */
  s3Path?: string;
  /** PDF (editor básico tipo Word): HTML del editor (con {{variables}}). */
  html?: string;
  /** PDF (editor medio pdfsketch): documento JSON, guardado como string. */
  sketchJson?: string;
  /** PDF (diseñador full DocumentDesigner): templateJson, guardado como string. */
  templateJson?: string;
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
  /** PDF pdfsketch: se puede enviar el objeto (el backend lo guarda como string JSON). */
  sketchJson?: Record<string, unknown> | string;
  /** PDF DocumentDesigner: ídem. */
  templateJson?: Record<string, unknown> | string;
  /** HTML: modelo del constructor de correos ({blocks, settings}) como string JSON. */
  designJson?: string;
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

/**
 * BIBLIOTECA de diseños del constructor de correos (canal `HTML` de `messageTemplate`).
 * Guarda el MODELO ({blocks, settings}), no el HTML: así el diseño se puede seguir
 * editando. Antes los "prediseñados" vivían en localStorage — se perdían al cambiar de
 * navegador y no se compartían con el equipo.
 */
export interface EmailDesign {
  messageTemplateId: string;
  name: string;
  designJson?: string;
  designHistory?: { at: string; designJson: string }[];
  created?: string;
}

export const emailDesigns = {
  save: (customerId: string, name: string, design: unknown, messageTemplateId?: string) =>
    messageTemplatesService.create({
      customerId, channel: 'HTML', name,
      designJson: JSON.stringify(design),
      ...(messageTemplateId ? { messageTemplateId } : {}),
    }),

  list: (customerId: string) => messageTemplatesService.list(customerId, 'HTML'),
};

/**
 * Diseño del constructor tal como se guarda dentro de `designJson`.
 *
 * `sesTemplate` enlaza el diseño EDITABLE con la plantilla que se publicó en SES: son dos
 * cosas distintas a propósito. SES guarda el HTML ya renderizado (lo que se envía) y no
 * puede volver a bloques; el diseño guarda el MODELO, que es lo único que se puede seguir
 * editando. Publicar escribe las dos y este campo las mantiene emparejadas.
 */
export interface EmailDesignPayload {
  blocks: unknown[];
  settings: Record<string, unknown>;
  description?: string;
  /** Nombre EXACTO de la plantilla en SES, si este diseño ya se publicó. */
  sesTemplate?: string;
  /** Asunto con el que se publicó (para no volver a escribirlo al republicar). */
  subject?: string;
}
