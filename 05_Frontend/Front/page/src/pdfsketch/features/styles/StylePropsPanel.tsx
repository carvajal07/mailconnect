import { useUIStore } from '@/store/uiStore';
import { useDocumentStore, type StyleKey } from '@/store/documentStore';
import type {
  BorderStyle, FillStyle, LineDashStyle, LineStyle, ParagraphStyle, TextStyle,
} from '@/types/document';

/**
 * PROPIEDADES del estilo/color enfocado (uiStore.styleTarget) — se muestra en
 * la sección de abajo del panel izquierdo (tabs Capas y Estilos). Edita EN VIVO
 * vía updateStyle/updateColor (los elementos vinculados se actualizan solos).
 */
export default function StylePropsPanel() {
  const target = useUIStore((s) => s.styleTarget);
  const doc = useDocumentStore((s) => s.doc);
  const updateStyle = useDocumentStore((s) => s.updateStyle);
  const updateColor = useDocumentStore((s) => s.updateColor);

  if (!target) {
    return (
      <div className="px-3 py-3 text-[10px]" style={{ color: 'var(--muted)' }}>
        Selecciona un estilo o un color para editar sus propiedades aquí.
      </div>
    );
  }

  if (target.kind === 'color') {
    const c = doc.assets.colors.find((x) => x.id === target.id);
    if (!c) return <Missing />;
    return (
      <div className="px-3 py-2 flex flex-col gap-2">
        <Field label="Nombre">
          <input className="field" value={c.name}
            onChange={(e) => updateColor(c.id, { name: e.target.value })} />
        </Field>
        <Field label="Color">
          <div className="flex items-center gap-2">
            <input type="color" value={c.rgb}
              onChange={(e) => updateColor(c.id, { rgb: e.target.value })}
              className="w-7 h-7 cursor-pointer rounded border-0 p-0 bg-transparent" />
            <input className="field" style={{ width: 90 }} value={c.rgb}
              onChange={(e) => { if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) updateColor(c.id, { rgb: e.target.value }); }} />
          </div>
        </Field>
      </div>
    );
  }

  const key = target.kind as StyleKey;
  const item = (doc.assets[key] as { id: string }[]).find((x) => x.id === target.id);
  if (!item) return <Missing />;

  const up = (patch: Record<string, unknown>) => updateStyle(key, target.id, patch);

  return (
    <div className="px-3 py-2 flex flex-col gap-2">
      <Field label="Nombre">
        <input className="field" value={(item as { name?: string }).name ?? ''}
          onChange={(e) => up({ name: e.target.value })} />
      </Field>

      {key === 'textStyles' && (() => {
        const s = item as TextStyle;
        return (
          <>
            <Field label="Tamaño (pt)">
              <input className="field" type="number" min={1} step={0.5} value={s.fontSize}
                onChange={(e) => up({ fontSize: Number(e.target.value) || s.fontSize })} />
            </Field>
            <Field label="Fuente">
              <input className="field" value={s.fontId}
                onChange={(e) => up({ fontId: e.target.value })} />
            </Field>
            <Field label="Variante">
              <select className="field" value={s.subFont}
                onChange={(e) => up({ subFont: e.target.value })}>
                {['Regular', 'Bold', 'Italic', 'BoldItalic'].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Color">
              <ColorInput value={s.fillStyleId || '#000000'} onChange={(v) => up({ fillStyleId: v })} />
            </Field>
          </>
        );
      })()}

      {key === 'paragraphStyles' && (() => {
        const s = item as ParagraphStyle;
        return (
          <>
            <Field label="Alineación">
              <select className="field" value={s.hAlign}
                onChange={(e) => up({ hAlign: e.target.value })}>
                {(['Left', 'Center', 'Right', 'Justify'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Interlineado">
              <input className="field" type="number" min={0.5} step={0.1} value={s.lineSpacing}
                onChange={(e) => up({ lineSpacing: Number(e.target.value) || s.lineSpacing })} />
            </Field>
          </>
        );
      })()}

      {key === 'borderStyles' && (() => {
        const s = item as BorderStyle;
        return (
          <>
            <Field label="Color">
              <ColorInput value={s.colorId || '#000000'} onChange={(v) => up({ colorId: v })} />
            </Field>
            <Field label="Grosor (mm)">
              <input className="field" type="number" min={0.05} step={0.05} value={s.lineWidth}
                onChange={(e) => up({ lineWidth: Number(e.target.value) || s.lineWidth })} />
            </Field>
            <Field label="Trazo">
              <select className="field" value={s.lineDash ?? 'Solid'}
                onChange={(e) => up({ lineDash: e.target.value as LineDashStyle })}>
                {(['Solid', 'Dashed', 'Dotted', 'DashDot'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Esquina">
              <div className="flex items-center gap-2">
                <select className="field" style={{ width: 110 }} value={s.corner ?? 'Standard'}
                  onChange={(e) => up({ corner: e.target.value })}>
                  {(['Standard', 'Round', 'Bevel'] as const).map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                {s.corner === 'Round' && (
                  <input className="field" style={{ width: 64 }} type="number" min={0} step={0.5}
                    value={s.radiusX} title="Radio (mm)"
                    onChange={(e) => up({ radiusX: Number(e.target.value) || 0 })} />
                )}
              </div>
            </Field>
          </>
        );
      })()}

      {key === 'lineStyles' && (() => {
        const s = item as LineStyle;
        const dashKind = !s.dash?.length ? 'solid' : s.dash[0] <= 2 ? 'dotted' : 'dashed';
        return (
          <>
            <Field label="Color">
              <ColorInput value={s.colorId || '#000000'} onChange={(v) => up({ colorId: v })} />
            </Field>
            <Field label="Grosor (mm)">
              <input className="field" type="number" min={0.05} step={0.05} value={s.width}
                onChange={(e) => up({ width: Number(e.target.value) || s.width })} />
            </Field>
            <Field label="Trazo">
              <select className="field" value={dashKind}
                onChange={(e) => up({
                  dash: e.target.value === 'solid' ? undefined
                    : e.target.value === 'dotted' ? [1, 2] : [4, 2],
                })}>
                <option value="solid">Sólido</option>
                <option value="dashed">Guiones</option>
                <option value="dotted">Punteado</option>
              </select>
            </Field>
          </>
        );
      })()}

      {key === 'fillStyles' && (() => {
        const s = item as FillStyle;
        return (
          <Field label="Color">
            <ColorInput value={s.colorId || '#000000'} onChange={(v) => up({ colorId: v })} />
          </Field>
        );
      })()}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </label>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={safe} onChange={(e) => onChange(e.target.value)}
        className="w-7 h-7 cursor-pointer rounded border-0 p-0 bg-transparent" />
      <input className="field" style={{ width: 90 }} value={value}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Missing() {
  return (
    <div className="px-3 py-3 text-[10px]" style={{ color: 'var(--muted)' }}>
      El estilo seleccionado ya no existe.
    </div>
  );
}
