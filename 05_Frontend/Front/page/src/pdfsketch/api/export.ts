/**
 * Utilidades de descarga del editor pdfsketch.
 *
 * En MailConnect el render del PDF NO se hace aquí: la sección del portal
 * (`PdfStudioSection`) llama al motor estándar del backend
 * (`POST /Template/Render-engine`) con el JSON del documento vía
 * `pdfEngineService`. Este módulo solo conserva el helper de descarga local.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
