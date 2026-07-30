/**
 * Lógica pura del editor de Plantillas PDF: construcción de tablas y partido del documento
 * en PÁGINAS. Vive aparte de `PdfTemplatesSection.tsx` para poder probarse sin montar el
 * componente (el repo no trae `@testing-library/react`).
 */

/* ────────────────────────────── TABLAS ────────────────────────────── */

export interface TableConfig {
  rows: number;            // filas de CUERPO (sin contar el encabezado)
  cols: number;
  header: boolean;         // primera fila como encabezado
  borderWidth: number;     // px
  borderColor: string;
  borderStyle: 'solid' | 'dashed' | 'dotted' | 'none';
  headerBg: string;
  headerColor: string;
  zebra: boolean;
  zebraBg: string;
  cellPadding: number;     // px
  width: 'full' | 'auto';
  align: 'left' | 'center' | 'right';
}

export const DEFAULT_TABLE: TableConfig = {
  rows: 2,
  cols: 2,
  header: true,
  borderWidth: 1,
  borderColor: '#cbd5e1',
  borderStyle: 'solid',
  headerBg: '#eef2f7',
  headerColor: '#16233f',
  zebra: false,
  zebraBg: '#f7f9fc',
  cellPadding: 6,
  width: 'full',
  align: 'left',
};

export const TABLE_ATTR = 'data-mc-table';

/** Topes de cordura. Más allá la tabla no cabe en la hoja y el PDF sale ilegible. */
export const TABLE_MAX_ROWS = 60;
export const TABLE_MAX_COLS = 12;

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));

export const normalizeTable = (cfg: TableConfig): TableConfig => ({
  ...cfg,
  rows: clamp(cfg.rows, 1, TABLE_MAX_ROWS),
  cols: clamp(cfg.cols, 1, TABLE_MAX_COLS),
  borderWidth: clamp(cfg.borderWidth, 0, 10),
  cellPadding: clamp(cfg.cellPadding, 0, 40),
});

/**
 * Estilo de una celda.
 *
 * ⚠️ TODO va en estilo EN LÍNEA a propósito. xhtml2pdf (el motor del PDF básico) tiene
 * soporte muy limitado de selectores CSS: un `tr:nth-child(even)` para la cebra o una regla
 * `table td {…}` en un `<style>` NO se aplican de forma fiable. Lo que sí respeta siempre es
 * el atributo `style` de cada celda. Por eso la cebra se hornea fila a fila.
 */
const cellStyle = (cfg: TableConfig, opts: { head?: boolean; zebra?: boolean }): string => {
  const borde = cfg.borderStyle === 'none' || cfg.borderWidth <= 0
    ? 'border:none;'
    : `border:${cfg.borderWidth}px ${cfg.borderStyle} ${cfg.borderColor};`;
  const fondo = opts.head
    ? `background-color:${cfg.headerBg};`
    : (opts.zebra ? `background-color:${cfg.zebraBg};` : '');
  const texto = opts.head ? `color:${cfg.headerColor};font-weight:bold;` : '';
  return `${borde}padding:${cfg.cellPadding}px;${fondo}${texto}`;
};

const tableStyle = (cfg: TableConfig): string => {
  const ancho = cfg.width === 'full' ? 'width:100%;' : '';
  // `margin:0 auto` centra; a la derecha se empuja con el margen izquierdo automático.
  const margen = cfg.width === 'full' || cfg.align === 'left' ? ''
    : (cfg.align === 'center' ? 'margin-left:auto;margin-right:auto;' : 'margin-left:auto;');
  return `border-collapse:collapse;${ancho}${margen}margin-top:8px;margin-bottom:8px;`;
};

/**
 * HTML de una tabla nueva. La configuración viaja en `data-mc-table` para poder REABRIR el
 * diálogo con los valores que tenía (sin eso, editar una tabla obligaría a adivinar sus
 * ajustes leyendo el CSS de las celdas).
 */
export const buildTableHtml = (raw: TableConfig): string => {
  const cfg = normalizeTable(raw);
  const filas: string[] = [];
  if (cfg.header) {
    filas.push('<tr>' + Array.from({ length: cfg.cols }).map(
      () => `<th style="${cellStyle(cfg, { head: true })}">&nbsp;</th>`).join('') + '</tr>');
  }
  for (let r = 0; r < cfg.rows; r++) {
    const zebra = cfg.zebra && r % 2 === 1;
    filas.push('<tr>' + Array.from({ length: cfg.cols }).map(
      () => `<td style="${cellStyle(cfg, { zebra })}">&nbsp;</td>`).join('') + '</tr>');
  }
  const conf = escapeAttrJson(cfg);
  return `<table ${TABLE_ATTR}="${conf}" style="${tableStyle(cfg)}">${filas.join('')}</table><p><br></p>`;
};

const escapeAttrJson = (cfg: TableConfig) =>
  JSON.stringify(cfg).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Lee la configuración guardada en el atributo; si no la hay, devuelve los defaults. */
