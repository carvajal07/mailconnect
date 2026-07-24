import type { ReactNode } from 'react';
import { Minus, Plus, Grid3x3, Magnet, SquareDashed, Circle } from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { DISPLAY_UNITS, formatMmAs } from '@/utils/displayUnits';
import { useDocumentStore } from '@/store/documentStore';

function Sep() {
  return <div className="w-px h-4 bg-line-2 mx-2.5" />;
}

/** Botón "en caja" del estilo de la barra del Diseñador PDF.
 *  ⚠️ El padding va INLINE: el reset `.mc-sketch button { padding: 0 }` tiene
 *  más especificidad que las utilidades `px-*` de Tailwind y las anula. */
function BoxBtn({ onClick, title, active, children }: {
  onClick: () => void; title?: string; active?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-[22px] rounded flex items-center gap-1.5 text-11 whitespace-nowrap"
      style={{
        padding: '0 12px',
        ...(active
          ? { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' }
          : { background: 'var(--bg-1)', color: 'var(--ink-2)', border: '1px solid var(--line)' }),
      }}
    >
      {children}
    </button>
  );
}

/**
 * Barra de estado (SIN la navegación de hojas — esa vive ahora bajo el árbol,
 * en el panel izquierdo). Layout:
 *   X/Y (ancho FIJO) · [tamaño de hoja] · Unidad · Grilla · Snap · Márgenes ·
 *   … · − % + · 1:1 · Ajustar · Ancho · estado de guardado
 */
export default function StatusBar() {
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const cursor = useUIStore((s) => s.cursor);
  const showGrid = useUIStore((s) => s.showGrid);
  const showSnap = useUIStore((s) => s.showSnap);
  const showMargins = useUIStore((s) => s.showMargins);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const toggleSnap = useUIStore((s) => s.toggleSnap);
  const toggleMargins = useUIStore((s) => s.toggleMargins);
  const unit = useUIStore((s) => s.unit);
  const setUnit = useUIStore((s) => s.setUnit);
  const requestFit = useUIStore((s) => s.requestFit);
  const requestFitWidth = useUIStore((s) => s.requestFitWidth);

  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const idx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const page = pages[idx] ?? pages[0];
  const lastSaved = useDocumentStore((s) => s.lastSavedAt);

  return (
    <div className="h-full bg-bg-1 flex items-center text-11 px-3" style={{ color: 'var(--ink-2)' }}>
      {/* ── Posición del cursor (ancho FIJO → no mueve lo demás) ── */}
      <span
        className="font-mono whitespace-nowrap tabular-nums inline-flex items-center"
        style={{ width: 176 }}
        title="Posición del cursor"
      >
        <span style={{ width: 80, display: 'inline-block' }}>
          X: <strong style={{ color: 'var(--ink)' }}>{formatMmAs(cursor.x, unit)}</strong>
        </span>
        <span style={{ width: 80, display: 'inline-block' }}>
          Y: <strong style={{ color: 'var(--ink)' }}>{formatMmAs(cursor.y, unit)}</strong>
        </span>
        <span style={{ color: 'var(--muted)' }}>{unit}</span>
      </span>

      <Sep />

      {/* ── Tamaño de la hoja ── */}
      <span
        className="font-mono px-3 h-[22px] flex items-center rounded whitespace-nowrap"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--accent)' }}
        title="Tamaño de la hoja"
      >
        {page ? `${formatMmAs(page.size.width, unit)} × ${formatMmAs(page.size.height, unit)} ${unit}` : '—'}
      </span>

      <Sep />

      {/* ── Unidad ── */}
      <span className="mr-1.5" style={{ color: 'var(--muted)' }}>Unidad:</span>
      <div className="flex items-center gap-1.5">
        {DISPLAY_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setUnit(u)}
            className="h-[22px] rounded font-mono text-[10px]"
            style={{
              padding: '0 10px', // inline: el reset de botones anula las px-* de Tailwind
              ...(u === unit
                ? { background: 'var(--accent)', color: '#ffffff', fontWeight: 700 }
                : { background: 'var(--bg-1)', color: 'var(--ink-2)', border: '1px solid var(--line)' }),
            }}
            title={`Mostrar medidas en ${u}`}
          >
            {u}
          </button>
        ))}
      </div>

      <Sep />

      {/* ── Grilla / Snap / Márgenes ── */}
      <div className="flex items-center gap-2">
        <BoxBtn onClick={toggleGrid} active={showGrid} title="Mostrar/ocultar la grilla">
          <Grid3x3 size={11} /> Grilla
        </BoxBtn>
        <BoxBtn onClick={toggleSnap} active={showSnap} title="Imantar los elementos a la grilla, márgenes y bordes de la hoja al arrastrar">
          <Magnet size={11} /> Imán
        </BoxBtn>
        <BoxBtn onClick={toggleMargins} active={showMargins} title="Mostrar/ocultar la guía de márgenes">
          <SquareDashed size={11} /> Márgenes
        </BoxBtn>
      </div>

      <div className="flex-1" />

      {/* ── Zoom + ajustes ── */}
      <div className="flex items-center gap-2">
        <BoxBtn onClick={() => setZoom(zoom - 0.1)} title="Reducir zoom"><Minus size={11} /></BoxBtn>
        <span className="font-mono w-11 text-center tabular-nums" style={{ color: 'var(--ink)' }}>
          {Math.round(zoom * 100)}%
        </span>
        <BoxBtn onClick={() => setZoom(zoom + 0.1)} title="Aumentar zoom"><Plus size={11} /></BoxBtn>
        <BoxBtn onClick={() => setZoom(1)} title="Zoom real (100%)">1:1</BoxBtn>
        <BoxBtn onClick={requestFit} title="Ajustar la hoja a la ventana">Ajustar</BoxBtn>
        <BoxBtn onClick={requestFitWidth} title="Ajustar al ancho de la hoja">Ancho</BoxBtn>
      </div>

      <Sep />

      <span className="inline-flex items-center whitespace-nowrap">
        <Circle size={8} style={{ color: 'var(--accent)', fill: lastSaved ? 'var(--accent)' : 'transparent' }} />
        <span className="ml-1.5">{lastSaved ? `guardado ${timeAgo(lastSaved)}` : 'sin guardar'}</span>
      </span>
    </div>
  );
}

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m}m`;
  return `hace ${Math.round(m / 60)}h`;
}
