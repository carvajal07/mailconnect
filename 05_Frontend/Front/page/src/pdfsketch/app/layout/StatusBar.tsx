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
import { useDocumentStore } from '@/store/documentStore';
import { sizeLabel } from '@/utils/pageSizes';

function Sep() {
  return <div className="w-px h-3.5 bg-line-2 mx-2" />;
}

export default function StatusBar() {
  const zoom = useUIStore((s) => s.zoom);
  const setZoom = useUIStore((s) => s.setZoom);
  const cursor = useUIStore((s) => s.cursor);
  const showGrid = useUIStore((s) => s.showGrid);
  const showSnap = useUIStore((s) => s.showSnap);
  const toggleGrid = useUIStore((s) => s.toggleGrid);
  const toggleSnap = useUIStore((s) => s.toggleSnap);

  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const addPage = useDocumentStore((s) => s.addPage);
  const removePage = useDocumentStore((s) => s.removePage);
  const idx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const page = pages[idx] ?? pages[0];
  const lastSaved = useDocumentStore((s) => s.lastSavedAt);

  const label = page ? sizeLabel(page.size.width, page.size.height) : '—';

  return (
    <div className="h-full bg-bg-1 flex items-center text-11 px-2">
      {/* Zoom */}
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={() => setZoom(zoom - 0.1)}
        aria-label="Reducir zoom"
      >
        <Minus size={12} />
      </button>
      <span className="font-mono w-12 text-center">{Math.round(zoom * 100)} %</span>
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={() => setZoom(zoom + 0.1)}
        aria-label="Aumentar zoom"
      >
        <Plus size={12} />
      </button>

      <Sep />

      {/* Page nav */}
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={() => pages[0] && setCurrentPage(pages[0].id)}
      >
        <SkipBack size={12} />
      </button>
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={() => pages[idx - 1] && setCurrentPage(pages[idx - 1].id)}
      >
        <ChevronLeft size={12} />
      </button>
      <span className="font-mono mx-1">
        {idx + 1} / {pages.length}
      </span>
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={() => pages[idx + 1] && setCurrentPage(pages[idx + 1].id)}
      >
        <ChevronRight size={12} />
      </button>
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={() => pages[pages.length - 1] && setCurrentPage(pages[pages.length - 1].id)}
      >
        <SkipForward size={12} />
      </button>
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 text-ink-2 flex items-center justify-center"
        onClick={addPage}
        aria-label="Nueva hoja"
        title="Nueva hoja"
      >
        <FilePlus size={12} />
      </button>
      <button
        type="button"
        className="w-5 h-5 rounded-3 hover:bg-bg-3 flex items-center justify-center disabled:opacity-30"
        style={{ color: pages.length > 1 ? 'var(--ink-2)' : undefined }}
        onClick={() => pages.length > 1 && removePage(currentPageId)}
        disabled={pages.length <= 1}
        aria-label="Eliminar hoja"
        title="Eliminar hoja"
      >
        <Trash2 size={12} />
      </button>

      <Sep />

      <span className="font-mono text-muted">
        x: {cursor.x.toFixed(2)}mm   y: {cursor.y.toFixed(2)}mm
      </span>

      <Sep />

      <button
        type="button"
        onClick={toggleGrid}
        className="flex items-center gap-1 px-1.5 h-5 rounded-3 hover:bg-bg-3"
        style={showGrid ? { color: 'var(--accent)' } : undefined}
      >
        <Grid3x3 size={12} /> Grid
      </button>
      <button
        type="button"
        onClick={toggleSnap}
        className="flex items-center gap-1 px-1.5 h-5 rounded-3 hover:bg-bg-3"
        style={showSnap ? { color: 'var(--accent)' } : undefined}
      >
        <Magnet size={12} /> Snap
      </button>

      <div className="flex-1" />

      <span className="font-mono text-muted mr-2">
        {label} · {page?.size.width.toFixed(1)}×{page?.size.height.toFixed(1)}mm
      </span>
      <Sep />
      <Circle size={8} style={{ color: 'var(--accent)', fill: 'var(--accent)' }} />
      <span className="ml-1.5 text-ink-2">
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
