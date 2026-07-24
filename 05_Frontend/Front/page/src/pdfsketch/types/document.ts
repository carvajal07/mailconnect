export type Unit = 'mm' | 'pt' | 'px';

export type CapStyle = 'Butt' | 'Round' | 'Square';
export type LineDashStyle = 'Solid' | 'Dashed' | 'Dotted' | 'DashDot';
export type CornerStyle = 'Standard' | 'Round' | 'Bevel';

export type ElementType =
  | 'text'
  | 'rect'
  | 'circle'
  | 'triangle'
  | 'line'
  | 'pen'
  | 'image'
  | 'table'
  | 'qr'
  | 'dataField'
  | 'frame'
  | 'flowable';

/** Transformación de mayúsculas del texto (paridad con el Diseñador). */
export type TextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

/** Desplazamiento de línea base: superíndice / subíndice. */
export type BaselineShift = 'super' | 'sub';

/** Estilo de lista de un párrafo (paridad con el Diseñador). */
export type ListStyle = 'none' | 'bullet' | 'numbered' | 'letter';

/**
 * Degradado de relleno (paridad con el FillStyleEditor del Diseñador).
 * `linear` usa `angle` (grados, 0 = ↑, 90 = →); `radial` usa `cx`/`cy` (% 0–100).
 * Los stops llevan `offset` 0–100 (%), color hex y opacidad 0–1.
 */
export interface FillGradient {
  kind: 'linear' | 'radial';
  angle?: number;
  cx?: number;
  cy?: number;
  stops: { offset: number; color: string; opacity?: number }[];
}

export interface BaseEl {
  id: string;
  type: ElementType;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  zIndex: number;
  layer?: string;
}

/** Fragmento de texto enriquecido con estilos propios opcionales. */
export interface TextSpan {
  text?: string;      // texto literal (mutuamente exclusivo con binding)
  binding?: string;   // ruta JSON de variable, e.g. "persona.nombre"
  fallback?: string;  // valor cuando binding no tiene datos
  fontFamily?: string;
  fontSize?: number;  // en pt
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  textDecoration?: 'underline' | 'line-through';
  /** Superíndice/subíndice del fragmento (tamaño ~58% + desplazamiento de baseline). */
  baselineShift?: BaselineShift;
  /** Interletra en pt (se suma al avance de cada carácter). */
  letterSpacing?: number;
  color?: string;
}

export interface TextEl extends BaseEl {
  type: 'text';
  text: string;            // texto plano (se mantiene sincronizado con spans)
  spans?: TextSpan[];      // texto enriquecido; anula text en render cuando está presente
  fontFamily: string;
  fontSize: number;
  fontStyle: 'normal' | 'italic';
  fontWeight: number;
  textDecoration?: 'underline' | 'line-through';
  align: 'left' | 'center' | 'right' | 'justify-left' | 'justify-center' | 'justify-right' | 'justify-block';
  lineHeight: number;
  color: string;
  /** Interletra por defecto del elemento, en pt. */
  letterSpacing?: number;
  /** Transformación de mayúsculas (se aplica al render, no muta el texto). */
  textTransform?: TextTransform;
  // ── Propiedades de PÁRRAFO (mm salvo indicación) — las aplica un ParagraphStyle ──
  leftIndent?: number;
  rightIndent?: number;
  firstLineIndent?: number;
  spaceBefore?: number;      // entre párrafos (antes)
  spaceAfter?: number;       // entre párrafos (después)
  listStyle?: ListStyle;     // viñetas / numeración
  listIndent?: number;       // sangría del marcador de lista (mm)
  bulletChar?: string;       // carácter de viñeta (default •)
  numberFormat?: string;     // formato de número: '0.' | '0)' | '(0)'
  // ── Vínculos a recursos (actualización EN VIVO al editar el estilo) ──
  textStyleId?: string;
  paragraphStyleId?: string;
}

export interface RectEl extends BaseEl {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  dash?: number[];
  borderStyleId?: string;
  /** Opacidad del relleno 0–1 (default 1). */
  opacity?: number;
  /** Degradado — si está presente anula el `fill` sólido. */
  fillGradient?: FillGradient;
  /** Vínculo al FillStyle aplicado (actualización en vivo). */
  fillStyleId?: string;
}

