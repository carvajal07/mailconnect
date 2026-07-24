import { useMemo, useState } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  Italic,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
} from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useActiveEditorStore } from '@/store/activeEditorStore';
import type { CircleEl, ElementModel, LineEl, PenEl, RectEl, TextEl, TriangleEl } from '@/types/document';

type Align = TextEl['align'];
type ShapeEl = RectEl | CircleEl | TriangleEl | LineEl | PenEl;
type FillableEl = RectEl | CircleEl | TriangleEl;

const FONT_FAMILIES = ['Inter', 'JetBrains Mono', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New'];
const FONT_VARIANTS = ['Regular', 'Medium', 'Semi-Bold', 'Bold', 'Italic'];

/** El tamaño de fuente se ALMACENA en puntos (pt), la convención tipográfica; el
 *  selector permite ver/escribir en otras unidades y hace la conversión. */
type SizeUnit = 'pt' | 'px' | 'mm' | 'cm' | 'in';
const PT_PER_UNIT: Record<SizeUnit, number> = {
  pt: 1, px: 72 / 96, mm: 72 / 25.4, cm: 72 / 2.54, in: 72,
};
const SIZE_UNITS: SizeUnit[] = ['pt', 'px', 'mm', 'cm', 'in'];
/** Tamaños comunes (en pt) que ofrece el desplegable del combo. */
const FONT_SIZE_PRESETS_PT = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

const ptToUnit = (pt: number, u: SizeUnit) => pt / PT_PER_UNIT[u];
const unitToPt = (v: number, u: SizeUnit) => v * PT_PER_UNIT[u];
/** Formato compacto por unidad: pt/px enteros o .5; mm/cm/in con 2 decimales. */
function fmtSize(v: number, u: SizeUnit): string {
  const dec = u === 'pt' || u === 'px' ? 1 : 2;
  return String(Number(v.toFixed(dec)));
}

export default function FormatToolbar() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  // Cuando hay un editor de texto abierto, el formato de caracter (negrita,
  // color, tamaño…) se aplica a la SELECCIÓN dentro del texto (por palabra),
  // no a todo el elemento — así hay una sola barra y se conserva el formato fino.
  const editorApi = useActiveEditorStore((s) => s.api);
  const editing = !!editorApi;

  // Unidad del tamaño de fuente (solo display/entrada; el valor se guarda en pt).
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>('pt');

  // ── Elementos de texto seleccionados ──────────────────────────────────────
  const selectedTexts = useMemo<TextEl[]>(() => {
    if (!selectedIds.length) return [];
    const idSet = new Set(selectedIds);
    return pages.flatMap((p) => p.elements).filter(
      (e): e is TextEl => idSet.has(e.id) && e.type === 'text',
    );
  }, [pages, selectedIds]);

  // ── Formas seleccionadas ──────────────────────────────────────────────────
  const selectedShapes = useMemo<ShapeEl[]>(() => {
    if (!selectedIds.length) return [];
    const idSet = new Set(selectedIds);
    return pages.flatMap((p) => p.elements).filter(
      (e): e is ShapeEl =>
        idSet.has(e.id) &&
        (e.type === 'rect' || e.type === 'circle' || e.type === 'triangle' || e.type === 'line' || e.type === 'pen'),
    );
  }, [pages, selectedIds]);

  const fillableShapes = useMemo<FillableEl[]>(
    () => selectedShapes.filter((e): e is FillableEl => e.type === 'rect' || e.type === 'circle' || e.type === 'triangle'),
    [selectedShapes],
  );

  // ── Valores comunes de formas ─────────────────────────────────────────────
  const shapeStroke =
    selectedShapes.length > 0 && selectedShapes.every((e) => e.stroke === selectedShapes[0].stroke)
      ? selectedShapes[0].stroke
      : '#111111';

  const shapeFill =
    fillableShapes.length > 0 && fillableShapes.every((e) => e.fill === fillableShapes[0].fill)
      ? fillableShapes[0].fill
      : 'transparent';

  function applyFill(fill: string) {
    for (const el of fillableShapes) updateElement(el.id, { fill } as Partial<ElementModel>);
  }
  function applyStroke(stroke: string) {
    for (const el of selectedShapes) updateElement(el.id, { stroke } as Partial<ElementModel>);
  }

  // ── Valores comunes de texto ──────────────────────────────────────────────
  const textDisabled = selectedTexts.length === 0;

  function textCommon<K extends keyof TextEl>(key: K): TextEl[K] | undefined {
    if (!selectedTexts.length) return undefined;
    const first = selectedTexts[0][key];
    return selectedTexts.every((e) => e[key] === first) ? first : undefined;
  }
  function applyText(patch: Partial<TextEl>) {
    for (const el of selectedTexts) updateElement(el.id, patch);
  }

  const fontFamily = (textCommon('fontFamily') as string | undefined) ?? '';
  const fontWeight = textCommon('fontWeight') as number | undefined;
  const fontStyle = textCommon('fontStyle') as TextEl['fontStyle'] | undefined;
  const fontSize = textCommon('fontSize') as number | undefined;
  const align = textCommon('align') as Align | undefined;
  const decoration = textCommon('textDecoration') as TextEl['textDecoration'] | undefined;
  const textColor = (textCommon('color') as string | undefined) ?? '#000000';

  const variantLabel =
    fontStyle === 'italic' ? 'Italic' : fontWeight === undefined ? '' : weightLabel(fontWeight);

  const hasShapes = selectedShapes.length > 0;
  const hasText = selectedTexts.length > 0;
  // Al editar, los controles de texto están siempre habilitados (hay selección viva).
  const textCtrlDisabled = editing ? false : textDisabled;

  return (
    <div data-format-toolbar className="h-full bg-bg-1 flex items-center px-2 gap-1.5 text-11">

      {/* ── Sección formas ─────────────────────────────────────────────────── */}
      {hasShapes && (
        <>
          {/* Relleno (solo rect / circle) */}
          {fillableShapes.length > 0 && (
            <>
              <span className="text-[10px] text-muted">Relleno</span>
              <label
                className="w-[22px] h-[22px] rounded-3 border border-line-2 relative cursor-pointer overflow-hidden"
                title={`Color de relleno (${shapeFill})`}
              >
                {/* patrón ajedrez cuando es transparent */}
                <span
                  className="absolute inset-0"
                  style={
                    shapeFill === 'transparent'
                      ? {
                          backgroundImage:
                            'linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%),linear-gradient(45deg,#ccc 25%,transparent 25%,transparent 75%,#ccc 75%)',
                          backgroundSize: '6px 6px',
                          backgroundPosition: '0 0,3px 3px',
                        }
                      : { background: shapeFill }
                  }
                />
                <input
                  type="color"
                  value={shapeFill === 'transparent' ? '#ffffff' : shapeFill}
                  onChange={(e) => applyFill(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              <button
                type="button"
                title="Sin relleno"
                onClick={() => applyFill('transparent')}
                className="w-[22px] h-[22px] flex items-center justify-center rounded-3 border border-line-2 text-muted hover:bg-bg-3 text-[13px] leading-none"
              >
                ∅
              </button>
            </>
          )}

          {/* Trazo */}
          <span className="text-[10px] text-muted">Trazo</span>
          <label
            className="w-[22px] h-[22px] rounded-3 border border-line-2 relative cursor-pointer overflow-hidden"
            title={`Color de trazo (${shapeStroke})`}
          >
            <span className="absolute inset-0" style={{ background: shapeStroke }} />
            <input
              type="color"
              value={shapeStroke}
              onChange={(e) => applyStroke(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>

          {/* Separador si también hay texto seleccionado */}
          {hasText && <Sep />}
        </>
      )}

      {/* ── Sección texto ──────────────────────────────────────────────────── */}
      {/* Fuente */}
      <select
        disabled={textCtrlDisabled}
        value={fontFamily}
        onChange={(e) => applyText({ fontFamily: e.target.value })}
        className="h-[22px] bg-bg-3 border border-line-2 rounded-3 text-11 px-1.5 outline-none disabled:opacity-50"
        style={{ width: 130 }}
      >
        {fontFamily === '' && <option value="">—</option>}
        {FONT_FAMILIES.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <select
        disabled={textCtrlDisabled}
        value={variantLabel}
        onChange={(e) => applyText(variantToPatch(e.target.value))}
        className="h-[22px] bg-bg-3 border border-line-2 rounded-3 text-11 px-1.5 outline-none disabled:opacity-50"
        style={{ width: 96 }}
      >
        {variantLabel === '' && <option value="">—</option>}
        {FONT_VARIANTS.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <SizeCombo
        disabled={textCtrlDisabled}
        valuePt={fontSize}
        unit={sizeUnit}
        onUnitChange={setSizeUnit}
        onCommitPt={(v) => editing ? editorApi!.setFontSize(v) : applyText({ fontSize: v })}
      />

      <Sep />

      {/* Estilo */}
      <Toggle icon={Bold} label="Negrita" disabled={textCtrlDisabled}
        active={fontWeight !== undefined && fontWeight >= 600}
        onClick={() => editing
          ? editorApi!.exec('bold')
          : applyText({ fontWeight: (fontWeight ?? 400) >= 600 ? 400 : 700 })}
      />
      <Toggle icon={Italic} label="Itálica" disabled={textCtrlDisabled}
        active={fontStyle === 'italic'}
        onClick={() => editing
          ? editorApi!.exec('italic')
          : applyText({ fontStyle: fontStyle === 'italic' ? 'normal' : 'italic' })}
      />
      <Toggle icon={Underline} label="Subrayado" disabled={textCtrlDisabled}
        active={decoration === 'underline'}
        onClick={() => editing
          ? editorApi!.exec('underline')
          : applyText({ textDecoration: decoration === 'underline' ? undefined : 'underline' })}
      />
      <Toggle icon={Strikethrough} label="Tachado" disabled={textCtrlDisabled}
        active={decoration === 'line-through'}
        onClick={() => editing
          ? editorApi!.exec('strikeThrough')
          : applyText({ textDecoration: decoration === 'line-through' ? undefined : 'line-through' })}
      />
      {/* Super / subíndice — al editar aplica a la selección (execCommand);
          sin editor, no hay equivalente a nivel de elemento (se ignora). */}
      <Toggle icon={Superscript} label="Superíndice (en edición)" disabled={!editing}
        onClick={() => editorApi?.exec('superscript')}
      />
      <Toggle icon={Subscript} label="Subíndice (en edición)" disabled={!editing}
        onClick={() => editorApi?.exec('subscript')}
      />
      {/* Interletra (pt): al editar, a la selección; si no, al elemento entero */}
      <span className="text-[10px] text-muted" title="Interletra (pt)">A↔</span>
      <NumberField
        disabled={textCtrlDisabled}
        value={editing ? undefined : ((textCommon('letterSpacing') as number | undefined) ?? 0)}
        onCommit={(v) => editing ? editorApi!.setLetterSpacing(v) : applyText({ letterSpacing: v })}
        width={48}
      />
      {/* Color de texto (al editar, a la selección; si no, al elemento) */}
      <label
        className="w-[22px] h-[22px] rounded-3 border border-line-2 relative cursor-pointer"
        style={{ background: textColor, opacity: textCtrlDisabled ? 0.5 : 1 }}
        title={`Color texto (${textColor})`}
      >
        <input
          type="color"
          disabled={textCtrlDisabled}
          value={textColor}
          onChange={(e) => editing ? editorApi!.setColor(e.target.value) : applyText({ color: e.target.value })}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      <Sep />

      {/* Alineación */}
      <Toggle icon={AlignLeft} label="Alinear izquierda" disabled={textCtrlDisabled}
        active={align === 'left'} onClick={() => applyText({ align: 'left' })}
      />
      <Toggle icon={AlignCenter} label="Centrar" disabled={textCtrlDisabled}
        active={align === 'center'} onClick={() => applyText({ align: 'center' })}
      />
      <Toggle icon={AlignRight} label="Alinear derecha" disabled={textCtrlDisabled}
        active={align === 'right'} onClick={() => applyText({ align: 'right' })}
      />

      <Sep />

      {/* Justificación */}
      <Toggle icon={JustifyLastIcon('left')} label="Justificar — última línea izquierda"
        disabled={textCtrlDisabled} active={align === 'justify-left'}
        onClick={() => applyText({ align: 'justify-left' })}
      />
      <Toggle icon={JustifyLastIcon('center')} label="Justificar — última línea centrada"
        disabled={textCtrlDisabled} active={align === 'justify-center'}
        onClick={() => applyText({ align: 'justify-center' })}
      />
      <Toggle icon={JustifyLastIcon('right')} label="Justificar — última línea derecha"
        disabled={textCtrlDisabled} active={align === 'justify-right'}
        onClick={() => applyText({ align: 'justify-right' })}
      />
      <Toggle icon={AlignJustify} label="Justificar bloque"
        disabled={textCtrlDisabled} active={align === 'justify-block'}
        onClick={() => applyText({ align: 'justify-block' })}
      />

    </div>
  );
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function Sep() {
  return <div className="w-px h-5 bg-line-2 mx-1.5" />;
}

interface ToggleProps {
  icon: React.ComponentType<{ size?: number | string }>;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function Toggle({ icon: Icon, label, active = false, disabled = false, onClick }: ToggleProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      // No robar el foco del editor de texto al hacer clic (conserva la selección
      // para aplicar el formato inline a la palabra).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="w-[22px] h-[22px] flex items-center justify-center rounded-3 text-ink-2 hover:bg-bg-3 hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
      style={active ? { background: 'var(--bg-4)', color: 'var(--accent)' } : undefined}
    >
      <Icon size={13} />
    </button>
  );
}

interface NumberFieldProps {
  value: number | undefined;
  onCommit: (v: number) => void;
  width?: number;
  disabled?: boolean;
  min?: number;
}

function NumberField({ value, onCommit, width = 54, disabled = false, min }: NumberFieldProps) {
  const display = value === undefined ? '' : String(value);
  return (
    <div
      className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5"
      style={{ width, opacity: disabled ? 0.5 : 1 }}
    >
      <input
        type="number"
        step={0.5}
        {...(min !== undefined ? { min } : {})}
        disabled={disabled}
        placeholder={value === undefined ? '—' : undefined}
        value={display}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value === '' || Number.isNaN(v)) return;
          if (min !== undefined && v < min) return;
          onCommit(v);
        }}
        className="bg-transparent w-full text-right font-mono text-11 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** Siguiente/anterior tamaño (en pt) recorriendo los presets; fuera de ellos, ±1. */
function stepPt(cur: number, dir: 1 | -1): number {
  if (dir > 0) {
    const nxt = FONT_SIZE_PRESETS_PT.find((p) => p > cur + 0.001);
    return nxt ?? Math.round(cur + 1);
  }
  const prev = [...FONT_SIZE_PRESETS_PT].reverse().find((p) => p < cur - 0.001);
  return prev ?? Math.max(1, Math.round(cur - 1));
}

/**
 * Selector de tamaño de fuente estilo Word/Docs: flechas ▲▼ (recorren los tamaños
 * comunes), un valor editable con desplegable (datalist) y un segmento de UNIDAD
 * (pt/px/mm/cm/in) que CONVIERTE el valor. El valor se almacena en pt.
 */
function SizeCombo({
  valuePt, unit, onCommitPt, onUnitChange, disabled = false,
}: {
  valuePt: number | undefined;
  unit: SizeUnit;
  onCommitPt: (pt: number) => void;
  onUnitChange: (u: SizeUnit) => void;
  disabled?: boolean;
}) {
  const shown = valuePt === undefined ? '' : fmtSize(ptToUnit(valuePt, unit), unit);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? shown;
  const listId = 'mc-fontsize-presets';

  const commit = (raw: string) => {
    setDraft(null);
    const v = Number(raw);
    if (raw === '' || Number.isNaN(v) || v <= 0) return;
    onCommitPt(unitToPt(v, unit));
  };
  const step = (dir: 1 | -1) => onCommitPt(stepPt(valuePt ?? 12, dir));

  return (
    <>
      <div
        className="h-[22px] flex items-stretch bg-bg-3 border border-line-2 rounded-3 overflow-hidden"
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        {/* Flechas ▲▼ (steppers) */}
        <div className="flex flex-col justify-center border-r border-line-2" style={{ width: 15 }}>
          <button
            type="button" disabled={disabled} title="Aumentar tamaño"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(1)}
            className="flex-1 flex items-center justify-center text-ink-2 hover:bg-bg-4 disabled:pointer-events-none"
          >
            <ChevronUp size={9} />
          </button>
          <button
            type="button" disabled={disabled} title="Disminuir tamaño"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => step(-1)}
            className="flex-1 flex items-center justify-center text-ink-2 hover:bg-bg-4 disabled:pointer-events-none"
          >
            <ChevronDown size={9} />
          </button>
        </div>
        {/* Valor editable */}
        <input
          type="text"
          inputMode="decimal"
          list={listId}
          disabled={disabled}
          placeholder={valuePt === undefined ? '—' : undefined}
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'Escape') setDraft(null);
            if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
          }}
          className="bg-transparent text-center font-mono text-11 outline-none disabled:cursor-not-allowed"
          style={{ width: 30 }}
        />
        {/* Segmento de unidad (convierte el valor) */}
        <select
          disabled={disabled}
          value={unit}
          onChange={(e) => onUnitChange(e.target.value as SizeUnit)}
          title="Unidad del tamaño (convierte el valor)"
          className="bg-bg-4 border-l border-line-2 text-11 px-0.5 outline-none cursor-pointer disabled:cursor-not-allowed"
          style={{ width: 34 }}
        >
          {SIZE_UNITS.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>
      <datalist id={listId}>
        {FONT_SIZE_PRESETS_PT.map((pt) => (
          <option key={pt} value={fmtSize(ptToUnit(pt, unit), unit)} />
        ))}
      </datalist>
    </>
  );
}

function weightLabel(w: number): string {
  if (w >= 700) return 'Bold';
  if (w >= 600) return 'Semi-Bold';
  if (w >= 500) return 'Medium';
  return 'Regular';
}

function variantToPatch(v: string): Partial<TextEl> {
  switch (v) {
    case 'Italic':
      return { fontStyle: 'italic' };
    case 'Bold':
      return { fontWeight: 700, fontStyle: 'normal' };
    case 'Semi-Bold':
      return { fontWeight: 600, fontStyle: 'normal' };
    case 'Medium':
      return { fontWeight: 500, fontStyle: 'normal' };
    default:
      return { fontWeight: 400, fontStyle: 'normal' };
  }
}

function JustifyLastIcon(lastLine: 'left' | 'center' | 'right') {
  return function Icon({ size = 13 }: { size?: number | string }) {
    const stroke = 'currentColor';
    const y = [3, 6.5, 10, 13.5];
    const fullX1 = 1.5;
    const fullX2 = 14.5;
    const shortLen = 7;
    const lastX1 =
      lastLine === 'left' ? fullX1 : lastLine === 'center' ? (16 - shortLen) / 2 : fullX2 - shortLen;
    const lastX2 = lastX1 + shortLen;
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <line x1={fullX1} y1={y[0]} x2={fullX2} y2={y[0]} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
        <line x1={fullX1} y1={y[1]} x2={fullX2} y2={y[1]} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
        <line x1={fullX1} y1={y[2]} x2={fullX2} y2={y[2]} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
        <line x1={lastX1} y1={y[3]} x2={lastX2} y2={y[3]} stroke={stroke} strokeWidth={1.5} strokeLinecap="round" />
      </svg>
    );
  };
}
