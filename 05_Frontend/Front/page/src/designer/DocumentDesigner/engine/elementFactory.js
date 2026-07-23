// engine/elementFactory.js — Crea elementos con valores por defecto

import { defaultOptionsFor } from './barcodeSymbologies.js';
import { defaultCategories, randomValue } from './chartModel.js';
import { getShape } from './shapeCatalog.js';

let _idCounter = 1;

export function genId(prefix = 'el') {
  return `${prefix}_${Date.now()}_${_idCounter++}`;
}

// ── Defaults compartidos ──────────────────────────────────────────────────

const DEFAULT_BORDER = {
  mode: 'none',               // 'none' | 'unified' | 'sides'
  unified: { enabled: false, width: 1, style: 'solid', color: '#d1d5db' },
  sides: {
    top:    { enabled: false, width: 1, style: 'solid', color: '#d1d5db' },
    right:  { enabled: false, width: 1, style: 'solid', color: '#d1d5db' },
    bottom: { enabled: false, width: 1, style: 'solid', color: '#d1d5db' },
    left:   { enabled: false, width: 1, style: 'solid', color: '#d1d5db' },
  },
  radius: { mode: 'unified', unified: 0, topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
};

const DEFAULT_FILL = {
  type: 'none',               // 'none' | 'solid' | 'gradient' | 'image'
  color: '#ffffff',
  gradient: { type: 'linear', angle: 0, stops: [] },
  opacity: 1,
  // image fill fields (used only when type='image')
  imageId: null,
  offsetX: 0, offsetY: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  flipX: false, flipY: false,
  autofit: true,
  tile: false,
};

const DEFAULT_TEXT_STYLE = {
  fontFamily: 'Arial',                            // Word/print convention
  fontWeight: 'Regular',
  fontSize: 11,               // pt
  italic: false,
  underline: false,
  strikethrough: false,
  letterSpacing: 0,
  // 'normal' = el navegador usa la MÉTRICA INTRÍNSECA del font (ascent +
  // descent + line-gap), igual que PDF/print. Sin multiplicador.
  // Arial 11 pt ≈ 1.15 em → cabe en 4.5 mm (estándar print). 1.2/1.4 añadían
  // leading que no existe en tipografía clásica de tablas.
  lineHeight: 'normal',
};

const DEFAULT_PARAGRAPH_STYLE = {
  alignment: 'left',          // 'left' | 'center' | 'right' | 'justify'
  verticalAlign: 'top',       // 'top' | 'middle' | 'bottom'
  paddingTop: 2,
  paddingRight: 3,
  paddingBottom: 2,
  paddingLeft: 3,
  spaceAfter: 0,
  spaceBefore: 0,
};

// ── Factory functions ─────────────────────────────────────────────────────

export function createTextBox({ x = 20, y = 20, width = 80, height = 20 } = {}) {
  return {
    id: genId('txt'),
    type: 'text',
    x, y, width, height,
    rotation: 0,
    visible: true,
    locked: false,
    condition: null,
    content: '',
    overflow: 'clip',         // 'clip' | 'expand' | 'paginate'
    textStyleId: DEFAULT_TEXT_STYLE_ID,
    textStyle: { ...DEFAULT_TEXT_STYLE },  // kept for backward compat, textStyleId takes precedence
    paragraphStyle: { ...DEFAULT_PARAGRAPH_STYLE },
    border: {
      ...JSON.parse(JSON.stringify(DEFAULT_BORDER)),
      contentPadding: { top: 2, bottom: 2, left: 3, right: 3 },
    },
    fill: { ...DEFAULT_FILL },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createShape({ x = 20, y = 20, width = 60, height = 30, shape = 'rectangle' } = {}) {
  // Las formas "open" (líneas, flechas-conector) no tienen relleno: solo trazo.
  const isOpen = getShape(shape).kind === 'open';
  return {
    id: genId('shp'),
    type: 'shape',
    x, y, width, height,
    rotation: 0,
    visible: true,
    locked: false,
    condition: null,
    shape,                    // id del catálogo (engine/shapeCatalog.js)
    fill: isOpen
      ? { ...DEFAULT_FILL, type: 'none' }
      : { ...DEFAULT_FILL, type: 'solid', color: '#e5e7eb' },
    // Borde inline por defecto; el panel "Borde" puede enlazarlo a un border
    // style (border.styleRef) y el renderer resuelve la cadena estilo→fill→color.
    border: JSON.parse(JSON.stringify({
      ...DEFAULT_BORDER,
      mode: 'unified',
      unified: { enabled: true, width: 1, style: 'solid', color: isOpen ? '#1f2937' : '#9ca3af' },
    })),
    // Trazo de líneas/flechas (legacy 'line' + nuevas formas open)
    lineStyle: isOpen ? { width: 1.5, style: 'solid', color: '#1f2937', cap: 'butt' } : null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createImage({ x = 20, y = 20, width = 50, height = 50, assetId = null } = {}) {
  return {
    id: genId('img'),
    type: 'image',
    x, y, width, height,
    rotation: 0,
    visible: true,
    locked: false,
    condition: null,
    source: assetId
      ? { kind: 'asset', assetId }
      : { kind: 'placeholder' },
    fit: 'contain',           // 'fill' | 'contain' | 'cover' | 'none'
    border: JSON.parse(JSON.stringify(DEFAULT_BORDER)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Table helpers ─────────────────────────────────────────────────────────

export function createCellFlow(content = '', label = 'Área') {
  return {
    id:                genId('area'),
    label,
    flowType:          'simple',
    height:            0,
    content,
    elements:          [],
    children:          [],
    visible:           true,
    condition:         null,
    dataPath:          '',
    selectionType:     'condition',
    selectionVariable: '',
    selectionMappings: [],
    selectionScript:   '',
    conditions:        [],
    defaultAreaId:     '',
    trueAreaId:        '',
    falseAreaId:       '',
    defaultTextStyleId: DEFAULT_TEXT_STYLE_ID,
    paragraphStyleId:   DEFAULT_PARAGRAPH_STYLE_ID,   // wires the default paragraph style
    isSectionFlow:     false,
    fittingMode:       'none',
    fittingFlows:      [],
    createdAt:         new Date().toISOString(),
    updatedAt:         new Date().toISOString(),
  };
}

export function createCell(colId, content = '', { label = null, areaLabel = null } = {}) {
  return {
    id:                  genId('cell'),
    colId,
    label,
    flow:                createCellFlow(content, areaLabel ?? 'Área'),
    vAlign:              'top',
    spanLeft:            false,
    spanUp:              false,
    heightType:          'custom',
    fixedHeight:         8,
    minHeight:           5,
    maxHeight:           null,
    paddingTop:          0,
    paddingRight:        0,
    paddingBottom:       0,
    paddingLeft:         0,
    htmlWidth:           'auto',
    htmlWidthValue:      0,
    flowToNextPage:      false,
    alwaysProcess:       false,
    fillRelativeToCell:  false,
    border:              null,
    fill:                null,   // { color: '#hex' } — Word-like cell shading
  };
}

export function createRowSet({ type = 'single-row', name = 'RowSet', columns = [], startCellNum = 1 } = {}) {
  const id = genId('rs');
  switch (type) {
    case 'single-row':
      return {
        id, name, type,
        cells: columns.map((col, i) => createCell(col.id, '', {
          label:     `Columna ${startCellNum + i}`,
          areaLabel: `Área Columna ${startCellNum + i}`,
        })),
      };
    case 'multiple-rows':
      return { id, name, type, childIds: [] };
    case 'repeated':
      return { id, name, type, childIds: [], repeatVar: null };
    case 'header-footer':
      return { id, name, type, displayAllRows: false, firstHeaderId: null, headerId: null, bodyId: null, footerId: null, lastFooterId: null };
    default:
      return { id, name, type, selectVar: null, cases: [] };
  }
}

export function createTable({ x = 20, y = 20, width = 170, height = 60, cols = 3, rows = 2, columns: providedColumns, rowSets: providedRowSets, rootRowSetId: providedRootId, tableNum = 1, startRowNum = 1, startCellNum = 1, tableRadius = 0, tableCorners = null, outerBorder = null, cellCornersAll = false, borderStyleId = null } = {}) {
  const tableLabel = `Tabla ${tableNum}`;

  // Pre-built structure from dialog (e.g. custom header/footer config)
  if (providedColumns && providedRowSets && providedRootId) {
    return {
      id: genId('tbl'), type: 'table', label: tableLabel, x, y, width, height,
      visible: true, locked: false, condition: null,
      columns: providedColumns,
      rowSets: providedRowSets,
      rootRowSetId: providedRootId,
      alignment: 'left', percentWidth: 100, minWidth: 0, maxWidth: null,
      hSpacing: 0, vSpacing: 0, borderType: 'simple', tableType: 'general',
      includeLineGap: false, applyHtmlFormatting: false, responsiveHtml: false,
      fillRelativeToTable: false, overflow: 'paginate',
      oddRowColor: null, evenRowColor: null,
      tableBorder: null, cellBorder: null,
      // Outer frame: prefer the named border style (`borderStyleId` → looks up
      // template.styles.border for color/width/sides/corners). The inline
      // `tableRadius`/`tableCorners`/`outerBorder` fields are kept as a fallback
      // for tables that don't have a style yet (TableElement reads the style
      // first; if absent, falls back to inline).
      borderStyleId,
      tableRadius, tableCorners: tableCorners ?? { tl: true, tr: true, br: true, bl: true },
      outerBorder,
      cellCornersAll,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }

  const colCount = Math.max(1, Math.round(cols));
  const rowCount = Math.max(1, Math.round(rows));
  const ratio    = 1 / colCount;

  const columns = Array.from({ length: colCount }, (_, i) => ({
    id: genId('col'),
    label: `Col. ${i + 1}`,
    widthRatio: ratio,
    minWidth: 5,
    headerTag: false,
    enabledBy: null,
  }));

  // 1 row → simple single-row root
  if (rowCount === 1) {
    const rsRoot = {
      id: genId('rs'), name: `Fila ${startRowNum}`, type: 'single-row',
      cells: columns.map((col, i) => createCell(col.id, '', {
        label:     `Columna ${startCellNum + i}`,
        areaLabel: `Área Columna ${startCellNum + i}`,
      })),
    };
    return {
      id: genId('tbl'), type: 'table', label: tableLabel, x, y, width, height,
      visible: true, locked: false, condition: null,
      columns, rowSets: [rsRoot], rootRowSetId: rsRoot.id,
      alignment: 'left', percentWidth: 100, minWidth: 0, maxWidth: null,
      hSpacing: 0, vSpacing: 0, borderType: 'simple', tableType: 'general',
      includeLineGap: false, applyHtmlFormatting: false, responsiveHtml: false,
      fillRelativeToTable: false, overflow: 'paginate',
      oddRowColor: null, evenRowColor: null,
      tableBorder: null, cellBorder: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }

  // >1 rows → multiple-rows root with N single-row children
  // Root counts as Fila ${startRowNum}; children are ${startRowNum+1}, ${startRowNum+2}, …
  const childRowSets = Array.from({ length: rowCount }, (_, rowIdx) => ({
    id: genId('rs'), name: `Fila ${startRowNum + 1 + rowIdx}`, type: 'single-row',
    cells: columns.map((col, colIdx) => {
      const n = startCellNum + rowIdx * colCount + colIdx;
      return createCell(col.id, '', { label: `Columna ${n}`, areaLabel: `Área Columna ${n}` });
    }),
  }));

  const rsRoot = {
    id: genId('rs'), name: `Fila ${startRowNum}`, type: 'multiple-rows',
    childIds: childRowSets.map(r => r.id),
  };

  return {
    id: genId('tbl'), type: 'table', label: tableLabel, x, y, width, height,
    visible: true, locked: false, condition: null,
    columns,
    rowSets:      [rsRoot, ...childRowSets],
    rootRowSetId: rsRoot.id,
    alignment: 'left', percentWidth: 100, minWidth: 0, maxWidth: null,
    hSpacing: 0, vSpacing: 0, borderType: 'simple', tableType: 'general',
    includeLineGap: false, applyHtmlFormatting: false, responsiveHtml: false,
    fillRelativeToTable: false, overflow: 'paginate',
    oddRowColor: null, evenRowColor: null,
    tableBorder: null, cellBorder: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

export function createSimpleArea({ label = 'Área', height = 30 } = {}) {
  return {
    id: genId('area'),
    type: 'simple',
    label,
    height,          // mm; 0 = auto (expands to fit content)
    content: '',     // text content typed directly into the area
    elements: [],
    children: [],    // sub-areas nested inside this area
    visible: true,
    condition: null,
    defaultTextStyleId: DEFAULT_TEXT_STYLE_ID,
    paragraphStyleId:   DEFAULT_PARAGRAPH_STYLE_ID,   // wires the default paragraph style
    // Advanced flow (production features)
    isSectionFlow: false,   // contenedor de otros flujos en secuencia
    fittingMode: 'none',    // 'none' | 'first-fitting' | 'first-fitting-auto'
    fittingFlows: [],       // IDs de áreas a probar en orden (para first-fitting)
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// createContentArea: returns { element, area } — area goes to template.contentAreas pool
export function createContentArea({ x = 20, y = 20, width = 120, height = 30 } = {}) {
  const area = createSimpleArea({ label: 'Área 1', height });
  const element = {
    id: genId('ca'),
    type: 'contentarea',
    x, y,
    width,
    height,
    visible: true,
    locked: false,
    condition: null,
    areaRef: area.id,           // references template.contentAreas pool
    previousAreaRef: null,      // ID del elemento contentarea anterior en la cadena de overflow
    nextAreaRef: null,          // ID del elemento contentarea que recibe el overflow de texto
    selfOverflow: false,        // si desborda: repite la página y continúa en ESTA misma área
    flowToNextPage: false,      // si el overflow continúa en la misma área en la siguiente página
    allowEmptyFlowArea: false,  // imprime página aunque el área quede vacía (requiere flowToNextPage)
    // Layout / dirección
    dynamicHeight: false,       // el área crece para ajustarse al contenido
    writingDirection: 'horizontal', // 'horizontal' | 'vertical'
    worldwideSupport: false,    // soporte RTL (árabe, hebreo, etc.)
    runaroundMode: 'none',      // 'none' | 'standard' | 'shapes-only'
    fitting: 'none',            // 'none' | 'horizontal' | 'vertical' | 'both'
    useBalancing: false,        // equilibrar contenido entre áreas overflow
    shearX: 0,                  // shear angle in degrees (positive = top shifts right)
    border: JSON.parse(JSON.stringify(DEFAULT_BORDER)),
    fill: { ...DEFAULT_FILL },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  // Return both — caller is responsible for adding area to template pool
  element._pendingArea = area;
  return element;
}

export function createQR({ x = 20, y = 20, width = 40, height = 40 } = {}) {
  return {
    id: genId('qr'),
    type: 'qr',
    x, y, width, height,
    rotation: 0,
    visible: true,
    locked: false,
    condition: null,
    value: '',
    valueSource: 'static',    // 'static' | 'dynamic'
    errorCorrection: 'M',     // 'L' | 'M' | 'Q' | 'H'
    foreground: '#000000',
    background: '#ffffff',
    border: JSON.parse(JSON.stringify(DEFAULT_BORDER)),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// Modelo de barcode — esquema LIMPIO, agnóstico de librería, en mm, con todo
// enlazado a Recursos (fills/estilos por referencia). Es exactamente lo que
// viaja al back; ninguna librería de render toca este JSON.
export function createBarcode({ x = 20, y = 20, width = 80, height = 20 } = {}) {
  const symbology = 'code128';
  return {
    id: genId('bc'),
    type: 'barcode',
    x, y, width, height,
    rotation: 0, shear: 0,
    visible: true,
    locked: false,
    condition: null,

    symbology,                       // id canónico nuestro (ver barcodeSymbologies.js)

    content: {
      variable: null,                // binding a campo del workflow (opcional)
      data: '12345678',              // valor estático / fallback
      useEncoding: false,
      encoding: null,
    },

    style: {
      barcodeFillId: DEFAULT_FILL_STYLE_ID,  // ref → fill style (color de barras)
      backgroundFillId: null,                // ref → fill style (fondo); null = transparente
      borderStyleRef: null,
    },

    text: {
      position: 'bottom-center',     // none | top-left…bottom-right
      deltaX: 0, deltaY: 0,
      textStyleId: DEFAULT_TEXT_STYLE_ID,  // ref → text style (default por defecto)
      conversion: null,
      showProcessedData: false,
      includeInBoundingBox: false,
    },

    align: { horizontal: 'left', vertical: 'top' },

    metrics: {
      moduleWidth: 0.33,             // mm — ancho del elemento más angosto
      height: 15,                    // mm — alto (1D); ignorado en 2D
      quietZone: 4,                  // módulos
      cpi: null,                     // opcional (densidad)
    },

    options: defaultOptionsFor(symbology),  // opciones por-tipo (según la simbología)

    directMetric: {                  // control fino por barra (fase 2)
      enabled: false,
      barWidths: [0.19, 0.38, 0.57, 0.76],
      barSpaces: [0.19, 0.38, 0.57, 0.76],
    },

    runaround: 'none',               // none | square

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Gráfico (Chart) ─────────────────────────────────────────────────────────
// Modelo agnóstico de librería. El preview (front) y el render final (back) se
// compilan al mismo spec Vega-Lite → WYSIWYG. `categories` son las etiquetas
// compartidas por todas las series; cada serie tiene un valor por categoría.

export function makeChartSeries(name, n, { random = false } = {}) {
  return {
    id: genId('ser'),
    name,
    visible: true,
    fillRef: null,                 // color de la serie (ref a Recursos); null = paleta
    borderRef: null,               // estilo de borde de la serie (ref)
    legendVar: null,               // nombre de la serie desde variable (back)
    dashed: false,                 // línea punteada (line/area/combo)
    values: Array.from({ length: n }, () => ({
      value: random ? randomValue() : 0,
      fillRef: null,               // color por punto (override; usado sobre todo en pastel/dona)
      lowest: null,                // valor base por punto (null = usa baseline del eje)
    })),
  };
}

export function createChart({ x = 20, y = 20, width = 100, height = 70 } = {}) {
  const n = 5;
  return {
    id: genId('cht'),
    type: 'chart',
    x, y, width, height,
    rotation: 0,
    visible: true,
    locked: false,
    condition: null,

    chartType: 'column',           // column | bar | line | area | scatter | pie | donut
    categories: defaultCategories(n),
    series: [makeChartSeries('Serie 1', n, { random: true })],

    stacking: 'none',              // none | stacked | normalize (100%) — col/bar/área multi-serie
    lineSeriesCount: 0,            // combo: nº de últimas series mostradas como línea (col/bar)
    barWidth: 0.8,                 // ancho relativo de barra (0.1–0.95)
    categoriesReverse: false,      // dibujar categorías en orden inverso
    barBorder: { fillRef: null, width: 0 }, // contorno de barras/puntos (0 = sin borde)

    colorScheme: null,             // esquema de color de Vega (null = colores propios)
    axes: {
      x: { title: '', titleVar: null, showLabels: true, labelAngle: 0, tickStyle: 'outside', labelsVar: null, temporal: false },
      y: { title: '', titleVar: null, showLabels: true, min: null, max: null, grid: true, decimals: null,
           tickStep: null, nice: false, baseline: 0, lines: [], stripes: [],
           tickStyle: 'outside', axisLineWidth: null, log: false,
           // Binding a variables (resueltas en el back; el preview usa el valor fijo)
           minVar: null, maxVar: null, tickStepVar: null },
    },
    legend: { show: false, position: 'right', direction: 'vertical', textStyleId: null, symbolType: 'square' },
    // Etiquetas de dato: content valor|percent; position outside|inside|center
    pointLabels: { show: false, content: 'value', position: 'outside', rotation: 0, textStyleId: null, offset: 0, formatWidth: null },
    title: '',
    titleVar: null,                // título desde variable (back; preview muestra token)
    titleStyleId: null,            // estilo de texto del título

    border: JSON.parse(JSON.stringify(DEFAULT_BORDER)),
    placement: { marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, backgroundFillId: null, seriesFillId: null },

    dataBinding: { mode: 'static', valuesArrayVar: null }, // static | variable (array)

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Página por defecto ────────────────────────────────────────────────────

export function createPage(overrides = {}) {
  return {
    id: genId('pg'),
    name: 'Página 1',
    size: { preset: 'A4', width: 210, height: 297, unit: 'mm' },
    orientation: 'portrait',
    margins: { top: 20, right: 20, bottom: 20, left: 20 },
    background: { type: 'solid', color: '#ffffff' },
    weight: 0,
    dynamicHeight: false,
    addHeightToPage: 0,
    guidelines: { horizontal: [], vertical: [] },
    headsDisplay: {
      showHeaderOnFirstPage: true,
      showFooterOnFirstPage: true,
      differentFirstPage: false,
      differentOddEven: false,
    },
    anchors: [],
    header: null,
    footer: null,
    elements: [],
    pageFlow: null,
    visible: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── PagesConfig ────────────────────────────────────────────────────────────
// El nivel que agrupa páginas físicas y define la lógica de secuencia.
// Familia de páginas: secuencia reutilizable de páginas físicas.

export function createConditionClause(overrides = {}) {
  return {
    id: genId('cl'),
    left:     { type: 'variable', path: '', value: '' },
    negated:  false,
    operator: 'equal_to',
    right:    { type: 'constant', path: '', value: '' },
    rightTo:  null,   // solo para operator 'in_range': { type, path, value }
    ...overrides,
  };
}

export function createConditionRule(overrides = {}) {
  return {
    id: genId('rule'),
    pageId:        null,
    conditionType: 'expression',   // 'expression' | 'script'
    expression: {
      logic:   'all',              // 'all' (AND) | 'any' (OR)
      clauses: [createConditionClause()],
    },
    script: '',
    ...overrides,
  };
}

// Crea el objeto de configuración de secuencia de páginas (único por template)
export function createPagesConfig(overrides = {}) {
  return {
    // ── Modo principal ─────────────────────────────────────────────────
    // 'simple'        → ejecución lineal desde startPageId
    // 'variable_data' → lógica dinámica por datos
    pageSelection: 'simple',
    startPageId:   null,           // para pageSelection='simple'

    // ── Repeat (solo si pageSelection='variable_data') ─────────────────
    repeatedBy: {
      enabled:  false,
      variable: null,              // path al array en WorkflowPacket (siempre array)
    },

    // ── TypeSelection (solo si pageSelection='variable_data') ──────────
    typeSelection: {
      type: 'simple',
      // 'simple'    → startPageId fijo
      startPageId:   null,
      // 'text'      → variable de texto + tabla valor→página
      // 'number'    → variable numérica + tabla valor→página
      variable:      null,         // path variable (text/number/bool)
      mappings:      [],           // [{ value, pageId }] para text/number
      defaultPageId: null,
      // 'bool'      → variable booleana → true/false page
      truePageId:    null,
      falsePageId:   null,
      // 'condition' → tabla de reglas con ExpressionBuilder
      rules:         [],           // ConditionRule[]
      // 'script'    → Monaco devuelve bool (truePageId/falsePageId)
      script:        '',
    },

    ...overrides,
  };
}

// ── Template vacío ────────────────────────────────────────────────────────

export const DEFAULT_TEXT_STYLE_ID    = 'ts_default';
export const DEFAULT_PARAGRAPH_STYLE_ID_CONST = 'ps_default'; // alias for cross-file use
export const DEFAULT_BLACK_COLOR_ID   = 'col_default_black';
export const DEFAULT_FILL_STYLE_ID    = 'fs_default_black';
export const DEFAULT_BORDER_STYLE_ID  = 'bs_default';

// The protected "default cell box style" (Model B): a borderStyle is the
// COMPLETE box treatment of a cell — lines + fill + corners + shadow. New
// table cells reference this. It is IMMUTABLE: quick edits (Pluma/Sombreado)
// fork a new style off it via findOrCreateBorderStyle rather than mutating it.
// Base look: thin black lines on all 4 sides, no fill, square corners.
export function createDefaultBorderStyle() {
  const now = new Date().toISOString();
  const sideOn = () => ({ enabled: true, lineWidth: null, lineStyle: null, lineColor: null, lineFillStyleId: null });
  return {
    id: DEFAULT_BORDER_STYLE_ID,
    name: 'Borde por defecto',
    isDefault: true,
    // Global line defaults (color via the resource chain: lineFillStyleId →
    // fill style → colorId → color; lineColor kept as a literal fallback).
    lineWidth: 0.20,
    lineCap: 'Butt',
    lineStyle: 'Solid',
    lineColor: '#000000',
    lineFillStyleId: DEFAULT_FILL_STYLE_ID,
    sides: { top: sideOn(), right: sideOn(), bottom: sideOn(), left: sideOn() },
    // Corners
    corner: 'Standard', radiusX: 5, radiusY: 5,
    corners: {
      topLeft:     { corner: null, radiusX: null, radiusY: null },
      topRight:    { corner: null, radiusX: null, radiusY: null },
      bottomRight: { corner: null, radiusX: null, radiusY: null },
      bottomLeft:  { corner: null, radiusX: null, radiusY: null },
    },
    // Fill (no background by default) — Model B: shading lives here.
    fill: '', fillFillStyleId: null,
    // Shadow / join / margins
    join: 'Miter', joinColor: '#000000', miter: 10,
    shadowColor: '', shadowFillStyleId: null, shadowOffsetX: 0, shadowOffsetY: 0,
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
    offsetLeft: 0, offsetRight: 0, offsetTop: 0, offsetBottom: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Table Style ───────────────────────────────────────────────────────────────
// A reusable, named resource that maps table REGIONS (by role, not by row
// instance) → border styles (each borderStyle = lines + fill, Model B). Applied
// to a whole table via `tableEl.tableStyleRef`. The chain stays "atado":
//   tableStyle → borderStyle(ref) → fillStyle(ref) → color(ref).
//
// Each region carries a default `columns` slot + optional per-column-position
// overrides (first/last/odd/even/lastOdd/lastEven), revealed by the General-tab
// flags. Every slot value is a borderStyle id (or null = "Empty"/no style).
export const TABLE_STYLE_REGIONS = ['firstHeader', 'header', 'oddBody', 'evenBody', 'footer', 'lastFooter'];
export const TABLE_STYLE_COLUMN_SLOTS = ['columns', 'firstColumn', 'lastColumn', 'oddColumn', 'evenColumn', 'lastOddColumn', 'lastEvenColumn'];

function createTableStyleRegion() {
  return {
    columns: null, firstColumn: null, lastColumn: null,
    oddColumn: null, evenColumn: null, lastOddColumn: null, lastEvenColumn: null,
  };
}

export function createTableStyle(name = 'Nuevo Table Style', overrides = {}) {
  const now = new Date().toISOString();
  const regions = {};
  for (const r of TABLE_STYLE_REGIONS) regions[r] = createTableStyleRegion();
  return {
    id: genId('tbls'),
    name,
    tableBorderStyleRef: null,        // outer perimeter border of the whole table
    useDifferentFirstColumns: false,
    useDifferentLastColumns: false,
    useDifferentOddEvenColumns: false,
    regions,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createDefaultBlackColor() {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_BLACK_COLOR_ID,
    name: 'Color Negro',
    type: 'simple',
    colorSpace: 'rgb',
    hex: '#000000',
    r: 0, g: 0, b: 0,
    c: 0, m: 0, y: 0, k: 100,
    alpha: 255,
    spotColor: null,
    mixSpotColor: false,
    cases: [],
    defaultColorId: null,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultBlackFillStyle() {
  const now = new Date().toISOString();
  return {
    id: DEFAULT_FILL_STYLE_ID,
    name: 'Relleno Negro',
    type: 'solid',
    color: '#000000',
    colorId: DEFAULT_BLACK_COLOR_ID,
    opacity: 1,
    gradient: { type: 'linear', angle: 0, cx: 50, cy: 50, stops: [] },
    imageId: null,
    offsetX: 0, offsetY: 0, rotation: 0, scaleX: 1, scaleY: 1,
    flipX: false, flipY: false, autofit: true, tile: false,
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultTextStyle() {
  return {
    id: DEFAULT_TEXT_STYLE_ID,
    name: 'Default Text Style',
    fontFamily: 'Arial',                          // Word/print convention
    fontWeight: 'Regular',
    fontSize: 11,
    // (color hex legado retirado — el color del texto se resuelve por la
    //  cadena: fillStyleId → fill style → colorId → color resource)
    fillStyleId: DEFAULT_FILL_STYLE_ID,
    isDefault: true,
    italic: false,
    smallCaps: false,
    letterSpacing: 0,
    lineHeight: 'normal',                         // font-intrinsic (PDF/print)
    textTransform: 'none',
    kerning: true,
    horizontalScale: 100,
    baselineShift: 0,
    superscript: false,
    subscript: false,
    superscriptOffset: 33,
    subscriptOffset: 33,
    superSubSize: 58,
    smallCapsSize: 70,
    underline: false,
    strikethrough: false,
    underlineStyleId: null,
    strikethroughStyleId: null,
    customUnderlineStrike: false,
    underlineOffset: 10.6,
    underlineWidth: 7.3,
    strikethroughOffset: 23.6,
    strikethroughWidth: 7.3,
    borderStyleId: null,
    connectBorders: false,
    // ── New in Epic 1 ───────────────────────────────────────────────────────
    borderWithLineGap: false,   // extiende el borde ligeramente por debajo del texto
    outlineStyleId: null,       // ref a fill style para el contorno del glifo
    outlineWidth: 0.1,          // mm
    cap: 'butt',                // 'butt' | 'round' | 'square'
    join: 'miter',              // 'miter' | 'round' | 'bevel'
    miter: 10,
    language: '',               // código ISO: 'es-ES', 'en-US', 'ar-SA' …
    urlTarget: '',              // URL link activo en el output (PDF, HTML)
  };
}

export const DEFAULT_PARAGRAPH_STYLE_ID = 'ps_default';

export function createDefaultParagraphStyle() {
  return {
    id: DEFAULT_PARAGRAPH_STYLE_ID,
    name: 'Default Paragraph Style',
    isDefault: true,
    alignment: 'left',
    verticalAlign: 'top',
    lineHeight: 'normal',                         // font-intrinsic (PDF/print)
    letterSpacing: 0,
    firstLineIndent: 0,
    leftIndent: 0,
    rightIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    wordWrap: true,
    wordBreak: 'normal',
    listStyle: 'none',
    listIndent: 5,
    listColor: '',          // legacy — kept for backward compat
    listFillStyleId: null,  // preferred: ref to fill style for list marker color
    bulletNumberingId: null, // ref a template.styles.bulletNumbering (recurso reutilizable)
    // Tab stops — cada stop: { id, position (mm), type, leader, decimalChar }
    // type: 'left'|'right'|'center'|'decimal'|'decimalword'
    // leader: ''|'.'|'-'|'_'
    tabStops: [],
    defaultTextStyleId: null,
    // ── New in Epic 1 ───────────────────────────────────────────────────────
    // Interlineado extendido
    lineSpacingType: 'additional', // 'additional'|'atleast'|'exact'|'multipleof'
    lineSpacing: 0,                // pt (o multiplicador si multipleof)
    // Control de párrafo
    spaceBeforeOnFirst: false,     // aplica spaceBefore en el primer párrafo del área
    ignoreEmptyLines: false,
    defaultTab: 12.5,              // mm — distancia default entre tabulaciones
    // Control de flujo
    flowBreakBefore: 'none',       // 'none'|'flowarea'|'page'|'column'
    flowBreakAfter: 'none',
    keepLinesTogether: 'no',       // 'no'|'hard'|'soft'
    keepWithPreviousParagraph: false,
    keepWithNextParagraph: false,
    doNotWrap: false,
    // Borde de párrafo
    paragraphBorderStyleId: null,  // ref a template.styles.border
    connectBorders: false,
    borderWithLineGap: false,
    // Separación silábica
    hyphenation: { enabled: false, minLeft: 2, minRight: 2, maxConsecutive: 2 },
  };
}

// ── Viñetas y numeración (recurso reutilizable) ──────────────
// Default chars que ofrece el editor (pestaña Viñetas).
export const DEFAULT_BULLET_CHARS = ['•', '○', '■', '□', '❖', '➢', '✓'];
// Formatos de numeración default (pestaña Numeración).
export const DEFAULT_NUMBER_FORMATS = ['0.', '0)', '(0)'];

export function createBulletNumbering(overrides = {}) {
  return {
    id: genId('bn'),
    name: 'Viñeta',
    kind: 'bullet',          // 'bullet' | 'numbering' | 'none'
    // Viñeta
    bulletMode: 'default',   // 'none' | 'default' | 'custom'
    bulletChar: '•',         // char activo (default) o el custom
    bulletCustom: '',        // texto del bullet custom
    // Numeración
    numberMode: 'default',   // 'none' | 'variable' | 'default' | 'custom'
    numberFormat: '0.',      // formato (default o custom)
    numberCustom: '',        // patrón custom
    numberType: 'increment', // tipo: 'increment'
    numberingVariable: '',   // path a variable (modo variable)
    startAt: 1,
    // Compartido (mm)
    indent: 6.30,            // sangría del marcador (bullet/number indent)
    textIndent: 12.70,       // sangría del texto
    // Color del marcador (atado a recursos)
    fillStyleId: null,       // ref a template.styles.fill
    colorId: null,           // ref a template.colors
    ...overrides,
  };
}

export function createDefaultFillStyle(name = 'Nuevo relleno') {
  return {
    id: genId('fs'),
    name,
    type: 'none',              // 'none' | 'solid' | 'gradient' | 'image'
    color: '#000000',
    opacity: 1,
    gradient: { type: 'linear', angle: 0, cx: 50, cy: 50, stops: [] },
    // image fill properties (usados solo cuando type='image')
    imageId: null,
    offsetX: 0, offsetY: 0,   // mm
    rotation: 0,               // grados
    scaleX: 1, scaleY: 1,
    flipX: false, flipY: false,
    autofit: true,
    tile: false,
  };
}

export function createImageAsset({ name = 'Imagen' } = {}) {
  return {
    id: genId('img_asset'),
    name,
    source: {
      kind: 'static',      // 'static' | 'dynamic' | 'base64'
      url: '',             // para static: URL o ruta de archivo
      variablePath: '',    // para dynamic: path a variable del workflow
      data: '',            // para base64: string data:image/...
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyTemplate() {
  return {
    version: '1.0',
    meta: {
      name: 'Nuevo Template',
      description: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    outputChannels: ['pdf'],
    colors: [createDefaultBlackColor()],
    fonts: [],
    images: [],             // pool de image assets para fill styles
    styles: {
      text: [createDefaultTextStyle()],
      paragraph: [createDefaultParagraphStyle()],
      border: [createDefaultBorderStyle()],
      line: [],
      fill: [createDefaultBlackFillStyle()],
      cell: [],
      table: [],          // Table Styles (role-based, applied via tableEl.tableStyleRef)
      bulletNumbering: [], // Viñetas y numeración (recurso reutilizable, ref desde paragraphStyle.bulletNumberingId)
    },
    rowSets: [],
    assets: [],
    anchors: [],
    textFragments: [],
    // Un solo PagesConfig por template — define la lógica de secuencia
    pagesConfig: createPagesConfig(),
    // Páginas planas — el PagesConfig define CÓMO se secuencian
    pages: [createPage({ name: 'Página 1' })],
  };
}

// ── Utilidades de elemento ────────────────────────────────────────────────

export function createElement(type, position) {
  switch (type) {
    case 'text':      return createTextBox(position);
    case 'shape':     return createShape(position);
    case 'image':     return createImage(position);
    case 'table':     return createTable(position);
    case 'contentarea': return createContentArea(position);
    case 'qr':          return createQR(position);
    case 'barcode':   return createBarcode(position);
    case 'chart':     return createChart(position);
    default:          throw new Error(`Unknown element type: ${type}`);
  }
}

export function createEmbeddedElement(type, overrides = {}) {
  const el = createElement(type, { x: 0, y: 0, width: 60, height: 30, ...overrides });
  el.embedded = true;
  return el;
}

export function cloneElement(element) {
  const cloned = JSON.parse(JSON.stringify(element));
  cloned.id = genId(element.type.slice(0, 3));
  cloned.x += 5;
  cloned.y += 5;
  cloned.createdAt = new Date().toISOString();
  cloned.updatedAt = new Date().toISOString();
  return cloned;
}

export function updateElement(element, changes) {
  return { ...element, ...changes, updatedAt: new Date().toISOString() };
}
