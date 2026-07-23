import { useMemo } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Strikethrough,
  Underline,
} from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import type { CircleEl, ElementModel, LineEl, PenEl, RectEl, TextEl } from '@/types/document';

type Align = TextEl['align'];
type ShapeEl = RectEl | CircleEl | LineEl | PenEl;
type FillableEl = RectEl | CircleEl;

const FONT_FAMILIES = ['Inter', 'JetBrains Mono', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New'];
const FONT_VARIANTS = ['Regular', 'Medium', 'Semi-Bold', 'Bold', 'Italic'];

export default function FormatToolbar() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

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
        (e.type === 'rect' || e.type === 'circle' || e.type === 'line' || e.type === 'pen'),
    );
  }, [pages, selectedIds]);

  const fillableShapes = useMemo<FillableEl[]>(
    () => selectedShapes.filter((e): e is FillableEl => e.type === 'rect' || e.type === 'circle'),
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

  return (
    <div className="h-full bg-bg-1 flex items-center px-2 gap-1.5 text-11">

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
        disabled={textDisabled}
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
        disabled={textDisabled}
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
      <NumberField
        disabled={textDisabled}
        value={fontSize}
        onCommit={(v) => applyText({ fontSize: v })}
        width={54}
        min={1}
      />
      <select
        disabled={textDisabled}
        defaultValue="pt"
        className="h-[22px] bg-bg-3 border border-line-2 rounded-3 text-11 px-1.5 outline-none disabled:opacity-50"
        style={{ width: 48 }}
      >
        <option value="pt">pt</option>
        <option value="px">px</option>
        <option value="mm">mm</option>
      </select>

      <Sep />

      {/* Estilo */}
      <Toggle icon={Bold} label="Bold" disabled={textDisabled}
        active={fontWeight !== undefined && fontWeight >= 600}
        onClick={() => applyText({ fontWeight: (fontWeight ?? 400) >= 600 ? 400 : 700 })}
      />
      <Toggle icon={Italic} label="Itálica" disabled={textDisabled}
        active={fontStyle === 'italic'}
        onClick={() => applyText({ fontStyle: fontStyle === 'italic' ? 'normal' : 'italic' })}
      />
      <Toggle icon={Underline} label="Subrayado" disabled={textDisabled}
        active={decoration === 'underline'}
        onClick={() => applyText({ textDecoration: decoration === 'underline' ? undefined : 'underline' })}
      />
      <Toggle icon={Strikethrough} label="Tachado" disabled={textDisabled}
        active={decoration === 'line-through'}
        onClick={() => applyText({ textDecoration: decoration === 'line-through' ? undefined : 'line-through' })}
      />
      {/* Color de texto */}
      <label
        className="w-[22px] h-[22px] rounded-3 border border-line-2 relative cursor-pointer"
        style={{ background: textColor, opacity: textDisabled ? 0.5 : 1 }}
        title={`Color texto (${textColor})`}
      >
        <input
          type="color"
          disabled={textDisabled}
          value={textColor}
          onChange={(e) => applyText({ color: e.target.value })}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

      <Sep />

      {/* Alineación */}
      <Toggle icon={AlignLeft} label="Alinear izquierda" disabled={textDisabled}
        active={align === 'left'} onClick={() => applyText({ align: 'left' })}
      />
      <Toggle icon={AlignCenter} label="Centrar" disabled={textDisabled}
        active={align === 'center'} onClick={() => applyText({ align: 'center' })}
      />
      <Toggle icon={AlignRight} label="Alinear derecha" disabled={textDisabled}
        active={align === 'right'} onClick={() => applyText({ align: 'right' })}
      />

      <Sep />

      {/* Justificación */}
      <Toggle icon={JustifyLastIcon('left')} label="Justificar — última línea izquierda"
        disabled={textDisabled} active={align === 'justify-left'}
        onClick={() => applyText({ align: 'justify-left' })}
      />
      <Toggle icon={JustifyLastIcon('center')} label="Justificar — última línea centrada"
        disabled={textDisabled} active={align === 'justify-center'}
        onClick={() => applyText({ align: 'justify-center' })}
      />
      <Toggle icon={JustifyLastIcon('right')} label="Justificar — última línea derecha"
        disabled={textDisabled} active={align === 'justify-right'}
        onClick={() => applyText({ align: 'justify-right' })}
      />
      <Toggle icon={AlignJustify} label="Justificar bloque"
        disabled={textDisabled} active={align === 'justify-block'}
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
