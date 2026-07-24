import { useUIStore } from '@/store/uiStore';
import { useDocumentStore, type StyleKey, type AnyStyleItem } from '@/store/documentStore';
import type {
  BorderStyle, FillStyle, LineStyle, ParagraphStyle, TextStyle,
} from '@/types/document';
import {
  Row, NumInput,
  TextStyleFields, ParagraphStyleFields, BorderStyleFields, LineStyleFields, FillStyleFields,
} from './StyleEditorModal';

/**
 * PROPIEDADES del estilo/color enfocado (uiStore.styleTarget) — se muestra en
 * la sección de abajo del panel izquierdo (tabs Capas y Estilos). Edita EN VIVO
 * vía updateStyle/updateColor (los elementos vinculados se actualizan solos).
 *
 * Reutiliza los MISMOS editores de campos del modal (StyleEditorModal) para que
 * en Propiedades aparezcan TODAS las configuraciones de cada recurso (traídas del
 * Diseñador PDF): texto (fuente/variante/tamaño/color), párrafo (alineación,
 * sangrías, espaciado, flujo: viudas/huérfanas/mantener con la siguiente/no
 * ajustar), borde (partes/diagonales, esquinas, sombreado), línea (cap/join/
 * patrón) y relleno. Colores: HTML (hex) + RGB + CMYK.
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
        <Row label="Nombre">
          <input className="field" value={c.name}
            onChange={(e) => updateColor(c.id, { name: e.target.value })} />
        </Row>
        <ColorFields rgb={c.rgb} onChange={(rgb) => updateColor(c.id, { rgb })} />
      </div>
    );
  }

  const key = target.kind as StyleKey;
  const item = (doc.assets[key] as { id: string }[]).find((x) => x.id === target.id);
  if (!item) return <Missing />;

  const up = (patch: Partial<AnyStyleItem>) => updateStyle(key, target.id, patch);

  return (
    <div className="px-3 py-2 flex flex-col gap-2">
      <Row label="Nombre">
        <input className="field" value={(item as { name?: string }).name ?? ''}
          onChange={(e) => up({ name: e.target.value })} />
      </Row>

      {key === 'textStyles' && (
        <TextStyleFields draft={item as TextStyle} patch={up} />
      )}
      {key === 'paragraphStyles' && (
        <ParagraphStyleFields draft={item as ParagraphStyle} patch={up} />
      )}
      {key === 'borderStyles' && (
        <BorderStyleFields draft={item as BorderStyle} patch={up} />
      )}
      {key === 'lineStyles' && (
        <LineStyleFields draft={item as LineStyle} patch={up} />
      )}
      {key === 'fillStyles' && (
        <FillStyleFields draft={item as FillStyle} patch={up} />
      )}
    </div>
  );
}

/* ─── Editor de color: HTML (hex) + RGB + CMYK ─── */

function ColorFields({ rgb, onChange }: { rgb: string; onChange: (hex: string) => void }) {
  const { r, g, b } = hexToRgb(rgb);
  const { c, m, y, k } = rgbToCmyk(r, g, b);
  const safe = /^#[0-9a-fA-F]{6}$/.test(rgb) ? rgb : '#000000';

  const setRgb = (nr: number, ng: number, nb: number) => onChange(rgbToHex(nr, ng, nb));
  const setCmyk = (nc: number, nm: number, ny: number, nk: number) => {
    const rr = cmykToRgb(nc, nm, ny, nk);
    onChange(rgbToHex(rr.r, rr.g, rr.b));
  };

  return (
    <>
      {/* Vista previa grande */}
      <div className="h-14 rounded flex items-end justify-end p-2"
        style={{ background: safe, border: '1px solid var(--line-2)' }}>
        <span className="text-[10px] font-mono px-1 rounded"
          style={{ background: 'rgba(0,0,0,0.35)', color: '#fff' }}>{safe}</span>
      </div>

      <Row label="HTML (hex)">
        <div className="flex items-center gap-2">
          <input type="color" value={safe}
            onChange={(e) => onChange(e.target.value)}
            className="w-7 h-7 cursor-pointer rounded border-0 p-0 bg-transparent" />
          <input className="field" style={{ width: 100 }} value={rgb}
            onChange={(e) => { const v = e.target.value; if (/^#?[0-9a-fA-F]{0,6}$/.test(v)) onChange(v.startsWith('#') ? v : `#${v}`); }} />
        </div>
      </Row>

      <div className="text-[10px] font-semibold pt-1" style={{ color: 'var(--muted)' }}>RGB</div>
      <Row label="Rojo (R)">
        <NumInput value={r} min={0} max={255} step={1} onChange={(v) => setRgb(clamp(v, 0, 255), g, b)} />
      </Row>
      <Row label="Verde (G)">
        <NumInput value={g} min={0} max={255} step={1} onChange={(v) => setRgb(r, clamp(v, 0, 255), b)} />
      </Row>
      <Row label="Azul (B)">
        <NumInput value={b} min={0} max={255} step={1} onChange={(v) => setRgb(r, g, clamp(v, 0, 255))} />
      </Row>

      <div className="text-[10px] font-semibold pt-1" style={{ color: 'var(--muted)' }}>CMYK (%)</div>
      <Row label="Cian (C)">
        <NumInput value={c} min={0} max={100} step={1} onChange={(v) => setCmyk(clamp(v, 0, 100), m, y, k)} />
      </Row>
      <Row label="Magenta (M)">
        <NumInput value={m} min={0} max={100} step={1} onChange={(v) => setCmyk(c, clamp(v, 0, 100), y, k)} />
      </Row>
      <Row label="Amarillo (Y)">
        <NumInput value={y} min={0} max={100} step={1} onChange={(v) => setCmyk(c, m, clamp(v, 0, 100), k)} />
      </Row>
      <Row label="Negro (K)">
        <NumInput value={k} min={0} max={100} step={1} onChange={(v) => setCmyk(c, m, y, clamp(v, 0, 100))} />
      </Row>
    </>
  );
}

/* ─── Conversiones de color ─── */

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!h) return { r: 0, g: 0, b: 0 };
  const n = parseInt(h[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = clamp(r, 0, 255) * 65536 + clamp(g, 0, 255) * 256 + clamp(b, 0, 255);
  return `#${c.toString(16).padStart(6, '0')}`;
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  return { c: Math.round(c * 100), m: Math.round(m * 100), y: Math.round(y * 100), k: Math.round(k * 100) };
}

function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  const cc = c / 100, mm = m / 100, yy = y / 100, kk = k / 100;
  return {
    r: Math.round(255 * (1 - cc) * (1 - kk)),
    g: Math.round(255 * (1 - mm) * (1 - kk)),
    b: Math.round(255 * (1 - yy) * (1 - kk)),
  };
}

function Missing() {
  return (
    <div className="px-3 py-3 text-[10px]" style={{ color: 'var(--muted)' }}>
      El estilo seleccionado ya no existe.
    </div>
  );
}
