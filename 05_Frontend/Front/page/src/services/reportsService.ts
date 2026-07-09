import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio de Reportes.
 *
 * Endpoint real: Api_V1_Reports_state-report — genera el detalle de estados de envío
 * de una campaña (por destinatario). Contrato:
 *   Request:  { cliente, idProceso, s3_bucket?, s3_prefix? }
 *   Response: { count, s3_bucket, s3_key, csv_preview, csv_base64 }
 *     - Si NO se pasa s3_bucket, devuelve el CSV completo en `csv_base64` (descargable).
 *     - Si se pasa s3_bucket, sube el CSV a S3 y devuelve `s3_key`.
 *   Columnas del CSV (delimitador ';'): uniqueId;email;nombre;date;state;state_desc;type1;type2
 *
 * ⚠️ La ruta exacta en API Gateway puede variar; ajústala aquí si difiere.
 */

export const REPORT_ENDPOINTS = {
  STATE_REPORT: '/reports/state-report',
};

export interface StateReportPayload {
  cliente: string;
  idProceso: string;
  s3_bucket?: string;
  s3_prefix?: string;
}

export interface StateReportResult {
  count: number;
  s3_bucket: string | null;
  s3_key: string | null;
  csv_preview: string;
  csv_base64: string | null;
}

export const reportsService = {
  stateReport: (payload: StateReportPayload): Promise<ApiResponse<StateReportResult>> =>
    apiPost(REPORT_ENDPOINTS.STATE_REPORT, payload),
};

/* ------------------------------- Descargas ------------------------------- */

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Descarga un texto como archivo CSV (con BOM para acentos en Excel). */
export function downloadCsv(filename: string, text: string): void {
  triggerDownload(filename, new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8;' }));
}

/** Descarga un CSV que viene en base64 (respuesta de state-report). */
export function downloadBase64Csv(filename: string, base64: string): void {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  triggerDownload(filename, new Blob([bytes], { type: 'text/csv;charset=utf-8;' }));
}

/** Convierte filas a CSV con delimitador ';' (estándar del proyecto), escapando comillas. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))].join('\n');
}
