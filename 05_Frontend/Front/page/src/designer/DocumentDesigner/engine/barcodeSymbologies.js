// barcodeSymbologies.js — Registro ÚNICO de simbologías de código de barras.
//
// Fuente de verdad que alimenta: el dropdown del tab Contenido, el tab dinámico
// por tipo, la validación de datos y el mapeo a bwip-js (solo para el PREVIEW).
//
// IMPORTANTE: `bwipId` se usa SOLO para el render aproximado del editor. El JSON
// que viaja al back lleva nuestro `id` canónico + metrics/options (nombres
// nuestros, agnósticos de librería). El back tiene su propio mapeo.

// Descriptores de campos de opción. La CLAVE (o `optionKey`) es el nombre
// GENÉRICO que se guarda en model.options y viaja al back — NO es un nombre de
// bwip-js ni de ninguna librería. Cada renderer (preview/back) traduce desde
// estos nombres con su propio adaptador. `hint` explica para qué sirve.
export const OPTION_DEFS = {
  // ── main (tab del tipo) ──
  checkDigit: {
    label: 'Usar dígito de control', kind: 'bool', default: false,
    hint: 'Agrega un dígito verificador calculado al final del código.',
  },
  checkDigitMode: {
    label: 'Tipo de dígito de control', kind: 'select', default: 'mod103',
    options: [['none', 'Ninguno'], ['mod10', 'Módulo 10'], ['mod103', 'Módulo 103']],
    hint: 'Algoritmo del checksum (GS1-128 / Code 128).',
  },
  subsets: {
    label: 'Subsets', kind: 'select', default: 'ABC',
    options: [['A', 'A'], ['B', 'B'], ['C', 'C'], ['AB', 'AB'], ['ABC', 'ABC (auto)']],
    hint: 'Juego de caracteres del Code 128 (A/B/C o automático).',
  },
  validateString: {
    label: 'Validar cadena', kind: 'bool', default: true,
    hint: 'Verifica el formato del dato antes de generar el código.',
  },
  errorCorrectionQR: {
    label: 'Corrección de error', kind: 'select', default: 'M', optionKey: 'errorCorrection',
    options: [['L', 'L (~7%)'], ['M', 'M (~15%)'], ['Q', 'Q (~25%)'], ['H', 'H (~30%)']],
    hint: 'Redundancia ante daño: más alto = más resistente, menos capacidad.',
  },
  errorCorrectionPDF: {
    label: 'Corrección de error', kind: 'select', default: 'auto', optionKey: 'errorCorrection',
    options: [['auto', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'], ['7', '7'], ['8', '8']],
    hint: 'Nivel 0–8 de redundancia (más alto = más resistente al daño).',
  },
  truncated: {
    label: 'Truncado', kind: 'bool', default: false,
    hint: 'Acorta el PDF417 quitando el indicador derecho (menos ancho).',
  },
  symbolSize: {
    label: 'Tamaño del símbolo', kind: 'select', default: 'auto',
    options: [['auto', 'Auto']],
    hint: 'Tamaño fijo del código. Auto = el necesario para el dato.',
  },

  // ── advanced (tab Avanzado) ──
  ratio: {
    label: 'Ratio ancho/angosto', kind: 'number', min: 2, max: 3, step: 0.1, default: 3,
    hint: 'Relación entre barra ancha y angosta (solo tipos con 2 anchos).',
  },
  intercharGapRatio: {
    label: 'Ratio espacio intercarácter', kind: 'number', min: 1, step: 0.1, default: 1,
    hint: 'Tamaño del espacio entre caracteres (Code 39 / 2 de 5).',
  },
  barWidthNarrow: {
    label: 'Corrección barra angosta', unit: 'mm', kind: 'number', step: 0.01, default: 0,
    hint: 'Ajuste fino del ancho de la barra angosta (compensa la impresión).',
  },
  barWidthWide: {
    label: 'Corrección barra ancha', unit: 'mm', kind: 'number', step: 0.01, default: 0,
    hint: 'Ajuste fino del ancho de la barra ancha.',
  },
  encoding: {
    label: 'Codificación de datos', kind: 'select', default: 'auto',
    options: [['auto', 'Auto'], ['ascii', 'ASCII'], ['c40', 'C40'], ['text', 'Texto'], ['base256', 'Base256'], ['x12', 'X12'], ['edifact', 'EDIFACT']],
    hint: 'Modo de codificación de los datos (auto recomendado).',
  },
  eci: {
    label: 'Código ECI', kind: 'number', min: 0, step: 1, default: 0,
    hint: 'Interpretación de canal extendido (caracteres no estándar). 0 = ninguno.',
  },
};

// Validaciones por tipo (sobre la data resuelta). Devuelve null o mensaje de error.
const onlyDigits = () => (d) => /^\d+$/.test(d) ? null : 'Requiere solo dígitos';
const digitsExact = (n) => (d) => !/^\d+$/.test(d) ? 'Requiere solo dígitos'
  : d.length !== n ? `Requiere exactamente ${n} dígitos` : null;
const digitsEven = (d) => !/^\d+$/.test(d) ? 'Requiere solo dígitos'
  : d.length % 2 !== 0 ? 'Requiere un número par de dígitos' : null;

// ── Registro COMPLETO de simbologías ───────────────────────────────────────────
// category: '1d' | 'matrix' | 'stacked' | 'postal' | 'other'   (matrix/stacked = 2D)
// bwipId: id de bwip-js para el PREVIEW (null = sin preview; el tipo igual viaja
//   al back en el JSON y el motor del back lo genera).
// optionFields:   claves de OPTION_DEFS que muestra el tab "Tipo" (opciones principales).
// advancedFields: claves de OPTION_DEFS que muestra el tab "Avanzado".
// directMetricBars: nº de anchos de barra/espacio del tab "Métrica directa"
//   (2 = angosta/ancha; 4 = Code 128/EAN/GS1). null/0 = sin métrica directa.
export const SYMBOLOGIES = [
  // ── 2/5 family ──
  { id: 'datalogic2of5', bwipId: 'datalogic2of5', label: '2/5 Datalogic', category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['intercharGapRatio', 'barWidthNarrow', 'barWidthWide'], validate: onlyDigits(), sample: '1234567890' },
  { id: 'iata2of5',      bwipId: 'iata2of5',      label: '2/5 IATA',      category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['intercharGapRatio', 'barWidthNarrow', 'barWidthWide'], validate: onlyDigits(), sample: '1234567890' },
  { id: 'industrial2of5',bwipId: 'industrial2of5',label: '2/5 Industrial',category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['intercharGapRatio', 'barWidthNarrow', 'barWidthWide'], validate: onlyDigits(), sample: '1234567890' },
  { id: 'itf',           bwipId: 'interleaved2of5',label: '2/5 Interleaved (ITF)', category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['barWidthNarrow', 'barWidthWide'], directMetricBars: 2, validate: digitsEven, sample: '1234567890' },
  { id: 'matrix2of5',    bwipId: 'matrix2of5',    label: '2/5 Matrix',    category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['intercharGapRatio', 'barWidthNarrow', 'barWidthWide'], validate: onlyDigits(), sample: '1234567890' },

  // ── 1D lineales ──
  { id: 'code128',     bwipId: 'code128', label: 'Code 128',           category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], directMetricBars: 4, sample: 'CODE128' },
  { id: 'code128empty',bwipId: null,      label: 'Code 128 Empty',     category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], directMetricBars: 4, sample: 'CODE128' },
  { id: 'code128ups',  bwipId: null,      label: 'Code 128 UPS',       category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], directMetricBars: 4, sample: 'CODE128' },
  { id: 'code39',      bwipId: 'code39',  label: 'Code 39',            category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['intercharGapRatio', 'barWidthNarrow', 'barWidthWide'], directMetricBars: 2, sample: 'CODE39' },
  { id: 'code39ext',   bwipId: 'code39ext',label: 'Code 39 (Full Ascii)', category: '1d', optionFields: ['ratio', 'checkDigit'], advancedFields: ['intercharGapRatio', 'barWidthNarrow', 'barWidthWide'], sample: 'Code39' },
  { id: 'code93',      bwipId: 'code93',  label: 'Code 93',            category: '1d', optionFields: ['checkDigit'], advancedFields: ['barWidthNarrow'], sample: 'CODE93' },
  { id: 'codabar',     bwipId: 'rationalizedCodabar', label: 'Codabar', category: '1d', optionFields: ['ratio'], advancedFields: ['barWidthNarrow', 'barWidthWide'], directMetricBars: 2, sample: 'A12345B' },
  { id: 'msi',         bwipId: 'msi',     label: 'MSI',                category: '1d', optionFields: ['checkDigit'], advancedFields: ['barWidthNarrow'], validate: onlyDigits(), sample: '1234567' },

  // ── EAN / UPC / GS1 ──
  { id: 'ean13',       bwipId: 'ean13',   label: 'EAN-13',             category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], directMetricBars: 4, validate: digitsExact(12), sample: '123456789012' },
  { id: 'ean8',        bwipId: 'ean8',    label: 'EAN-8',              category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], directMetricBars: 4, validate: digitsExact(7), sample: '1234567' },
  { id: 'ean8cc',      bwipId: null,      label: 'EAN-8 CC A/B',       category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], sample: '1234567' },
  { id: 'eanaddon',    bwipId: null,      label: 'EAN Add On 2/5',     category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], validate: onlyDigits(), sample: '12' },
  { id: 'upca',        bwipId: 'upca',    label: 'UPC-A',              category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], validate: digitsExact(11), sample: '12345678901' },
  { id: 'upce',        bwipId: 'upce',    label: 'UPC-E',              category: '1d', optionFields: [], advancedFields: ['barWidthNarrow'], validate: digitsExact(6), sample: '123456' },
  { id: 'ean128',      bwipId: 'gs1-128', label: 'EAN 128 / GS1-128',  category: '1d', optionFields: ['checkDigitMode', 'subsets', 'validateString'], advancedFields: ['barWidthNarrow'], directMetricBars: 4, sample: '(01)09501101020917' },
  { id: 'gs1',         bwipId: null,      label: 'GS1',                category: '1d', optionFields: ['validateString'], advancedFields: ['barWidthNarrow'], directMetricBars: 4, sample: '(01)09501101020917' },
  { id: 'gs1composite',bwipId: null,      label: 'GS1 128 Composite',  category: '1d', optionFields: ['validateString'], advancedFields: ['barWidthNarrow'], sample: '(01)09501101020917|99TEST' },
  { id: 'gs1qr',       bwipId: 'gs1qrcode',label: 'GS1 QR',            category: 'matrix', optionFields: ['errorCorrectionQR'], advancedFields: ['eci', 'symbolSize'], sample: '(01)09501101020917' },

  // ── 2D matriz ──
  { id: 'datamatrix',  bwipId: 'datamatrix', label: 'Data Matrix',     category: 'matrix', optionFields: ['encoding'], advancedFields: ['eci', 'symbolSize'], sample: 'DATA MATRIX' },
  { id: 'datamatrixresponse', bwipId: null,  label: 'Data Matrix Response Plus', category: 'matrix', optionFields: ['encoding'], advancedFields: ['eci', 'symbolSize'], sample: 'DATA MATRIX' },
  { id: 'qr',          bwipId: 'qrcode',  label: 'QR',                 category: 'matrix', optionFields: ['errorCorrectionQR'], advancedFields: ['eci', 'symbolSize'], sample: 'https://ejemplo.com' },
  { id: 'microqr',     bwipId: 'microqrcode', label: 'MicroQR',        category: 'matrix', optionFields: ['errorCorrectionQR'], advancedFields: ['symbolSize'], sample: '12345' },
  { id: 'aztec',       bwipId: 'azteccode',label: 'Aztec',             category: 'matrix', optionFields: [], advancedFields: ['eci', 'symbolSize'], sample: 'AZTEC' },
  { id: 'maxicode',    bwipId: 'maxicode', label: 'MaxiCode',          category: 'matrix', optionFields: [], advancedFields: [], sample: 'MAXICODE' },
  { id: 'mailmarkcmdm',bwipId: null,      label: 'Mailmark CMDM',      category: 'matrix', optionFields: [], advancedFields: [], sample: 'MAILMARK' },

  // ── 2D apilado ──
  { id: 'pdf417',      bwipId: 'pdf417',  label: 'PDF417',             category: 'stacked', optionFields: ['errorCorrectionPDF', 'truncated'], advancedFields: ['eci'], sample: 'PDF417 DATA' },
  { id: 'micropdf417', bwipId: 'micropdf417', label: 'MicroPDF 417',   category: 'stacked', optionFields: [], advancedFields: ['eci'], sample: 'MICROPDF' },
  { id: 'macropdf417', bwipId: 'pdf417',  label: 'MacroPDF 417',       category: 'stacked', optionFields: ['errorCorrectionPDF', 'truncated'], advancedFields: ['eci'], sample: 'MACROPDF' },

  // ── Postales ──
  { id: 'auspost',         bwipId: 'auspost',  label: 'Australia Post',        category: 'postal', optionFields: [], advancedFields: [], sample: '5956439111ABA 9' },
  { id: 'dutchpost',       bwipId: 'kix',      label: 'Dutch Post (KIX)',      category: 'postal', optionFields: [], advancedFields: [], sample: '1234AB56' },
  { id: 'intelligentmail', bwipId: 'onecode',  label: 'Intelligent Mail (4-CB)',category: 'postal', optionFields: [], advancedFields: [], directMetricBars: 2, validate: onlyDigits(), sample: '01234567094987654321' },
  { id: 'japanpost',       bwipId: 'japanpost',label: 'Japan Post',            category: 'postal', optionFields: [], advancedFields: [], sample: '1234567' },
  { id: 'planet',          bwipId: 'planet',   label: 'Planet',                category: 'postal', optionFields: [], advancedFields: [], validate: onlyDigits(), sample: '12345678901' },
  { id: 'postnet',         bwipId: 'postnet',  label: 'PostNet',               category: 'postal', optionFields: [], advancedFields: [], validate: onlyDigits(), sample: '12345' },
  { id: 'royalmail',       bwipId: 'royalmail',label: 'Royal Mail',            category: 'postal', optionFields: [], advancedFields: [], sample: 'LE28HS9Z' },
  { id: 'mailmark',        bwipId: 'mailmark', label: 'Mailmark CMDM (4-state)',category: 'postal', optionFields: [], advancedFields: [], sample: '21B2254800659JW5O9QA6Y' },

  // ── Otros / propietarios (preview no disponible; viaja al back) ──
  { id: 'omr',             bwipId: null, label: 'OMR',                category: 'other', optionFields: [], advancedFields: [], sample: '' },
  { id: 'superstealthdots',bwipId: null, label: 'Super Stealth-Dots', category: 'other', optionFields: [], advancedFields: [], sample: '' },
];