export interface CircleEl extends BaseEl {
  type: 'circle';
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: number[];
  borderStyleId?: string;
  opacity?: number;
  fillGradient?: FillGradient;
  fillStyleId?: string;
}

/** Triángulo (apunta hacia arriba) — paridad con la forma `triangle` del Diseñador. */
export interface TriangleEl extends BaseEl {
  type: 'triangle';
  fill: string;
  stroke: string;
  strokeWidth: number;
  dash?: number[];
  borderStyleId?: string;
  opacity?: number;
  fillGradient?: FillGradient;
  fillStyleId?: string;
}

export interface LineEl extends BaseEl {
  type: 'line';
  points: number[];
  stroke: string;
  strokeWidth: number;
  dash?: number[];
  lineStyleId?: string;
}

export interface PenEl extends BaseEl {
  type: 'pen';
  points: number[];
  stroke: string;
  strokeWidth: number;
  tension: number;
  lineStyleId?: string;
}

export interface ImageEl extends BaseEl {
  type: 'image';
  src: string;
  opacity: number;
  cropX?: number;
  cropY?: number;
  /** Conservar proporción al redimensionar (default true si no está definido). */
  lockAspect?: boolean;
}

export type BarcodeType =
  | 'QR'
  | 'EAN13'
  | 'EAN8'
  | 'CODE128'
  | 'CODE39'
  | 'ITF14'
  | 'UPC';

export interface TableColumn {
  widthPercent: number;
  minWidth: number;
  header?: string;
}
export interface TableCell {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  background?: string;
  color?: string;
}
export interface TableEl extends BaseEl {
  type: 'table';
  columns: TableColumn[];
  rows: TableCell[][];
  borderWidth: number;
  borderColor: string;
  cellSpacing: number;
  hasHeader: boolean;
  hasFooter: boolean;
  headerBackground: string;
  footerBackground: string;
  alternateRows: boolean;
  alternateBackground: string;
  repeatBy?: string;
  rowFontSize: number;
}

export interface QrEl extends BaseEl {
  type: 'qr';
  barcodeType: BarcodeType;
  data: string;
  variable?: string;
  errorLevel: 'L' | 'M' | 'Q' | 'H';
  moduleSize: number;
  showText: boolean;
}

export interface DataFieldEl extends BaseEl {
  type: 'dataField';
  binding: string;
  fallback: string;
  fontFamily: string;
  fontSize: number;
  color: string;
}

export interface FrameEl extends BaseEl {
  type: 'frame';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
  padding: { top: number; right: number; bottom: number; left: number };
  dash?: number[];
  borderStyleId?: string;
}

export interface FlowableEl extends BaseEl {
  type: 'flowable';
  frameId: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  flowType: 'content' | 'paragraph' | 'spacer' | 'table' | 'image';
  dash?: number[];
  borderStyleId?: string;
}

export type ElementModel =
  | TextEl
  | RectEl
  | CircleEl
  | TriangleEl
  | LineEl
  | PenEl
  | ImageEl
  | TableEl
  | QrEl
  | DataFieldEl
  | FrameEl
  | FlowableEl;

export interface Page {
  id: string;
  name: string;
  size: { width: number; height: number; unit: Unit };
  background: string;
  margin: { top: number; right: number; bottom: number; left: number };
  rotation: number;
  visible: boolean;
  weight: number;
  repeatedBy: 'Empty' | string;
  addHeight: number;
  elements: ElementModel[];
}

export interface Font {
  id: string;
  name: string;
  fontName: string;
  subFonts: { name: string; location: string }[];
}

export interface ColorToken {
  id: string;
  name: string;
  rgb: string;
  /** Opacidad 0–255 (paridad con el ColorEditor del Diseñador). Default 255. */
  alpha?: number;
}

export interface TextStyle {
  id: string;
  name: string;
  fontSize: number;
  fontId: string;
  subFont: string;
  fillStyleId: string;
  ancestorId?: string;
  // ── Paridad con el TextStyleEditor del Diseñador (campos RENDERIZABLES) ──
  /** Subrayado / tachado (tab «Líneas»). */
  underline?: boolean;
  strikethrough?: boolean;
  /** Interletra en pt (tab «Reglas»; el Diseñador la guarda en mm — aquí pt como el resto del texto). */
  letterSpacing?: number;
  /** Interlineado (multiplicador; tab «Reglas»). */
  lineHeight?: number;
  /** Transformación de mayúsculas (tab «Reglas»). */
  textTransform?: TextTransform;
  /** Superíndice / subíndice (tab «Super/Sub»). */
  superscript?: boolean;
  subscript?: boolean;
  /** Tamaño relativo del super/subíndice en % (tab «Super/Sub», default 58). */
  superSubSize?: number;
}

