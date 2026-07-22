import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de Bases de datos — metadata de los CSV subidos a S3.
 *
 * El archivo se sube a S3 con la URL prefirmada (campaignsService); esta capa
 * guarda/lista su metadata (nombre, ruta, cantidad de registros, válidos, fecha…)
 * para poder mostrar el historial sin volver a subir el archivo.
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - POST /Database/Register-file -> 201 { data: { databaseFileId } }
 *  - POST /Database/List          -> 200 { data: { files, count } }
 */

export const DATABASE_ENDPOINTS = {
  REGISTER_FILE: '/Database/Register-file',
  LIST: '/Database/List',
  DELETE: '/Database/Delete',
};

export interface RegisterFilePayload {
  customerId: string;
  customer: string;
  fileName: string;
  s3Path: string;
  totalRecords?: number;
  validEmails?: number;
  invalidEmails?: number;
  duplicates?: number;
  /** Si es true, el envío real NO filtra contactos duplicados (se envía el total de la base). */
  allowDuplicates?: boolean;
  delimiter?: string;
  /** Canal para el que se validó la base: EMAIL | SMS | WHATSAPP | VOICE. */
  channel?: string;
  /** Encabezados del CSV: campos usables como {{variables}} en las plantillas. */
  columns?: string[];
  /** Primeras filas de datos (sin encabezado) para la vista previa persistente del "ver detalle". */
  previewRows?: string[][];
  uploadedBy?: string;
}

export interface DatabaseFile {
  databaseFileId: string;
  customerId: string;
  customer: string;
  fileName: string;
  s3Path: string;
  totalRecords: number;
  validEmails: number;
  invalidEmails: number;
  duplicates: number;
  /** Si es true, el envío real NO filtra contactos duplicados (se envía el total de la base). */
  allowDuplicates?: boolean;
  delimiter: string;
  channel?: string;
  /** Encabezados del CSV (campos usables como {{variables}} en las plantillas). */
  columns?: string[];
  /** Primeras filas de datos (sin encabezado) para la vista previa persistente. */
  previewRows?: string[][];
  uploadedBy: string;
  uploadDate: string;
  status: string;
}

export const databaseService = {
  /** Guarda la metadata de una base ya subida a S3. */
  registerFile: (payload: RegisterFilePayload): Promise<ApiResponse<{ databaseFileId?: string }>> =>
    apiPost(DATABASE_ENDPOINTS.REGISTER_FILE, payload),

  /** Lista las bases de datos del cliente. Envía customerId Y customer (el backend
   *  cae a buscar por nombre de empresa si el customerId no coincide). */
  list: (customerId: string, customer?: string): Promise<ApiResponse<{ files?: DatabaseFile[]; count?: number }>> =>
    apiPost(DATABASE_ENDPOINTS.LIST, { customerId, customer }),

  /** Elimina una base de datos: su registro y el CSV en S3 (borrado best-effort del objeto). */
  delete: (databaseFileId: string): Promise<ApiResponse> =>
    apiPost(DATABASE_ENDPOINTS.DELETE, { databaseFileId }),
};
