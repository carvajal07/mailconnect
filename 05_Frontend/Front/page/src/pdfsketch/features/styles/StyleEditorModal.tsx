import { useEffect, useRef, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import type {
  TextStyle, ParagraphStyle, BorderStyle, LineStyle, FillStyle,
  CapStyle, LineDashStyle, CornerStyle, BorderParts,
} from '@/types/document';
import { useDocumentStore, type StyleKey, type AnyStyleItem } from '@/store/documentStore';
import { nextId } from '@/utils/id';

export type StyleEditorTarget =
  | { key: 'textStyles'; item: TextStyle | null }
  | { key: 'paragraphStyles'; item: ParagraphStyle | null }
  | { key: 'borderStyles'; item: BorderStyle | null }
  | { key: 'lineStyles'; item: LineStyle | null }
  | { key: 'fillStyles'; item: FillStyle | null };

interface Props {
  target: StyleEditorTarget;
  onClose: () => void;
}

const KEY_LABELS: Record<StyleKey, string> = {
  textStyles: 'Estilo de texto',
  paragraphStyles: 'Estilo de párrafo',
  borderStyles: 'Estilo de borde',
  lineStyles: 'Estilo de línea',
  fillStyles: 'Estilo de relleno',
};

export default function StyleEditorModal({ target, onClose }: Props) {
  const addStyle = useDocumentStore((s) => s.addStyle);
  const updateStyle = useDocumentStore((s) => s.updateStyle);
  const removeStyle = useDocumentStore((s) => s.removeStyle);

  const isNew = target.item === null;
  const [draft, setDraft] = useState<AnyStyleItem>(() => buildDefault(target));

  useEffect(() => {
    setDraft(buildDefault(target));
  }, [target.key, target.item?.id]);

  const overlayRef = useRef<HTMLDivElement>(null);

  function save() {
    if (isNew) {
      addStyle(target.key, draft);
    } else {
      updateStyle(target.key, draft.id, draft);
    }
    onClose();
  }

  function del() {
    if (!isNew) removeStyle(target.key, draft.id);
    onClose();
  }

  function patch(p: Partial<AnyStyleItem>) {
    setDraft((d) => ({ ...d, ...p } as AnyStyleItem));
  }

  const modalWidth = target.key === 'borderStyles' ? 480 : target.key === 'lineStyles' ? 420 : 380;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div
        className="rounded-lg shadow-2xl flex flex-col"
        style={{
          background: 'var(--bg-1)',
          border: '1px solid var(--bg-3)',
          width: modalWidth,
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <div
          className="h-10 shrink-0 flex items-center px-4 gap-2"
          style={{ borderBottom: '1px solid var(--bg-3)' }}
        >
          <span className="font-semibold text-sm text-ink flex-1">
            {isNew ? `Nuevo ${KEY_LABELS[target.key]}` : KEY_LABELS[target.key]}
          </span>
          {!isNew && (
            <button
              type="button"
              onClick={del}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 text-red-400"
              title="Eliminar estilo"
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded hover:bg-bg-3 text-muted"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {/* Nombre — siempre */}
          <Row label="Nombre">
            <input
              className="field"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Row>

          {target.key === 'textStyles' && (
            <TextStyleFields draft={draft as TextStyle} patch={patch} />
          )}
          {target.key === 'paragraphStyles' && (
            <ParagraphStyleFields draft={draft as ParagraphStyle} patch={patch} />
          )}
          {target.key === 'borderStyles' && (
            <BorderStyleFields draft={draft as BorderStyle} patch={patch} />
          )}
          {target.key === 'lineStyles' && (
            <LineStyleFields draft={draft as LineStyle} patch={patch} />
          )}
          {target.key === 'fillStyles' && (
            <FillStyleFields draft={draft as FillStyle} patch={patch} />
          )}
        </div>

        {/* Footer */}
        <div
          className="h-12 shrink-0 flex items-center justify-end gap-2 px-4"
          style={{ borderTop: '1px solid var(--bg-3)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-8 rounded text-sm hover:bg-bg-3 text-ink-2"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            className="px-4 h-8 rounded text-sm font-semibold"
            style={{ background: 'var(--accent)', color: '#0b1a10' }}
          >
            {isNew ? 'Crear' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Row helpers ─── */

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-11 text-muted w-36 shrink-0">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function Divider({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      {label && <span className="text-[10px] font-semibold text-muted uppercase tracking-wide">{label}</span>}
      <div className="flex-1 h-px" style={{ background: 'var(--line-2)' }} />
    </div>
  );
}

export function NumInput({
  value, onChange, min = 0, max, step = 1, unit,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        className="field flex-1 min-w-0"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {unit && <span className="text-[10px] text-muted shrink-0 w-6">{unit}</span>}
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-7 h-7 rounded shrink-0 border cursor-pointer relative overflow-hidden"
        style={{ borderColor: 'var(--line-2)' }}
      >
        <input
          type="color"
          value={value.startsWith('#') ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          style={{ padding: 0, border: 'none' }}
        />
        <div className="w-full h-full rounded" style={{ background: value }} />
      </div>
      <input
        className="field flex-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#000000"
      />
    </div>
  );
}

/* ─── BorderStyle fields ─── */

const DASH_PATTERNS: { value: LineDashStyle; label: string; preview: number[] | null }[] = [
  { value: 'Solid',   label: 'Sólido',       preview: null },
  { value: 'Dashed',  label: 'Guiones',       preview: [8, 4] },
  { value: 'Dotted',  label: 'Puntos',        preview: [2, 4] },
  { value: 'DashDot', label: 'Punto-guión',   preview: [8, 4, 2, 4] },
];

const CAP_OPTIONS: { value: CapStyle; label: string }[] = [
  { value: 'Butt',   label: 'Plano (Butt)' },
  { value: 'Round',  label: 'Redondo (Round)' },
  { value: 'Square', label: 'Cuadrado (Square)' },
];

const CORNER_OPTIONS: { value: CornerStyle; label: string }[] = [
  { value: 'Standard', label: 'Estándar (Miter)' },
  { value: 'Round',    label: 'Redondo' },
  { value: 'Bevel',    label: 'Bisel' },
];

function DashPreviewSvg({ pattern, color = 'currentColor' }: { pattern: number[] | null; color?: string }) {
  const w = 48;
  const h = 8;
  const strokeDasharray = pattern ? pattern.join(' ') : undefined;
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }}>
      <line
        x1="2" y1={h / 2} x2={w - 2} y2={h / 2}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="butt"
        strokeDasharray={strokeDasharray}
      />
    </svg>
  );
}

/* ─── Default parts (all enabled) ─── */

const ALL_PARTS_ON: BorderParts = {
  top: true, right: true, bottom: true, left: true,
  cornerTL: true, cornerTR: true, cornerBR: true, cornerBL: true,
  diagLR: false, diagRL: false,
};

const NO_PARTS: BorderParts = {
  top: false, right: false, bottom: false, left: false,
  cornerTL: false, cornerTR: false, cornerBR: false, cornerBL: false,
  diagLR: false, diagRL: false,
};

/* ─── Large border preview ─── */

function BorderPreview({ draft }: { draft: BorderStyle }) {
  const W = 440, H = 80;
  const pad = 10;
  const parts = draft.parts ?? ALL_PARTS_ON;
  const dashPattern = DASH_PATTERNS.find((d) => d.value === (draft.lineDash ?? 'Solid'));
  const dashArray = dashPattern?.preview ? dashPattern.preview.join(' ') : undefined;
  const sw = Math.max(0.5, Math.min(draft.lineWidth * 3.78, 8));
  const col = draft.colorId || '#000000';
  const cap = (draft.cap ?? 'Butt').toLowerCase() as 'butt' | 'round' | 'square';
  const join: 'round' | 'bevel' | 'miter' =
    draft.corner === 'Round' ? 'round' : draft.corner === 'Bevel' ? 'bevel' : 'miter';
  const r = draft.corner === 'Round' ? Math.min(draft.radiusX * 3.78, (W - pad * 2) / 3) : 0;
  const hasFill = draft.fillColor && draft.fillColor !== 'none';

  const x0 = pad + sw / 2, y0 = pad + sw / 2;
  const x1 = W - pad - sw / 2, y1 = H - pad - sw / 2;
  const cLen = Math.min(r || 12, (x1 - x0) / 3, (y1 - y0) / 2);

  const lineProps = {
    stroke: col, strokeWidth: sw,
    strokeLinecap: cap, strokeLinejoin: join,
    strokeDasharray: dashArray, fill: 'none',
  };

  return (
    <div
      className="rounded overflow-hidden"
      style={{ background: 'var(--bg-0)', border: '1px solid var(--line-2)' }}
    >
      <svg width={W} height={H} style={{ display: 'block' }}>
        {/* Fill */}
        {hasFill && (
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} fill={draft.fillColor} />
        )}
        {/* Sides */}
        {parts.top    && <line x1={x0 + cLen} y1={y0} x2={x1 - cLen} y2={y0} {...lineProps} />}
        {parts.bottom && <line x1={x0 + cLen} y1={y1} x2={x1 - cLen} y2={y1} {...lineProps} />}
        {parts.left   && <line x1={x0} y1={y0 + cLen} x2={x0} y2={y1 - cLen} {...lineProps} />}
        {parts.right  && <line x1={x1} y1={y0 + cLen} x2={x1} y2={y1 - cLen} {...lineProps} />}
        {/* Corners */}
        {parts.cornerTL && <polyline points={`${x0},${y0 + cLen} ${x0},${y0} ${x0 + cLen},${y0}`} {...lineProps} />}
        {parts.cornerTR && <polyline points={`${x1 - cLen},${y0} ${x1},${y0} ${x1},${y0 + cLen}`} {...lineProps} />}
        {parts.cornerBR && <polyline points={`${x1},${y1 - cLen} ${x1},${y1} ${x1 - cLen},${y1}`} {...lineProps} />}
        {parts.cornerBL && <polyline points={`${x0 + cLen},${y1} ${x0},${y1} ${x0},${y1 - cLen}`} {...lineProps} />}
        {/* Diagonals */}
        {parts.diagLR && <line x1={x0} y1={y0} x2={x1} y2={y1} {...lineProps} />}
        {parts.diagRL && <line x1={x1} y1={y0} x2={x0} y2={y1} {...lineProps} />}
      </svg>
    </div>
  );
}

/* ─── 10-part icon button selector ─── */

type PartKey = keyof BorderParts;

function PartIcon({ partKey, active }: { partKey: PartKey; active: boolean }) {
  const col = active ? 'var(--accent)' : 'var(--ink-2)';
  const sw = 1.8;
  const W = 20, H = 16, p = 2, c = 5;

  const el: Record<PartKey, React.ReactNode> = {
    top:      <line x1={p} y1={p}     x2={W - p} y2={p}     stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    bottom:   <line x1={p} y1={H - p} x2={W - p} y2={H - p} stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    left:     <line x1={p} y1={p}     x2={p}     y2={H - p} stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    right:    <line x1={W-p} y1={p}   x2={W-p}   y2={H - p} stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    cornerTL: <polyline points={`${p},${p+c} ${p},${p} ${p+c},${p}`}                     fill="none" stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    cornerTR: <polyline points={`${W-p-c},${p} ${W-p},${p} ${W-p},${p+c}`}               fill="none" stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    cornerBR: <polyline points={`${W-p},${H-p-c} ${W-p},${H-p} ${W-p-c},${H-p}`}         fill="none" stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    cornerBL: <polyline points={`${p+c},${H-p} ${p},${H-p} ${p},${H-p-c}`}               fill="none" stroke={col} strokeWidth={sw} strokeLinecap="square" />,
    diagLR:   <line x1={p} y1={p} x2={W-p} y2={H-p} stroke={col} strokeWidth={sw} strokeLinecap="round" />,
    diagRL:   <line x1={W-p} y1={p} x2={p} y2={H-p} stroke={col} strokeWidth={sw} strokeLinecap="round" />,
  };

  return (
    <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
      <rect x={p} y={p} width={W - p * 2} height={H - p * 2}
        fill="none" stroke="var(--line-2)" strokeWidth={0.5} strokeDasharray="2 2" />
      {el[partKey]}
    </svg>
  );
}

const PART_DEFS: { key: PartKey; title: string }[] = [
  { key: 'top',      title: 'Línea superior' },
  { key: 'bottom',   title: 'Línea inferior' },
  { key: 'left',     title: 'Línea izquierda' },
  { key: 'right',    title: 'Línea derecha' },
  { key: 'cornerTL', title: 'Esquina sup. izq.' },
  { key: 'cornerTR', title: 'Esquina sup. der.' },
  { key: 'cornerBR', title: 'Esquina inf. der.' },
  { key: 'cornerBL', title: 'Esquina inf. izq.' },
  { key: 'diagLR',   title: 'Diagonal ↘' },
  { key: 'diagRL',   title: 'Diagonal ↗' },
];

const QUICK_SETS: { title: string; parts: BorderParts }[] = [
  {
    title: 'Todos los bordes',
    parts: { top: true, right: true, bottom: true, left: true, cornerTL: true, cornerTR: true, cornerBR: true, cornerBL: true, diagLR: false, diagRL: false },
  },
  {
    title: 'Solo contorno (sin esquinas)',
    parts: { top: true, right: true, bottom: true, left: true, cornerTL: false, cornerTR: false, cornerBR: false, cornerBL: false, diagLR: false, diagRL: false },
  },
  {
    title: 'Solo esquinas',
    parts: { top: false, right: false, bottom: false, left: false, cornerTL: true, cornerTR: true, cornerBR: true, cornerBL: true, diagLR: false, diagRL: false },
  },
  {
    title: 'Sin bordes',
    parts: NO_PARTS,
  },
];

function QuickSetIcon({ parts }: { parts: BorderParts }) {
  const W = 18, H = 14, p = 2, c = 4, col = 'currentColor', sw = 1.5;
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <rect x={p} y={p} width={W - p * 2} height={H - p * 2}
        fill="none" stroke="var(--line-2)" strokeWidth={0.5} strokeDasharray="2 2" />
      {parts.top    && <line x1={p+c} y1={p}     x2={W-p-c} y2={p}     stroke={col} strokeWidth={sw} strokeLinecap="square" />}
      {parts.bottom && <line x1={p+c} y1={H-p}   x2={W-p-c} y2={H-p}   stroke={col} strokeWidth={sw} strokeLinecap="square" />}
      {parts.left   && <line x1={p}   y1={p+c}   x2={p}     y2={H-p-c} stroke={col} strokeWidth={sw} strokeLinecap="square" />}
      {parts.right  && <line x1={W-p} y1={p+c}   x2={W-p}   y2={H-p-c} stroke={col} strokeWidth={sw} strokeLinecap="square" />}
      {parts.cornerTL && <polyline points={`${p},${p+c} ${p},${p} ${p+c},${p}`}               fill="none" stroke={col} strokeWidth={sw} />}
      {parts.cornerTR && <polyline points={`${W-p-c},${p} ${W-p},${p} ${W-p},${p+c}`}         fill="none" stroke={col} strokeWidth={sw} />}
      {parts.cornerBR && <polyline points={`${W-p},${H-p-c} ${W-p},${H-p} ${W-p-c},${H-p}`}   fill="none" stroke={col} strokeWidth={sw} />}
      {parts.cornerBL && <polyline points={`${p+c},${H-p} ${p},${H-p} ${p},${H-p-c}`}         fill="none" stroke={col} strokeWidth={sw} />}
      {parts.diagLR   && <line x1={p} y1={p} x2={W-p} y2={H-p} stroke={col} strokeWidth={sw} />}
      {parts.diagRL   && <line x1={W-p} y1={p} x2={p} y2={H-p} stroke={col} strokeWidth={sw} />}
    </svg>
  );
}

function BorderPartSelector({
  parts,
  onChange,
}: {
  parts: BorderParts;
  onChange: (p: BorderParts) => void;
}) {
  function toggle(key: PartKey) {
    onChange({ ...parts, [key]: !parts[key] });
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Quick-set presets */}
      {QUICK_SETS.map((qs, i) => (
        <button
          key={i}
          type="button"
          title={qs.title}
          onClick={() => onChange(qs.parts)}
          className="flex items-center justify-center w-7 h-7 rounded"
          style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}
        >
          <QuickSetIcon parts={qs.parts} />
        </button>
      ))}

      {/* Separator */}
      <div className="w-px h-5 shrink-0" style={{ background: 'var(--line-2)' }} />

      {/* Individual part toggles */}
      {PART_DEFS.map(({ key, title }) => (
        <button
          key={key}
          type="button"
          title={title}
          onClick={() => toggle(key)}
          className="flex items-center justify-center w-7 h-7 rounded transition-colors"
          style={
            parts[key]
              ? { background: 'var(--accent-soft)', border: '1px solid var(--accent-dim)', color: 'var(--accent)' }
              : { background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }
          }
        >
          <PartIcon partKey={key} active={parts[key]} />
        </button>
      ))}
    </div>
  );
}

/* ─── BorderStyleFields with tabs ─── */

type BorderTab = 'lines' | 'shading';

const BORDER_TABS: { key: BorderTab; label: string }[] = [
  { key: 'lines',   label: 'Líneas/Esquinas' },
  { key: 'shading', label: 'Sombreado' },
];

export function BorderStyleFields({ draft, patch }: { draft: BorderStyle; patch: (p: Partial<BorderStyle>) => void }) {
  const [tab, setTab] = useState<BorderTab>('lines');

  const cap = draft.cap ?? 'Butt';
  const lineDash = draft.lineDash ?? 'Solid';
  const corner = draft.corner ?? 'Standard';
  const radiusX = draft.radiusX ?? 0;
  const radiusY = draft.radiusY ?? 0;
  const selectedDash = DASH_PATTERNS.find((d) => d.value === lineDash) ?? DASH_PATTERNS[0];
  const parts = draft.parts ?? ALL_PARTS_ON;

  return (
    <>
      {/* ─── Large preview ─── */}
      <BorderPreview draft={{ ...draft, cap, lineDash, corner, radiusX, radiusY }} />

      {/* ─── 10-part selector ─── */}
      <BorderPartSelector parts={parts} onChange={(p) => patch({ parts: p })} />

      {/* ─── Tab bar ─── */}
      <div
        className="flex mt-1"
        style={{ borderBottom: '1px solid var(--line-2)' }}
      >
        {BORDER_TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="px-3 h-8 text-11 font-medium relative"
            style={
              tab === key
                ? { color: 'var(--accent)', borderBottom: '2px solid var(--accent)', marginBottom: -1 }
                : { color: 'var(--ink-2)' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* ─── Líneas/Esquinas ─── */}
      {tab === 'lines' && (
        <>
          <Row label="Color de línea">
            <ColorInput value={draft.colorId || '#000000'} onChange={(v) => patch({ colorId: v })} />
          </Row>

          <Row label="Grosor">
            <NumInput value={draft.lineWidth} min={0} step={0.05} unit="mm"
              onChange={(v) => patch({ lineWidth: v })} />
          </Row>

          <Row label="Extremo (Cap)">
            <select className="field w-full" value={cap}
              onChange={(e) => patch({ cap: e.target.value as CapStyle })}>
              {CAP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Row>

          <Row label="Estilo de línea">
            <div className="flex items-center gap-2">
              <select className="field flex-1" value={lineDash}
                onChange={(e) => patch({ lineDash: e.target.value as LineDashStyle })}>
                {DASH_PATTERNS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <DashPreviewSvg pattern={selectedDash.preview} color="var(--ink)" />
            </div>
          </Row>

          <Divider label="Esquinas" />

          <Row label="Tipo">
            <select className="field w-full" value={corner}
              onChange={(e) => patch({ corner: e.target.value as CornerStyle })}>
              {CORNER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Row>

          <Row label="Radio X">
            <NumInput value={radiusX} min={0} step={0.5} unit="mm"
              onChange={(v) => patch({ radiusX: v })} />
          </Row>

          <Row label="Radio Y">
            <NumInput value={radiusY} min={0} step={0.5} unit="mm"
              onChange={(v) => patch({ radiusY: v })} />
          </Row>
        </>
      )}

      {/* ─── Sombreado ─── */}
      {tab === 'shading' && (
        <ShadingTab
          fillColor={draft.fillColor}
          onChange={(v) => patch({ fillColor: v })}
        />
      )}
    </>
  );
}

/* ─── ShadingTab ─── */

function ShadingTab({
  fillColor,
  onChange,
}: {
  fillColor: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const isNone = !fillColor || fillColor === 'none';

  return (
    <>
      {/* Color fill style */}
      <Row label="Estilo de relleno">
        <div className="flex items-center gap-2 flex-1">
          {/* Transparent/color toggle */}
          <div
            className="w-6 h-6 rounded shrink-0 border cursor-pointer relative overflow-hidden"
            style={{ borderColor: 'var(--line-2)' }}
            title={isNone ? 'Sin relleno' : 'Con relleno'}
          >
            {isNone ? (
              <div className="w-full h-full" style={{ background: 'repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 0 0 / 6px 6px' }} />
            ) : (
              <>
                <div className="absolute inset-0 rounded" style={{ background: fillColor }} />
                <input
                  type="color"
                  value={fillColor.startsWith('#') ? fillColor : '#ffffff'}
                  onChange={(e) => onChange(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                />
              </>
            )}
          </div>
          <input
            type="text"
            className="field flex-1 font-mono text-11"
            value={isNone ? '' : fillColor}
            placeholder="Sin relleno"
            onChange={(e) => onChange(e.target.value || undefined)}
          />
          <button
            type="button"
            title={isNone ? 'Activar relleno' : 'Quitar relleno'}
            className="text-11 px-2 h-7 rounded shrink-0"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}
            onClick={() => onChange(isNone ? '#ffffff' : undefined)}
          >
            {isNone ? 'Activar' : 'Quitar'}
          </button>
        </div>
      </Row>

      {!isNone && (
        <>
          {/* Large color preview */}
          <div
            className="h-16 rounded mt-1 flex items-end justify-end p-2"
            style={{ background: fillColor, border: '1px solid var(--line-2)' }}
          >
            <span className="text-[10px] font-mono px-1 rounded"
              style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}>
              {fillColor}
            </span>
          </div>

          {/* Quick color swatches */}
          <div className="flex gap-1 flex-wrap mt-1">
            {['#ffffff', '#f0f0f0', '#d0d0d0', '#a0a0a0', '#000000',
              '#fef9c3', '#fde68a', '#fed7aa', '#fecaca', '#bbf7d0',
              '#bfdbfe', '#ddd6fe', '#fbcfe8'].map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onClick={() => onChange(c)}
                className="w-5 h-5 rounded shrink-0"
                style={{
                  background: c,
                  border: fillColor === c ? '2px solid var(--accent)' : '1px solid var(--line-2)',
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/* ─── LineStyle fields ─── */

const LINE_JOIN_OPTIONS: { value: LineStyle['join']; label: string }[] = [
  { value: 'Miter', label: 'Miter (punta)' },
  { value: 'Round', label: 'Redondo' },
  { value: 'Bevel', label: 'Bisel' },
];

export function LineStyleFields({ draft, patch }: { draft: LineStyle; patch: (p: Partial<LineStyle>) => void }) {
  const cap = draft.cap ?? 'Butt';
  const join = draft.join ?? 'Round';
  const selectedDash = DASH_PATTERNS.find(
    (d) => JSON.stringify(d.preview) === JSON.stringify(draft.dash ?? null),
  ) ?? DASH_PATTERNS[0];

  return (
    <>
      {/* Vista previa */}
      <div
        className="flex items-center justify-center rounded"
        style={{ background: 'var(--bg-0)', border: '1px solid var(--line-2)', padding: '12px 16px' }}
      >
        <svg width={180} height={20}>
          <line
            x1="4"
            y1="10"
            x2="176"
            y2="10"
            stroke={draft.colorId || 'var(--ink)'}
            strokeWidth={Math.max(1, Math.min(draft.width * 3, 10))}
            strokeLinecap={(cap).toLowerCase() as 'butt' | 'round' | 'square'}
            strokeDasharray={draft.dash?.join(' ')}
          />
        </svg>
      </div>

      <Divider label="Trazo" />

      {draft.colorId !== undefined && (
        <Row label="Color">
          <ColorInput value={draft.colorId || '#000000'} onChange={(v) => patch({ colorId: v })} />
        </Row>
      )}

      <Row label="Grosor">
        <NumInput value={draft.width} min={0} step={0.1} unit="mm" onChange={(v) => patch({ width: v })} />
      </Row>

      <Row label="Extremo (Cap)">
        <select
          className="field w-full"
          value={cap}
          onChange={(e) => patch({ cap: e.target.value as CapStyle })}
        >
          {CAP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Row>

      <Row label="Unión (Join)">
        <select
          className="field w-full"
          value={join}
          onChange={(e) => patch({ join: e.target.value as LineStyle['join'] })}
        >
          {LINE_JOIN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </Row>

      <Row label="Patrón">
        <div className="flex items-center gap-2">
          <select
            className="field flex-1"
            value={selectedDash.value}
            onChange={(e) => {
              const found = DASH_PATTERNS.find((d) => d.value === e.target.value);
              patch({ dash: found?.preview ?? undefined });
            }}
          >
            {DASH_PATTERNS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <DashPreviewSvg pattern={selectedDash.preview} color="var(--ink)" />
        </div>
      </Row>
    </>
  );
}

/* ─── TextStyle fields ─── */

export function TextStyleFields({ draft, patch }: { draft: TextStyle; patch: (p: Partial<TextStyle>) => void }) {
  return (
    <>
      <Divider label="Fuente" />
      <Row label="Fuente">
        <input className="field" value={draft.fontId} onChange={(e) => patch({ fontId: e.target.value })} placeholder="Arial" />
      </Row>
      <Row label="Variante">
        <select className="field" value={draft.subFont} onChange={(e) => patch({ subFont: e.target.value })}>
          {['Regular', 'Bold', 'Italic', 'BoldItalic'].map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </Row>
      <Row label="Tamaño (pt)">
        <NumInput value={draft.fontSize} min={1} onChange={(v) => patch({ fontSize: v })} />
      </Row>
      <Row label="Color">
        <ColorInput value={draft.fillStyleId || '#000000'} onChange={(v) => patch({ fillStyleId: v })} />
      </Row>

      <Divider label="Reglas" />
      <Row label="Interletra (pt)">
        <NumInput value={draft.letterSpacing ?? 0} min={-5} step={0.1} onChange={(v) => patch({ letterSpacing: v })} />
      </Row>
      <Row label="Interlineado (×)">
        <NumInput value={draft.lineHeight ?? 1.2} min={0.5} max={5} step={0.1} onChange={(v) => patch({ lineHeight: v })} />
      </Row>
      <Row label="Transformación">
        <select className="field" value={draft.textTransform ?? 'none'}
          onChange={(e) => patch({ textTransform: e.target.value as TextStyle['textTransform'] })}>
          <option value="none">Ninguna</option>
          <option value="uppercase">MAYÚSCULAS</option>
          <option value="lowercase">minúsculas</option>
          <option value="capitalize">Capitalizar</option>
        </select>
      </Row>

      <Divider label="Super / Sub" />
      <Row label="Superíndice">
        <input type="checkbox" checked={!!draft.superscript}
          onChange={(e) => patch({ superscript: e.target.checked, subscript: e.target.checked ? false : draft.subscript })} />
      </Row>
      <Row label="Subíndice">
        <input type="checkbox" checked={!!draft.subscript}
          onChange={(e) => patch({ subscript: e.target.checked, superscript: e.target.checked ? false : draft.superscript })} />
      </Row>
      <Row label="Tamaño super/sub (%)">
        <NumInput value={draft.superSubSize ?? 58} min={10} max={100} step={1} onChange={(v) => patch({ superSubSize: v })} />
      </Row>

      <Divider label="Líneas" />
      <Row label="Subrayado">
        <input type="checkbox" checked={!!draft.underline}
          onChange={(e) => patch({ underline: e.target.checked })} />
      </Row>
      <Row label="Tachado">
        <input type="checkbox" checked={!!draft.strikethrough}
          onChange={(e) => patch({ strikethrough: e.target.checked })} />
      </Row>
    </>
  );
}

/* ─── ParagraphStyle fields ─── */

export function ParagraphStyleFields({ draft, patch }: { draft: ParagraphStyle; patch: (p: Partial<ParagraphStyle>) => void }) {
  return (
    <>
      <Divider label="General" />
      <Row label="Alineación">
        <select className="field" value={draft.hAlign} onChange={(e) => patch({ hAlign: e.target.value as ParagraphStyle['hAlign'] })}>
          {(['Left', 'Center', 'Right', 'Justify'] as const).map((v) => (
            <option key={v} value={v}>{{ Left: 'Izquierda', Center: 'Centro', Right: 'Derecha', Justify: 'Justificado' }[v]}</option>
          ))}
        </select>
      </Row>
      <Row label="Interlineado (mm)">
        <NumInput value={draft.lineSpacing} min={0} step={0.5} onChange={(v) => patch({ lineSpacing: v })} />
      </Row>

      <Divider label="Sangrías" />
      <Row label="Sangría izq. (mm)">
        <NumInput value={draft.leftIndent} min={0} step={0.5} onChange={(v) => patch({ leftIndent: v })} />
      </Row>
      <Row label="Sangría der. (mm)">
        <NumInput value={draft.rightIndent} min={0} step={0.5} onChange={(v) => patch({ rightIndent: v })} />
      </Row>
      <Row label="Primera línea (mm)">
        <NumInput value={draft.firstLineLeftIndent} step={0.5} onChange={(v) => patch({ firstLineLeftIndent: v })} />
      </Row>

      <Divider label="Espaciado" />
      <Row label="Espacio antes (mm)">
        <NumInput value={draft.spaceBefore} min={0} step={0.5} onChange={(v) => patch({ spaceBefore: v })} />
      </Row>
      <Row label="Espacio después (mm)">
        <NumInput value={draft.spaceAfter} min={0} step={0.5} onChange={(v) => patch({ spaceAfter: v })} />
      </Row>

      <Divider label="Listas" />
      <Row label="Estilo de lista">
        <select className="field" value={draft.listStyle ?? 'none'}
          onChange={(e) => patch({ listStyle: e.target.value as ParagraphStyle['listStyle'] })}>
          <option value="none">Ninguna</option>
          <option value="bullet">Viñetas</option>
          <option value="numbered">Numerada</option>
          <option value="letter">Letras</option>
        </select>
      </Row>
      {draft.listStyle === 'bullet' && (
        <Row label="Viñeta">
          <div className="flex items-center gap-1 flex-wrap">
            {['•', '○', '■', '□', '❖', '➢', '✓'].map((ch) => (
              <button key={ch} type="button"
                onClick={() => patch({ bulletChar: ch })}
                className="w-6 h-6 rounded text-sm"
                style={(draft.bulletChar ?? '•') === ch
                  ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' }
                  : { background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink)' }}>
                {ch}
              </button>
            ))}
            <input className="field" style={{ width: 44 }} maxLength={3}
              value={draft.bulletChar ?? '•'}
              onChange={(e) => patch({ bulletChar: e.target.value || '•' })} />
          </div>
        </Row>
      )}
      {(draft.listStyle === 'numbered' || draft.listStyle === 'letter') && (
        <Row label="Formato">
          <select className="field" value={draft.numberFormat ?? '0.'}
            onChange={(e) => patch({ numberFormat: e.target.value })}>
            <option value="0.">1. / a.</option>
            <option value="0)">1) / a)</option>
            <option value="(0)">(1) / (a)</option>
          </select>
        </Row>
      )}
      {draft.listStyle && draft.listStyle !== 'none' && (
        <Row label="Sangría lista (mm)">
          <NumInput value={draft.listIndent ?? 5} min={0} step={0.5} onChange={(v) => patch({ listIndent: v })} />
        </Row>
      )}

      <Divider label="Flujo (saltos de línea/página)" />
      <Row label="No cortar líneas">
        <select className="field" value={draft.keepLinesTogether} onChange={(e) => patch({ keepLinesTogether: e.target.value as 'Yes' | 'No' })}>
          <option value="No">No</option>
          <option value="Yes">Sí</option>
        </select>
      </Row>
      <Row label="Mantener con la siguiente">
        <input type="checkbox" checked={!!draft.keepWithNext}
          onChange={(e) => patch({ keepWithNext: e.target.checked })} />
      </Row>
      <Row label="No ajustar (dontWrap)">
        <input type="checkbox" checked={!!draft.dontWrap}
          onChange={(e) => patch({ dontWrap: e.target.checked })} />
      </Row>
      <Row label="Líneas viudas (mín.)">
        <NumInput value={draft.widow ?? 1} min={0} step={1} onChange={(v) => patch({ widow: v })} />
      </Row>
      <Row label="Líneas huérfanas (mín.)">
        <NumInput value={draft.orphan ?? 1} min={0} step={1} onChange={(v) => patch({ orphan: v })} />
      </Row>
    </>
  );
}

/* ─── FillStyle fields (paridad Diseñador: none/sólido/degradado + opacidad) ─── */

const FILL_TYPE_LABELS: { value: NonNullable<FillStyle['fillType']>; label: string }[] = [
  { value: 'none',   label: 'Ninguno (transparente)' },
  { value: 'solid',  label: 'Sólido' },
  { value: 'linear', label: 'Degradado lineal' },
  { value: 'radial', label: 'Degradado radial' },
];

function defaultGradient(kind: 'linear' | 'radial'): NonNullable<FillStyle['gradient']> {
  return {
    kind,
    angle: 180,
    cx: 50,
    cy: 50,
    stops: [
      { offset: 0, color: '#ffffff', opacity: 1 },
      { offset: 100, color: '#3b82f6', opacity: 1 },
    ],
  };
}

export function FillStyleFields({ draft, patch }: { draft: FillStyle; patch: (p: Partial<FillStyle>) => void }) {
  const type = draft.fillType ?? 'solid';
  const grad = draft.gradient;
  const isGradient = type === 'linear' || type === 'radial';

  const setGrad = (p: Partial<NonNullable<FillStyle['gradient']>>) => {
    const base = grad ?? defaultGradient(type === 'radial' ? 'radial' : 'linear');
    patch({ gradient: { ...base, ...p, kind: type === 'radial' ? 'radial' : 'linear' } });
  };

  const stops = grad?.stops ?? [];
  const gradCss = isGradient && stops.length
    ? (type === 'radial'
      ? `radial-gradient(circle at ${grad?.cx ?? 50}% ${grad?.cy ?? 50}%, ${[...stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${s.offset}%`).join(', ')})`
      : `linear-gradient(${grad?.angle ?? 180}deg, ${[...stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${s.offset}%`).join(', ')})`)
    : undefined;

  return (
    <>
      <Row label="Tipo de relleno">
        <select className="field" value={type}
          onChange={(e) => {
            const t = e.target.value as NonNullable<FillStyle['fillType']>;
            const p: Partial<FillStyle> = { fillType: t };
            if ((t === 'linear' || t === 'radial')) {
              p.gradient = { ...(draft.gradient ?? defaultGradient(t)), kind: t };
            }
            patch(p);
          }}>
          {FILL_TYPE_LABELS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Row>

      {/* Vista previa */}
      <div className="h-12 rounded" style={{
        border: '1px solid var(--line-2)',
        background: type === 'none'
          ? 'repeating-conic-gradient(#bbb 0% 25%, #fff 0% 50%) 0 0 / 10px 10px'
          : gradCss ?? (draft.colorId || '#ffffff'),
        opacity: type === 'solid' ? (draft.opacity ?? 1) : 1,
      }} />

      {type === 'solid' && (
        <Row label="Color">
          <ColorInput value={draft.colorId || '#ffffff'} onChange={(v) => patch({ colorId: v })} />
        </Row>
      )}

      {isGradient && (
        <>
          {type === 'linear' && (
            <Row label="Ángulo (°)">
              <div className="flex items-center gap-1">
                {([['↑', 0], ['↗', 45], ['→', 90], ['↘', 135], ['↓', 180], ['↙', 225], ['←', 270], ['↖', 315]] as const).map(([sym, deg]) => (
                  <button key={deg} type="button" title={`${deg}°`}
                    onClick={() => setGrad({ angle: deg })}
                    className="w-6 h-6 rounded text-11"
                    style={(grad?.angle ?? 180) === deg
                      ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', color: 'var(--accent)' }
                      : { background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}>
                    {sym}
                  </button>
                ))}
                <input className="field" style={{ width: 52 }} type="number" min={0} max={359}
                  value={grad?.angle ?? 180}
                  onChange={(e) => setGrad({ angle: ((Number(e.target.value) % 360) + 360) % 360 })} />
              </div>
            </Row>
          )}
          {type === 'radial' && (
            <>
              <Row label="Centro X (%)">
                <NumInput value={grad?.cx ?? 50} min={0} max={100} step={1} onChange={(v) => setGrad({ cx: v })} />
              </Row>
              <Row label="Centro Y (%)">
                <NumInput value={grad?.cy ?? 50} min={0} max={100} step={1} onChange={(v) => setGrad({ cy: v })} />
              </Row>
            </>
          )}

          <Divider label="Paradas del degradado" />
          {stops.map((st, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(st.color) ? st.color : '#888888'}
                onChange={(e) => setGrad({ stops: stops.map((s, j) => (j === i ? { ...s, color: e.target.value } : s)) })}
                className="w-7 h-7 cursor-pointer rounded border-0 p-0 bg-transparent shrink-0" />
              <input className="field" style={{ width: 60 }} type="number" min={0} max={100} title="Posición (%)"
                value={st.offset}
                onChange={(e) => setGrad({ stops: stops.map((s, j) => (j === i ? { ...s, offset: Math.max(0, Math.min(100, Number(e.target.value))) } : s)) })} />
              <input className="field" style={{ width: 60 }} type="number" min={0} max={1} step={0.05} title="Opacidad (0–1)"
                value={st.opacity ?? 1}
                onChange={(e) => setGrad({ stops: stops.map((s, j) => (j === i ? { ...s, opacity: Math.max(0, Math.min(1, Number(e.target.value))) } : s)) })} />
              <button type="button" title="Eliminar parada"
                disabled={stops.length <= 2}
                onClick={() => setGrad({ stops: stops.filter((_, j) => j !== i) })}
                className="w-6 h-6 flex items-center justify-center rounded text-red-400 disabled:opacity-30"
                style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)' }}>
                ×
              </button>
            </div>
          ))}
          <button type="button"
            onClick={() => setGrad({ stops: [...stops, { offset: 50, color: '#888888', opacity: 1 }] })}
            className="h-7 rounded text-11"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}>
            + Añadir parada
          </button>
        </>
      )}

      {type !== 'none' && (
        <Row label="Opacidad">
          <div className="flex items-center gap-2">
            <input type="range" min={0} max={1} step={0.01} value={draft.opacity ?? 1}
              onChange={(e) => patch({ opacity: Number(e.target.value) })} className="flex-1" />
            <span className="text-11 w-10 text-right" style={{ color: 'var(--muted)' }}>
              {Math.round((draft.opacity ?? 1) * 100)}%
            </span>
          </div>
        </Row>
      )}
    </>
  );
}

/* ─── Default builders ─── */

function buildDefault(target: StyleEditorTarget): AnyStyleItem {
  if (target.item) return { ...target.item };
  const id = nextId('style');
  switch (target.key) {
    case 'textStyles':
      return { id, name: 'Nuevo estilo de texto', fontSize: 12, fontId: 'Arial', subFont: 'Regular', fillStyleId: '#000000' } satisfies TextStyle;
    case 'paragraphStyles':
      return {
        id, name: 'Nuevo estilo de párrafo',
        leftIndent: 0, rightIndent: 0, firstLineLeftIndent: 0,
        spaceBefore: 0, spaceAfter: 0, lineSpacing: 5,
        widow: 1, orphan: 1, keepWithNext: false,
        keepLinesTogether: 'No', dontWrap: false, hAlign: 'Left',
      } satisfies ParagraphStyle;
    case 'borderStyles':
      return {
        id,
        name: 'Nuevo estilo de borde',
        colorId: '#000000',
        lineWidth: 0.25,
        cap: 'Butt',
        lineDash: 'Solid',
        corner: 'Standard',
        radiusX: 0,
        radiusY: 0,
      } satisfies BorderStyle;
    case 'lineStyles':
      return {
        id,
        name: 'Nuevo estilo de línea',
        width: 0.5,
        cap: 'Butt',
        join: 'Round',
      } satisfies LineStyle;
    case 'fillStyles':
      return { id, name: 'Nuevo relleno', colorId: '#ffffff' } satisfies FillStyle;
  }
}
