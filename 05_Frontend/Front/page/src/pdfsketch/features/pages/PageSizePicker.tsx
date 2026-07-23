import { useDocumentStore } from '@/store/documentStore';
import { PAGE_SIZES, findPreset } from '@/utils/pageSizes';

/**
 * Selector de tamaño de hoja para la página actual.
 * - Presets (A4, Letter, Legal, A3, A5, Tabloid, etc.)
 * - "Personalizado" muestra dos inputs width/height en mm.
 */
export default function PageSizePicker() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const updatePage = useDocumentStore((s) => s.updatePage);
  const page = pages.find((p) => p.id === currentPageId) ?? pages[0];

  if (!page) return null;
  const preset = findPreset(page.size.width, page.size.height);

  function applySize(w: number, h: number) {
    updatePage(page!.id, { size: { ...page!.size, width: w, height: h } });
  }

  return (
    <div className="flex flex-col gap-2 text-11">
      <div className="flex items-center gap-2">
        <label className="text-ink-2 w-16">Tamaño</label>
        <select
          className="h-[22px] bg-bg-3 border border-line-2 rounded-3 text-11 px-1.5 outline-none flex-1"
          value={preset?.id ?? 'custom'}
          onChange={(e) => {
            const id = e.target.value;
            if (id === 'custom') return;
            const p = PAGE_SIZES.find((x) => x.id === id);
            if (p) applySize(p.width, p.height);
          }}
        >
          {PAGE_SIZES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.width}×{p.height}mm
            </option>
          ))}
          <option value="custom">Personalizado…</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-ink-2 w-16">Ancho</label>
        <NumberMm value={page.size.width} onChange={(v) => applySize(v, page.size.height)} />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-ink-2 w-16">Alto</label>
        <NumberMm value={page.size.height} onChange={(v) => applySize(page.size.width, v)} />
      </div>
    </div>
  );
}

function NumberMm({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1">
      <input
        type="number"
        step={0.1}
        min={1}
        className="bg-transparent w-full text-right font-mono text-11 outline-none"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isNaN(v) && v > 0) onChange(v);
        }}
      />
      <span className="text-muted text-11 ml-1">mm</span>
    </div>
  );
}
