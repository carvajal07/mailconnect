import PageSizePicker from '@/features/pages/PageSizePicker';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import ElementProps from './ElementProps';

/**
 * Inspector contextual:
 *  - Sin selección: propiedades de la página (tamaño, fondo, márgenes)
 *  - Con selección: propiedades del/los elemento(s) seleccionado(s)
 *    divididas en secciones (posición, apariencia específica, estado)
 */
export default function Inspector() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const updatePage = useDocumentStore((s) => s.updatePage);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  const page = pages.find((p) => p.id === currentPageId) ?? pages[0];
  const hasSelection = selectedIds.length > 0;

  return (
    <div className="p-3 text-11 flex flex-col gap-2 overflow-auto">

      {/* ── Cabecera contextual ── */}
      <div className="flex items-center gap-1.5 min-h-[18px]">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: 'var(--accent)' }}
        />
        <span className="text-ink truncate">
          {hasSelection
            ? selectedIds.length === 1
              ? 'Elemento seleccionado'
              : `${selectedIds.length} elementos seleccionados`
            : (page?.name ?? 'Página')}
        </span>
      </div>

      {/* ── Sin selección: propiedades de página ── */}
      {!hasSelection && page && (
        <>
          <Section title="Tamaño de hoja">
            <PageSizePicker />
          </Section>

          <Section title="Fondo">
            <div className="flex items-center gap-2">
              <span className="text-ink-2 text-[10px] w-[52px] text-right shrink-0">Color</span>
              <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1 gap-1.5">
                <div className="relative w-5 h-4 rounded shrink-0 overflow-hidden border border-line-2">
                  <div className="absolute inset-0" style={{ background: page.background }} />
                  <input
                    type="color"
                    value={page.background}
                    onChange={(e) => updatePage(page.id, { background: e.target.value })}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </div>
                <input
                  type="text"
                  value={page.background}
                  onChange={(e) => updatePage(page.id, { background: e.target.value })}
                  className="bg-transparent flex-1 font-mono text-11 outline-none min-w-0"
                />
              </div>
            </div>
          </Section>

          <Section title="Márgenes">
            <div className="grid grid-cols-2 gap-x-2 gap-y-2">
              {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
                <div key={side} className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted leading-none">{MARGIN_LABELS[side]}</span>
                  <div
                    className="h-[26px] flex items-center rounded-3 px-2 gap-1 border"
                    style={{ background: 'var(--bg-2)', borderColor: 'var(--line-2)' }}
                  >
                    <input
                      type="number"
                      step={0.5}
                      min={0}
                      value={page.margin[side]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v >= 0)
                          updatePage(page.id, { margin: { ...page.margin, [side]: v } });
                      }}
                      className="bg-transparent flex-1 font-mono text-11 outline-none min-w-0"
                      style={{ color: 'var(--ink)' }}
                    />
                    <span className="text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>mm</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {/* ── Con selección: propiedades contextuales del elemento ── */}
      {hasSelection && <ElementProps />}
    </div>
  );
}

const MARGIN_LABELS = { top: 'Arriba', right: 'Der.', bottom: 'Abajo', left: 'Izq.' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted border-b border-line-2 pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}
