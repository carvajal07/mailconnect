// engine/tableStylePresetBuild.js — turn a "quick template" preset into a real,
// named Table Style resource with the whole chain atado:
//   tableStyle → borderStyle(s) → fillStyle(s) → color(s).
//
// Each preset (TABLE_STYLE_PRESETS) describes lines (none/exterior/all) + region
// fills (header / odd / even). We materialize border styles for each region
// (lines + optional fill) and a Table Style that references them, so the new
// style shows up in Recursos > Table Styles and is fully editable/linked.

import { createTableStyle, createDefaultBorderStyle, genId } from './elementFactory.js';
import { ensureFillStyleId } from './tableResourceLink.js';
import { TABLE_STYLE_PRESETS } from './tableStyleUtils.js';

// Build one border style resource (lines + optional fill), appended to the
// template. Returns { t, id }. `allSides` decides whether the 4 sides draw
// (grid) or not (fill-only). Colors go through the fill-style chain (atado).
function makeBorderStyleResource(t, { name, allSides, fillHex, lineHex = '#000000', lineWidth = 0.25 }) {
  let tt = t;
  let fillFillStyleId = null;
  if (fillHex) { const r = ensureFillStyleId(tt, fillHex); tt = r.t; fillFillStyleId = r.fillStyleId; }
  let lineFillStyleId = null;
  if (allSides) { const r = ensureFillStyleId(tt, lineHex); tt = r.t; lineFillStyleId = r.fillStyleId; }

  const base = createDefaultBorderStyle();
  const side = on => ({ enabled: on, lineWidth: null, lineStyle: null, lineColor: null, lineFillStyleId: null });
  const bs = {
    ...base,
    id: genId('bs'),
    name,
    isDefault: false,
    lineWidth, lineStyle: 'Solid', lineColor: lineHex, lineFillStyleId,
    sides: { top: side(allSides), right: side(allSides), bottom: side(allSides), left: side(allSides) },
    fill: '', fillFillStyleId,
  };
  return { t: { ...tt, styles: { ...tt.styles, border: [...(tt.styles?.border ?? []), bs] } }, id: bs.id };
}

export function buildTableStyleFromPreset(t, presetKey) {
  const p = TABLE_STYLE_PRESETS[presetKey];
  if (!p) return { t, tableStyleId: null };

  // Reuse an existing table style created from the same preset (avoids spam on
  // repeated clicks).
  const existing = (t.styles?.table ?? []).find(s => s._fromPreset === presetKey);
  if (existing) return { t, tableStyleId: existing.id };

  let tt = t;
  const all = p.border === 'all';
  const bodyHasFill = !!(p.odd || p.even);

  const mk = (name, fillHex) => {
    const r = makeBorderStyleResource(tt, { name, allSides: all, fillHex });
    tt = r.t; return r.id;
  };

  const headerRef = mk(`${p.label} · encabezado`, p.header);
  const oddRef    = mk(`${p.label} · fila impar`, p.odd);
  const evenRef   = mk(`${p.label} · fila par`, p.even);
  const bodyRef   = bodyHasFill ? null : mk(`${p.label} · cuerpo`, null);

  // Outer perimeter border (for 'all' and 'exterior'); 'none' → no outer border.
  let tableBorderRef = null;
  if (p.border === 'all' || p.border === 'exterior') {
    const r = makeBorderStyleResource(tt, { name: `${p.label} · contorno`, allSides: true, fillHex: null });
    tt = r.t; tableBorderRef = r.id;
  }

  const ts = createTableStyle(p.label, { _fromPreset: presetKey, tableBorderStyleRef: tableBorderRef });
  ts.regions.firstHeader.columns = headerRef;
  ts.regions.header.columns      = headerRef;
  ts.regions.oddBody.columns     = oddRef ?? bodyRef;
  ts.regions.evenBody.columns    = evenRef ?? bodyRef;
  ts.regions.footer.columns      = bodyRef ?? headerRef;
  ts.regions.lastFooter.columns  = bodyRef ?? headerRef;

  tt = { ...tt, styles: { ...tt.styles, table: [...(tt.styles?.table ?? []), ts] } };
  return { t: tt, tableStyleId: ts.id };
}
