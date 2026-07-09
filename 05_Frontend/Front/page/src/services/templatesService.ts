import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de Plantillas — conectado a las lambdas reales de Template.
 *
 * Endpoints disponibles en el backend (integración no-proxy, envelope estándar):
 *  - create-template  { userId, customerId, channel, templateName, subject, htmlBody, textBody } -> 201
 *  - get-template     { userId, templateName } -> 200 { ..., template: <SES Template> }
 *  - delete-template  { userId, templateName } -> 201
 *
 * ⚠️ El backend NO expone "listar/buscar/actualizar" plantillas todavía, así que
 * la sección mantiene una lista local (de lo creado/consultado en la sesión).
 */

// Endpoints reales de Template (módulo /Template).
export const TEMPLATE_ENDPOINTS = {
  CREATE: '/Template/Create-template',
  GET: '/Template/Get-template',
  DELETE: '/Template/Delete-template',
};

export interface TemplatePayload {
  userId: string;
  customerId: string;
  channel: number;
  templateName: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

/** Estructura de plantilla que devuelve SES en get-template. */
export interface SesTemplate {
  TemplateName: string;
  SubjectPart?: string;
  HtmlPart?: string;
  TextPart?: string;
}

/** get-template devuelve el template a nivel raíz del envelope (no en `data`). */
export type GetTemplateResponse = ApiResponse & { template?: SesTemplate };

export const templatesService = {
  create: (payload: TemplatePayload) => apiPost(TEMPLATE_ENDPOINTS.CREATE, payload),

  get: (userId: string, templateName: string): Promise<GetTemplateResponse> =>
    apiPost(TEMPLATE_ENDPOINTS.GET, { userId, templateName }) as Promise<GetTemplateResponse>,

  remove: (userId: string, templateName: string) =>
    apiPost(TEMPLATE_ENDPOINTS.DELETE, { userId, templateName }),
};
