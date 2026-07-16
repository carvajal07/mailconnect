/**
 * Formato de fecha/hora UNIFICADO para todas las tablas: `DD-MM-YYYY HH:MM:SS`
 * (día y mes con 2 dígitos rellenados con 0, año de 4, hora en formato 24h).
 *
 * Acepta:
 *  - ISO con zona (`2026-07-16T01:23:45.000Z` / con offset) → respeta la zona.
 *  - `2026-07-16 01:23:45` (sin zona) → se interpreta como hora local.
 *  - Date o timestamp (number).
 * Si no se puede parsear, devuelve el valor original; si es vacío/nulo, `—`.
 */
export function formatDateTime(value?: string | number | Date | null): string {
  if (value === null || value === undefined || value === '') return '—';

  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === 'number') {
    d = new Date(value);
  } else {
    const s = String(value).trim();
    const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s);
    const looksDateTime = /^\d{4}-\d{2}-\d{2}[ T]/.test(s);
    // 'YYYY-MM-DD HH:MM:SS' sin zona → local (reemplaza el espacio por 'T').
    d = new Date(looksDateTime && !hasTz ? s.replace(' ', 'T') : s);
  }

  if (isNaN(d.getTime())) return String(value);

  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
