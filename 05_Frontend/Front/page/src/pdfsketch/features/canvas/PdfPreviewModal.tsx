import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Layer, Stage } from 'react-konva';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import Sheet from './Sheet';
import ElementsLayer from './ElementsLayer';
import { useDocumentStore } from '@/store/documentStore';
import { useUIStore } from '@/store/uiStore';
import { MM_TO_PX } from '@/utils/units';

const PADDING = 56; // px de margen alrededor de la página en el modal

/**
 * Modal de vista previa limpia del PDF.
 * - Sin reglas, sin guías de bounding-box, sin selección ni herramientas.
 * - Escala la página para que quepa en la ventana disponible.
 * - Navegación entre páginas con flechas y teclado.
 * - Se cierra con Escape o el botón ×.
 */
export default function PdfPreviewModal() {
  const previewOpen = useUIStore((s) => s.previewOpen);
  const setPreviewOpen = useUIStore((s) => s.setPreviewOpen);
  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  const initialIdx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));
  const [pageIdx, setPageIdx] = useState(initialIdx);

  // Sincroniza el índice al abrir
  useEffect(() => {
    if (previewOpen) {
      setPageIdx(Math.max(0, pages.findIndex((p) => p.id === currentPageId)));
    }
  }, [previewOpen, currentPageId, pages]);

  // Teclado: Escape cierra, ←/→ navegan páginas
  useEffect(() => {
    if (!previewOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewOpen(false);
      if (e.key === 'ArrowLeft') setPageIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setPageIdx((i) => Math.min(pages.length - 1, i + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewOpen, pages.length, setPreviewOpen]);

  if (!previewOpen) return null;

  const page = pages[pageIdx] ?? pages[0];

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ background: 'rgba(10,10,12,0.88)', backdropFilter: 'blur(6px)' }}
    >
      {/* ── Barra superior ── */}
      <div
        className="h-12 shrink-0 flex items-center px-4 gap-3"
        style={{ background: 'rgba(20,20,24,0.95)', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
      >
        <span className="text-white font-semibold text-sm">Vista previa PDF</span>

        <div className="flex-1" />

        {/* Navegación de páginas */}
        <div className="flex items-center gap-1">
          <NavBtn
            disabled={pageIdx === 0}
            onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
            label="Página anterior"
          >
            <ChevronLeft size={16} />
          </NavBtn>
          <span className="text-white/60 text-sm font-mono w-20 text-center">
            {pageIdx + 1} / {pages.length}
          </span>
          <NavBtn
            disabled={pageIdx === pages.length - 1}
            onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
            label="Página siguiente"
          >
            <ChevronRight size={16} />
          </NavBtn>
        </div>

        <div className="flex-1" />

        <span className="text-white/40 text-xs mr-2">Esc para cerrar</span>
        <button
          type="button"
          aria-label="Cerrar vista previa"
          onClick={() => setPreviewOpen(false)}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-white/10 text-white/70 hover:text-white transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Área de preview ── */}
      <div className="flex-1 overflow-hidden flex items-center justify-center p-14">
        <PreviewStage page={page} padding={PADDING} />
      </div>

      {/* ── Pie: nombre de página ── */}
      <div className="h-8 shrink-0 flex items-center justify-center">
        <span className="text-white/40 text-xs">{page.name}</span>
      </div>
    </div>
  );
}

/* ─── Sub-componente: Stage escalado ─── */

function PreviewStage({ page, padding }: { page: ReturnType<typeof useDocumentStore.getState>['doc']['pages'][0]; padding: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const availW = size.w - padding * 2;
  const availH = size.h - padding * 2;
  const pageNativeW = page.size.width * MM_TO_PX;
  const pageNativeH = page.size.height * MM_TO_PX;
  const zoom = Math.min(availW / pageNativeW, availH / pageNativeH, 2);

  const pageW = pageNativeW * zoom;
  const pageH = pageNativeH * zoom;
  const offsetX = (size.w - pageW) / 2;
  const offsetY = (size.h - pageH) / 2;

  return (
    <div ref={containerRef} className="w-full h-full">
      <Stage width={size.w} height={size.h}>
        <Layer>
          <Sheet page={page} zoom={zoom} offsetX={offsetX} offsetY={offsetY} />
          <ElementsLayer
            page={page}
            zoom={zoom}
            offsetX={offsetX}
            offsetY={offsetY}
            preview
          />
        </Layer>
      </Stage>
    </div>
  );
}

/* ─── Botón de navegación ─── */

function NavBtn({
  children, disabled, onClick, label,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 rounded-full flex items-center justify-center disabled:opacity-25 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
    >
      {children}
    </button>
  );
}