export const readTableConfig = (el: Element | null): TableConfig => {
  if (!el) return { ...DEFAULT_TABLE };
  try {
    const crudo = el.getAttribute(TABLE_ATTR);
    if (crudo) return normalizeTable({ ...DEFAULT_TABLE, ...JSON.parse(crudo) });
  } catch { /* configuración corrupta: se cae a los defaults */ }
  // Tabla creada antes de esta función (o pegada de fuera): se infiere lo que se puede.
  const filas = el.querySelectorAll('tr');
  const tieneTh = el.querySelector('th') !== null;
  return normalizeTable({
    ...DEFAULT_TABLE,
    header: tieneTh,
    rows: Math.max(1, filas.length - (tieneTh ? 1 : 0)),
    cols: Math.max(1, filas[0]?.children.length ?? DEFAULT_TABLE.cols),
  });
};

/**
 * Aplica la configuración a una tabla EXISTENTE **conservando el contenido** de las celdas.
 *
 * ⚠️ No se regenera el HTML: quien edita una tabla ya llena no espera perder lo que
 * escribió. Se ajusta el número de filas/columnas (recortando o agregando por el final) y
 * se re-aplica el estilo a cada celda.
 */
export const applyTableConfig = (table: HTMLTableElement, raw: TableConfig): void => {
  const cfg = normalizeTable(raw);
  const doc = table.ownerDocument;
  const filasActuales = Array.from(table.rows);
  const habiaEncabezado = filasActuales[0]?.querySelector('th') !== null;

  // El cuerpo esperado son `rows` filas + la de encabezado si se pidió.
  const total = cfg.rows + (cfg.header ? 1 : 0);

  // Sobran filas → se quitan por el final.
  while (table.rows.length > total) table.deleteRow(table.rows.length - 1);
  // Faltan filas → se agregan al final.
  while (table.rows.length < total) {
    const tr = table.insertRow(-1);
    for (let c = 0; c < cfg.cols; c++) tr.appendChild(doc.createElement('td'));
  }

  Array.from(table.rows).forEach((tr, i) => {
    const esEncabezado = cfg.header && i === 0;
    // Ajuste de columnas de esta fila.
    while (tr.children.length > cfg.cols) tr.removeChild(tr.lastElementChild!);
    while (tr.children.length < cfg.cols) {
      tr.appendChild(doc.createElement(esEncabezado ? 'th' : 'td'));
    }
    Array.from(tr.children).forEach((celda) => {
      // th ↔ td según haya encabezado: cambiar la etiqueta exige recrear el nodo,
      // llevándose el contenido para no perder lo escrito.
      const etiquetaOk = esEncabezado ? celda.tagName === 'TH' : celda.tagName === 'TD';
      let destino = celda as HTMLElement;
      if (!etiquetaOk) {
        const nueva = doc.createElement(esEncabezado ? 'th' : 'td');
        nueva.innerHTML = celda.innerHTML;
        celda.replaceWith(nueva);
        destino = nueva;
      }
      if (!destino.innerHTML.trim()) destino.innerHTML = '&nbsp;';
      const zebra = cfg.zebra && !esEncabezado
        && ((cfg.header ? i - 1 : i) % 2 === 1);
      destino.setAttribute('style', cellStyle(cfg, { head: esEncabezado, zebra }));
    });
  });

  void habiaEncabezado;
  table.setAttribute('style', tableStyle(cfg));
  table.setAttribute(TABLE_ATTR, JSON.stringify(cfg));
};

/* ────────────────────────────── PÁGINAS ────────────────────────────── */

export const BREAK_ATTR = 'data-mc-break';
/** Separador que el motor entiende. Es lo que ya emitía el "salto de página" manual. */
export const PAGE_BREAK_HTML = `<div ${BREAK_ATTR} style="page-break-before:always"></div>`;

/**
 * Une las páginas en el HTML que viaja al motor.
 *
 * ⚠️ El resultado es IDÉNTICO al que producía el editor de tira continua con saltos
 * manuales, así que el backend NO cambia: `page-break-before:always` entre hoja y hoja es
 * exactamente lo que xhtml2pdf ya respetaba.
 */
export const joinPages = (pages: string[]): string => {
  const utiles = pages.map((p) => p ?? '');
  // Una página final vacía no aporta nada y generaría una hoja en blanco en el PDF.
  while (utiles.length > 1 && !utiles[utiles.length - 1].replace(/<br\s*\/?>|&nbsp;|\s/gi, '').replace(/<[^>]+>/g, '').trim()) {
    utiles.pop();
  }
  return utiles.join(PAGE_BREAK_HTML);
};

/**
 * Parte el HTML guardado en páginas, cortando por los separadores.
 *
 * Es lo que da compatibilidad hacia atrás: una plantilla guardada con el modelo viejo
 * (tira continua + saltos manuales) se abre repartida en hojas, y una sin saltos entra
 * como una sola página.
 */
export const splitPages = (html: string): string[] => {
  const cont = (typeof document !== 'undefined' ? document : null)?.createElement('div');
  if (!cont) return [html || ''];
  cont.innerHTML = html || '';
  const paginas: string[] = [];
  let actual = cont.ownerDocument.createElement('div');
  Array.from(cont.childNodes).forEach((n) => {
    const esCorte = n.nodeType === 1 && (n as Element).hasAttribute(BREAK_ATTR);
    if (esCorte) {
      paginas.push(actual.innerHTML);
      actual = cont.ownerDocument.createElement('div');
      return;
    }
    actual.appendChild(n.cloneNode(true));
  });
  paginas.push(actual.innerHTML);
  return paginas.length ? paginas : [''];
};
