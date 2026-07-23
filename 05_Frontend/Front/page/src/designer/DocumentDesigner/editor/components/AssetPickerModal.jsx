// AssetPickerModal.jsx — selector de assets de la biblioteca del backend.
// Desacoplado del SaaS: recibe la función `list({kind,q}) => Promise<AssetView[]>`
// por props (la inyecta el wrapper de templates vía DesignerAssetsContext).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export default function AssetPickerModal({ open, kind, list, onClose, onPick }) {
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open || !list) return undefined;
    let active = true;
    (async () => {
      try {
        const res = await list({ kind, q });
        if (active) { setItems(res ?? []); setLoaded(true); }
      } catch {
        if (active) { setItems([]); setLoaded(true); }
      }
    })();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, q]);

  if (!open) return null;

  return createPortal(
    <div style={{ zIndex: 10000 }} className="fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 text-sm">Elegir de la biblioteca</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-4 py-2 border-b border-slate-200">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
            className="w-full border border-slate-300 rounded px-3 py-1.5 text-sm" />
        </div>
        <div className="p-3 overflow-auto">
          {!loaded && <div className="text-slate-500 text-sm">Cargando…</div>}
          {loaded && items.length === 0 && (
            <div className="text-slate-400 text-sm py-6 text-center">No hay assets de este tipo. Súbelos en la sección Assets.</div>
          )}
          <div className="grid grid-cols-4 gap-3">
            {items.map((a) => (
              <button key={a.id} onClick={() => { onPick(a); onClose(); }}
                className="border border-slate-200 rounded p-1 hover:border-blue-400 text-left">
                <div className="h-20 bg-slate-50 flex items-center justify-center overflow-hidden">
                  {kind === 'image'
                    ? <img src={a.url} alt={a.name} className="max-h-full max-w-full object-contain" />
                    : <span className="text-[10px] text-slate-400 px-1 truncate">{a.name}</span>}
                </div>
                <div className="text-xs truncate mt-1" title={a.name}>{a.name}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
