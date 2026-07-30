import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TABLE, TABLE_ATTR, TABLE_MAX_COLS, TABLE_MAX_ROWS, PAGE_BREAK_HTML,
  buildTableHtml, readTableConfig, applyTableConfig, normalizeTable,
  joinPages, splitPages,
} from '../pdfDocument';

const tabla = (html: string): HTMLTableElement => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.querySelector('table')!;
};

describe('tablas configurables', () => {
  it('respeta filas y columnas pedidas', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 4, cols: 3, header: true }));
    expect(t.rows.length).toBe(5);            // 4 de cuerpo + encabezado
    expect(t.rows[0].querySelectorAll('th').length).toBe(3);
    expect(t.rows[1].querySelectorAll('td').length).toBe(3);
  });

  it('sin encabezado no emite th', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 2, header: false }));
    expect(t.querySelectorAll('th').length).toBe(0);
    expect(t.rows.length).toBe(2);
  });

  it('el borde configurado llega a las celdas', () => {
    const html = buildTableHtml({ ...DEFAULT_TABLE, borderWidth: 3, borderColor: '#ff0000', borderStyle: 'dashed' });
    expect(html).toContain('border:3px dashed #ff0000');
  });

  it('borde "none" o grosor 0 quita el borde', () => {
    expect(buildTableHtml({ ...DEFAULT_TABLE, borderStyle: 'none' })).toContain('border:none');
    expect(buildTableHtml({ ...DEFAULT_TABLE, borderWidth: 0 })).toContain('border:none');
  });

  it('el relleno del encabezado se aplica solo al encabezado', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, header: true, headerBg: '#123456' }));
    expect(t.rows[0].children[0].getAttribute('style')).toContain('background-color:#123456');
    expect(t.rows[1].children[0].getAttribute('style')).not.toContain('#123456');
  });

  it('la cebra se hornea fila a fila, no con nth-child', () => {
    // ⚠️ xhtml2pdf no aplica `tr:nth-child(even)` de forma fiable: si la cebra dependiera
    // de un selector CSS, el lienzo la mostraría y el PDF saldría sin ella.
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 4, header: false, zebra: true, zebraBg: '#eeeeee' }));
    expect(t.rows[0].children[0].getAttribute('style')).not.toContain('#eeeeee');
    expect(t.rows[1].children[0].getAttribute('style')).toContain('#eeeeee');
    expect(t.rows[2].children[0].getAttribute('style')).not.toContain('#eeeeee');
    expect(t.rows[3].children[0].getAttribute('style')).toContain('#eeeeee');
  });

  it('acota filas y columnas absurdas', () => {
    const n = normalizeTable({ ...DEFAULT_TABLE, rows: 9999, cols: 999, borderWidth: 80, cellPadding: -5 });
    expect(n.rows).toBe(TABLE_MAX_ROWS);
    expect(n.cols).toBe(TABLE_MAX_COLS);
    expect(n.borderWidth).toBe(10);
    expect(n.cellPadding).toBe(0);
  });

  it('guarda la configuración para poder reabrir el diálogo', () => {
    const cfg = { ...DEFAULT_TABLE, rows: 3, cols: 4, zebra: true, borderColor: '#abcdef' };
    const t = tabla(buildTableHtml(cfg));
    expect(t.hasAttribute(TABLE_ATTR)).toBe(true);
    const leida = readTableConfig(t);
    expect(leida.rows).toBe(3);
    expect(leida.cols).toBe(4);
    expect(leida.zebra).toBe(true);
    expect(leida.borderColor).toBe('#abcdef');
  });

  it('infiere la forma de una tabla SIN configuración guardada', () => {
    // Tablas creadas por el editor viejo (2x2 clavado) o pegadas de fuera.
    const t = tabla('<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>');
    const cfg = readTableConfig(t);
    expect(cfg.header).toBe(true);
    expect(cfg.cols).toBe(2);
    expect(cfg.rows).toBe(1);
  });

  it('una configuración corrupta no rompe: cae a los defaults', () => {
    const t = tabla(`<table ${TABLE_ATTR}="{roto">${''}<tr><td>x</td></tr></table>`);
    expect(readTableConfig(t).cols).toBeGreaterThan(0);
  });
});