const BY_ID = Object.fromEntries(SYMBOLOGIES.map(s => [s.id, s]));

export function getSymbology(id) {
  // Normaliza ids legacy en mayúscula (CODE128, CODE39, EAN13…) del esquema viejo.
  const norm = (id ?? '').toLowerCase().replace(/[_\s]/g, '');
  return BY_ID[id] ?? BY_ID[norm] ?? BY_ID.code128;
}

export function is2D(id) {
  const s = getSymbology(id);
  return s.category === 'matrix' || s.category === 'stacked';
}

// ¿Admite el tab "Métrica directa"? (anchos de barra/espacio explícitos)
export function supportsDirectMetric(id) {
  return !!getSymbology(id).directMetricBars;
}

// Nº de anchos de barra/espacio del tab "Métrica directa" (2 ó 4).
export function directMetricBars(id) {
  return getSymbology(id).directMetricBars ?? 0;
}

// Valida la data para una simbología. Devuelve null o mensaje de error.
export function validateBarcodeData(id, data) {
  const s = getSymbology(id);
  const value = (data ?? '').trim();
  if (!value) return null; // vacío → se usará el sample en el preview
  if (typeof s.validate === 'function') return s.validate(value);
  return null;
}

// Devuelve los defaults de options para una simbología (main + avanzado).
export function defaultOptionsFor(id) {
  const s = getSymbology(id);
  const out = {};
  for (const key of [...(s.optionFields ?? []), ...(s.advancedFields ?? [])]) {
    const def = OPTION_DEFS[key];
    if (!def) continue;
    out[def.optionKey ?? key] = def.default;
  }
  return out;
}
