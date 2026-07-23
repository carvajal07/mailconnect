import { SkipBack, SkipForward, ChevronLeft, ChevronRight, FilePlus, Trash2 } from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';

/**
 * Controles de HOJAS (antes vivían en la barra de estado). Se muestran bajo el
 * árbol de capas: navegación (primera/anterior/siguiente/última), contador y
 * agregar/eliminar hoja.
 */
export default function PagesStrip() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const addPage = useDocumentStore((s) => s.addPage);
  const removePage = useDocumentStore((s) => s.removePage);

  const idx = Math.max(0, pages.findIndex((p) => p.id === currentPageId));

  const iconBtn =
    'w-6 h-6 rounded flex items-center justify-center hover:bg-bg-3 disabled:opacity-30 disabled:pointer-events-none';

  return (
    <div
      className="shrink-0 flex items-center gap-0.5 px-2 h-9"
      style={{ borderTop: '1px solid var(--line-2)', background: 'var(--bg-1)', color: 'var(--ink-2)' }}
    >
      <span className="text-11 font-semibold mr-1" style={{ color: 'var(--ink)' }}>Hojas</span>

      <button type="button" className={iconBtn} title="Primera hoja"
        disabled={idx <= 0}
        onClick={() => pages[0] && setCurrentPage(pages[0].id)}>
        <SkipBack size={12} />
      </button>
      <button type="button" className={iconBtn} title="Hoja anterior"
        disabled={idx <= 0}
        onClick={() => pages[idx - 1] && setCurrentPage(pages[idx - 1].id)}>
        <ChevronLeft size={12} />
      </button>

      <span className="font-mono text-11 mx-1 tabular-nums" style={{ color: 'var(--ink)' }}>
        {idx + 1}/{pages.length}
      </span>

      <button type="button" className={iconBtn} title="Hoja siguiente"
        disabled={idx >= pages.length - 1}
        onClick={() => pages[idx + 1] && setCurrentPage(pages[idx + 1].id)}>
        <ChevronRight size={12} />
      </button>
      <button type="button" className={iconBtn} title="Última hoja"
        disabled={idx >= pages.length - 1}
        onClick={() => pages[pages.length - 1] && setCurrentPage(pages[pages.length - 1].id)}>
        <SkipForward size={12} />
      </button>

      <div className="flex-1" />

      <button type="button" className={iconBtn} title="Nueva hoja" onClick={addPage}>
        <FilePlus size={12} />
      </button>
      <button type="button" className={iconBtn} title="Eliminar hoja"
        disabled={pages.length <= 1}
        onClick={() => pages.length > 1 && removePage(currentPageId)}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}