describe('editar una tabla ya insertada', () => {
  it('agranda conservando el contenido escrito', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 2, cols: 2, header: false }));
    t.rows[0].children[0].innerHTML = 'HOLA';
    applyTableConfig(t, { ...DEFAULT_TABLE, rows: 4, cols: 3, header: false });
    expect(t.rows.length).toBe(4);
    expect(t.rows[0].children.length).toBe(3);
    expect(t.rows[0].children[0].innerHTML).toBe('HOLA');
  });

  it('encoge quitando por el final', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 5, cols: 4, header: false }));
    t.rows[0].children[0].innerHTML = 'PRIMERA';
    applyTableConfig(t, { ...DEFAULT_TABLE, rows: 2, cols: 2, header: false });
    expect(t.rows.length).toBe(2);
    expect(t.rows[0].children.length).toBe(2);
    expect(t.rows[0].children[0].innerHTML).toBe('PRIMERA');
  });

  it('activar el encabezado convierte la primera fila a th sin perder texto', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 3, cols: 2, header: false }));
    t.rows[0].children[0].innerHTML = 'Concepto';
    applyTableConfig(t, { ...DEFAULT_TABLE, rows: 2, cols: 2, header: true });
    expect(t.rows[0].children[0].tagName).toBe('TH');
    expect(t.rows[0].children[0].innerHTML).toBe('Concepto');
  });

  it('re-aplica bordes y colores a TODAS las celdas', () => {
    const t = tabla(buildTableHtml({ ...DEFAULT_TABLE, rows: 3, cols: 2 }));
    applyTableConfig(t, { ...DEFAULT_TABLE, rows: 3, cols: 2, borderColor: '#00ff00', borderWidth: 2 });
    Array.from(t.querySelectorAll('td, th')).forEach((c) => {
      expect(c.getAttribute('style')).toContain('border:2px solid #00ff00');
    });
  });
});

describe('páginas', () => {
  it('une las páginas con el separador que el motor entiende', () => {
    const html = joinPages(['<p>uno</p>', '<p>dos</p>']);
    expect(html).toBe(`<p>uno</p>${PAGE_BREAK_HTML}<p>dos</p>`);
    expect(html).toContain('page-break-before:always');
  });

  it('parte por los separadores', () => {
    const p = splitPages(`<p>uno</p>${PAGE_BREAK_HTML}<p>dos</p>${PAGE_BREAK_HTML}<p>tres</p>`);
    expect(p).toEqual(['<p>uno</p>', '<p>dos</p>', '<p>tres</p>']);
  });

  it('ida y vuelta: partir y volver a unir no cambia el documento', () => {
    const original = `<h1>A</h1>${PAGE_BREAK_HTML}<p>B</p>`;
    expect(joinPages(splitPages(original))).toBe(original);
  });

  it('un documento SIN saltos entra como una sola página (plantillas viejas)', () => {
    expect(splitPages('<p>solo esto</p>')).toEqual(['<p>solo esto</p>']);
  });

  it('descarta las páginas vacías del final', () => {
    // Si no, "Agregar página" y no escribir nada dejaría una hoja en blanco en el PDF.
    expect(joinPages(['<p>uno</p>', '<p><br></p>'])).toBe('<p>uno</p>');
    expect(joinPages(['<p>uno</p>', '&nbsp;', ''])).toBe('<p>uno</p>');
  });

  it('una página vacía EN MEDIO sí se conserva', () => {
    // Puede ser deliberada (una hoja en blanco entre secciones).
    expect(joinPages(['<p>uno</p>', '', '<p>tres</p>'])).toContain(`${PAGE_BREAK_HTML}${PAGE_BREAK_HTML}`);
  });

  it('un documento vacío es una página, no cero', () => {
    expect(splitPages('')).toEqual(['']);
    expect(joinPages([''])).toBe('');
  });
});
