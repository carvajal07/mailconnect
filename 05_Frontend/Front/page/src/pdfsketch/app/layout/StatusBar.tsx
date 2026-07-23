import type { ReactNode } from 'react';
import {
  Minus,
  Plus,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  Magnet,
  Circle,
  FilePlus,
  Trash2,
} from 'lucide-react';
import { useUIStore } from '@/store/uiStore';
import { DISPLAY_UNITS, formatMmAs } from '@/utils/displayUnits';
import { useDocumentStore } from '@/store/documentStore';

function Sep() {
  return <div className="w-px h-4 bg-line-2 mx-2" />;
}

/** Botón "en caja" del estilo de la barra del Diseñador PDF. */
function BoxBtn({ onClick, title, active, children }: {
  onClick: () => void; title?: string; active?: boolean; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="h-[22px] px-2 rounded flex items-center gap-1 text-11"
      style={active
        ? { background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent)' }
        : { background: 'var(--bg-1)', color: 'var(--ink-2)', border: '1px solid var(--line)' }}
    >
      {children}
    </button>
  );
}

/**
 * Barra de estado con el layout de la del Diseñador PDF:
 * X/Y · [tamaño de hoja] · Unidad: mm cm pt px in · Grilla · − % + · 1:1 ·
 * Ajustar · Ancho (+ navegación de páginas y estado de guardado propios del sketch).
 */
export default function StatusBar() {
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const cursor = useUIStore((s) => s.cursor);
  const showGrid = useUIStore((s) => s.showGrid);
  const showSnap = useUIStore((s) => s.showSnap);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const toggleSnap = useUIStore((s) => s.toggleSnap);
  const unit = useUIStore((s) => s.unit);
  const setUnit = useUIStore((s) => s.setUnit);
  const requestFit = useUIStore((s) => s.requestFit);
  const requestFitWidth = useUIStore((s) => s.requestFitWidth);

  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const addPage = useDocumentStore((s) => s.addPage);
  const removePage = useDocumentStore((s) => s.removePage);
  const idx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const page = pages[idx] ?? pages[0];
  const lastSaved = useDocumentStore((s) => s.lastSavedAt);

  return (
    <div className="h-full bg-bg-1 flex items-center text-11 px-2" style={{ color: 'var(--ink-2)' }}>
      {/* ── Navegación de páginas (propia del sketch) ── */}
      <button type="button" className="w-5 h-5 rounded hover:bg-bg-3 flex items-center justify-center"
        onClick={() => pages[0] && setCurrentPage(pages[0].id)} title="Primera hoja">
        <SkipBack size={11} />
      </button>
      <button type="button" className="w-5 h-5 rounded hover:bg-bg-3 flex items-center justify-center"
        onClick={() => pages[idx - 1] && setCurrentPage(pages[idx - 1].id)} title="Hoja anterior">
        <ChevronLeft size={11} />
      </button>
      <span className="font-mono mx-1">{idx + 1}/{pages.length}</span>
      <button type="button" className="w-5 h-5 rounded hover:bg-bg-3 flex items-center justify-center"
        onClick={() => pages[idx + 1] && setCurrentPage(pages[idx + 1].id)} title="Hoja siguiente">
        <ChevronRight size={11} />
      </button>
      <button type="button" className="w-5 h-5 rounded hover:bg-bg-3 flex items-center justify-center"
        onClick={() => pages[pages.length - 1] && setCurrentPage(pages[pages.length - 1].id)} title="Última hoja">
        <SkipForward size={11} />
      </button>
      <button type="button" className="w-5 h-5 rounded hover:bg-bg-3 flex items-center justify-center"
        onClick={addPage} title="Nueva hoja">
        <FilePlus size={11} />
      </button>
      <button type="button"
        className="w-5 h-5 rounded hover:bg-bg-3 flex items-center justify-center disabled:opacity-30"
        onClick={() => pages.length > 1 && removePage(currentPageId)}
        disabled={pages.length <= 1} title="Eliminar hoja">
        <Trash2 size={11} />
      </button>

      <Sep />

      {/* ── Posición del cursor ── */}
      <span className="font-mono whitespace-nowrap">
        X: <strong style={{ color: 'var(--ink)' }}>{formatMmAs(cursor.x, unit)}</strong>{' '}
        Y: <strong style={{ color: 'var(--ink)' }}>{formatMmAs(cursor.y, unit)}</strong> {unit}
      </span>

      <Sep />

      {/* ── Tamaño de la hoja (chip en caja) ── */}
      <span
        className="font-mono px-2 h-[22px] flex items-center rounded whitespace-nowrap"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--accent)' }}
        title="Tamaño de la hoja"
      >
        {page ? `${formatMmAs(page.size.width, unit)} × ${formatMmAs(page.size.height, unit)} ${unit}` : '—'}
      </span>

      <Sep />

      {/* ── Unidad ── */}
      <span className="mr-1" style={{ color: 'var(--muted)' }}>Unidad:</span>
      <div className="flex items-center gap-1">
        {DISPLAY_UNITS.map((u) => (
          <button
            key={u}
            type="button"
            onClick={() => setUnit(u)}
            className="h-[20px] px-1.5 rounded font-mono text-[10px]"
            style={u === unit
              ? { background: 'var(--accent)', color: '#ffffff', fontWeight: 700 }
              : { background: 'var(--bg-1)', color: 'var(--ink-2)', border: '1px solid var(--line)' }}
            title={`Mostrar medidas en ${u}`}
          >
            {u}
          </button>
        ))}
      </div>

      <Sep />

      {/* ── Grilla / Snap ── */}
      <BoxBtn onClick={toggleGrid} active={showGrid} title="Mostrar/ocultar la grilla">
        <Grid3x3 size={11} /> Grilla
      </BoxBtn>
      <span className="mx-0.5" />
      <BoxBtn onClick={toggleSnap} active={showSnap} title="Imantar a la grilla/guías">
        <Magnet size={11} /> Snap
      </BoxBtn>

      <div className="flex-1" />

      {/* ── Zoom + ajustes ── */}
      <BoxBtn onClick={() => setZoom(zoom - 0.1)} title="Reducir zoom"><Minus size={11} /></BoxBtn>
      <span className="font-mono w-11 text-center" style={{ color: 'var(--ink)' }}>
        {Math.round(zoom * 100)}%
      </span>
      <BoxBtn onClick={() => setZoom(zoom + 0.1)} title="Aumentar zoom"><Plus size={11} /></BoxBtn>
      <span className="mx-0.5" />
      <BoxBtn onClick={() => setZoom(1)} title="Zoom real (100%)">1:1</BoxBtn>
      <span className="mx-0.5" />
      <BoxBtn onClick={requestFit} title="Ajustar la hoja a la ventana">Ajustar</BoxBtn>
      <span className="mx-0.5" />
      <BoxBtn onClick={requestFitWidth} title="Ajustar al ancho de la hoja">Ancho</BoxBtn>

      <Sep />

      <Circle size={8} style={{ color: 'var(--accent)', fill: lastSaved ? 'var(--accent)' : 'transparent' }} />
      <span className="ml-1.5 whitespace-nowrap">
        {lastSaved ? `guardado ${timeAgo(lastSaved)}` : 'sin guardar'}
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