export interface ParagraphStyle {
  id: string;
  name: string;
  ancestorId?: string;
  leftIndent: number;
  rightIndent: number;
  firstLineLeftIndent: number;
  spaceBefore: number;
  spaceAfter: number;
  lineSpacing: number;
  widow: number;
  orphan: number;
  keepWithNext: boolean;
  keepLinesTogether: 'No' | 'Yes';
  dontWrap: boolean;
  hAlign: 'Left' | 'Center' | 'Right' | 'Justify';
  // ── Paridad con el ParagraphStyleEditor del Diseñador (tab «Listas») ──
  listStyle?: ListStyle;
  listIndent?: number;       // mm
  bulletChar?: string;       // '•' '○' '■' '□' '❖' '➢' '✓' o personalizado
  numberFormat?: string;     // '0.' | '0)' | '(0)'
}

export interface BorderParts {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
  cornerTL: boolean;
  cornerTR: boolean;
  cornerBR: boolean;
  cornerBL: boolean;
  diagLR: boolean;
  diagRL: boolean;
}

export interface BorderStyle {
  id: string;
  name: string;
  colorId: string;
  lineWidth: number;
  cap: CapStyle;
  lineDash: LineDashStyle;
  corner: CornerStyle;
  radiusX: number;
  radiusY: number;
  /** Qué partes del borde están activas (undefined = todas activas). */
  parts?: BorderParts;
  /** Color de relleno/sombreado del área interior. */
  fillColor?: string;
}

export interface LineStyle {
  id: string;
  name: string;
  colorId?: string;
  width: number;
  cap: CapStyle;
  join: 'Miter' | 'Round' | 'Bevel';
  dash?: number[];
}

export interface FillStyle {
  id: string;
  name: string;
  colorId: string;
  // ── Paridad con el FillStyleEditor del Diseñador (tipos RENDERIZABLES) ──
  /** Tipo de relleno. Default (ausente) = 'solid'. */
  fillType?: 'none' | 'solid' | 'linear' | 'radial';
  /** Opacidad 0–1 (default 1). */
  opacity?: number;
  /** Degradado (para fillType linear/radial). */
  gradient?: FillGradient;
}

export interface ImageAsset {
  id: string;
  name: string;
  imageType: 'Simple' | 'Variable' | 'InlCond';
  imageLocation?: string;
  variableId?: string;
}

export interface TableDef {
  id: string;
  name: string;
  bordersType: string;
  horizontalCellSpacing: number;
  verticalCellSpacing: number;
  tableAlignment: 'Left' | 'Center' | 'Right';
  columnWidths: { percentWidth: number; minWidth: number }[];
  rowSetId: string;
}

export interface RowSet {
  id: string;
  name: string;
  rowSetType: 'Row' | 'RowSet' | 'InlCond';
  subRowIds: string[];
  minHeight: number;
  cellVerticalAlignment: 'Top' | 'Middle' | 'Bottom';
  borderId?: string;
}

export interface CellDef {
  id: string;
  name: string;
  flowId: string;
  borderId?: string;
}

export interface DataSources {
  variables: { id: string; name: string; defaultValue?: string }[];
  datasets: { id: string; name: string; rows: Record<string, unknown>[] }[];
}

export interface DynamicComm {
  id: string;
  name: string;
}
export interface Flow {
  id: string;
  name: string;
  type: 'Simple' | 'Variable' | 'InlCond';
  content: string;
}

export interface DocumentModel {
  id: string;
  name: string;
  unit: Unit;
  pages: Page[];
  assets: {
    fonts: Font[];
    colors: ColorToken[];
    textStyles: TextStyle[];
    paragraphStyles: ParagraphStyle[];
    borderStyles: BorderStyle[];
    lineStyles: LineStyle[];
    fillStyles: FillStyle[];
    images: ImageAsset[];
    tables: TableDef[];
    rowSets: RowSet[];
    cells: CellDef[];
  };
  data: DataSources;
  dynamicComms: DynamicComm[];
  flows: Flow[];
  createdAt: string;
  updatedAt: string;
}
