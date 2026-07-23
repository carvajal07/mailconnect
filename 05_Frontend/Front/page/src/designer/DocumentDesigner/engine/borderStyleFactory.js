// borderStyleFactory.js — find-or-create helpers for border styles
//
// When the user configures a border (from the InsertTableDialog or any other
// UI), we don't store inline data on the element. Instead we register the
// configuration as a named entry in `template.styles.border` and the element/
// cell stores a `styleRef` pointer. If the same shape already exists in the
// template, we reuse its id — no duplication.

// Pick the fields that define a style's identity. Two styles are considered
// equal if all these fields match. We intentionally exclude `id`, `name`,
// `createdAt`, `updatedAt`, `lineColor` (we trust `lineColorId` over the cached
// hex), and any field that doesn't affect rendering.
function styleIdentitySignature(style) {
  return JSON.stringify({
    lineColorId:      style.lineColorId ?? null,
    lineFillStyleId:  style.lineFillStyleId ?? null,
    lineColor:        style.lineColorId ? null : (style.lineColor ?? null), // ignore hex if linked
    lineWidth:        style.lineWidth ?? null,
    lineStyle:        style.lineStyle ?? null,
    lineCap:          style.lineCap ?? null,
    sides:            normalizeSides(style.sides),
    corners:          normalizeCorners(style.corners),
    diagonals:        normalizeDiagonals(style.diagonals),
    // Shading + margin + offset are user-configurable too; include them so we
    // don't accidentally reuse a style that has shadows/margins set differently.
    fill:             style.fill ?? null,
    fillFillStyleId:  style.fillFillStyleId ?? null,
    shadowColor:      style.shadowColor ?? null,
    shadowColorId:    style.shadowColorId ?? null,
    shadowOffsetX:    style.shadowOffsetX ?? null,
    shadowOffsetY:    style.shadowOffsetY ?? null,
    marginColor:      style.marginColor ?? null,
    marginColorId:    style.marginColorId ?? null,
    marginLineWidth:  style.marginLineWidth ?? null,
    marginLineStyle:  style.marginLineStyle ?? null,
    marginTop:        style.marginTop ?? null,
    marginRight:      style.marginRight ?? null,
    marginBottom:     style.marginBottom ?? null,
    marginLeft:       style.marginLeft ?? null,
    offsetTop:        style.offsetTop ?? null,
    offsetRight:      style.offsetRight ?? null,
    offsetBottom:     style.offsetBottom ?? null,
    offsetLeft:       style.offsetLeft ?? null,
  });
}

function normalizeSides(sides) {
  if (!sides) return null;
  const out = {};
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const sd = sides[side];
    if (!sd) { out[side] = null; continue; }
    out[side] = {
      enabled:         sd.enabled ?? null,
      lineColorId:     sd.lineColorId ?? null,
      lineFillStyleId: sd.lineFillStyleId ?? null,
      lineColor:       sd.lineColorId ? null : (sd.lineColor ?? null),
      lineWidth:       sd.lineWidth ?? null,
      lineStyle:       sd.lineStyle ?? null,
    };
  }
  return out;
}

function normalizeCorners(corners) {
  if (!corners) return null;
  const out = {};
  for (const corner of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
    const cd = corners[corner];
    if (!cd) { out[corner] = null; continue; }
    out[corner] = {
      corner:  cd.corner ?? null,
      radiusX: cd.radiusX ?? null,
      radiusY: cd.radiusY ?? null,
    };
  }
  return out;
}

function normalizeDiagonals(diagonals) {
  if (!diagonals) return null;
  const out = {};
  for (const key of ['lr', 'rl']) {
    const d = diagonals[key];
    if (!d) { out[key] = null; continue; }
    out[key] = {
      enabled:         d.enabled ?? null,
      lineColorId:     d.lineColorId ?? null,
      lineFillStyleId: d.lineFillStyleId ?? null,
      lineColor:       d.lineColorId ? null : (d.lineColor ?? null),
      lineWidth:       d.lineWidth ?? null,
      lineStyle:       d.lineStyle ?? null,
    };
  }
  return out;
}

function generateBorderStyleName(existing) {
  const used = (existing ?? [])
    .map(s => s.name?.match(/^Nuevo estilo\s*(\d+)$/)?.[1])
    .filter(Boolean).map(Number);
  const next = used.length > 0 ? Math.max(...used) + 1 : (existing?.length ?? 0) + 1;
  return `Nuevo estilo ${next}`;
}

// findOrCreateBorderStyle: returns { template, styleId }.
// If a border style with the same identity signature already exists, returns
// its id without changing the template. Otherwise inserts a new style and
// returns the new id. The input template is NOT mutated.
//
// `config` should contain only the fields that define the style (lineColorId,
// lineWidth, lineStyle, sides, corners, etc.). Identity-fields like id, name,
// createdAt are added automatically.
export function findOrCreateBorderStyle(template, config) {
  const existing = template?.styles?.border ?? [];
  const targetSig = styleIdentitySignature(config);
  const match = existing.find(s => styleIdentitySignature(s) === targetSig);
  if (match) return { template, styleId: match.id };

  const id = `bs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = new Date().toISOString();
  const entry = {
    id,
    name: generateBorderStyleName(existing),
    ...config,
    createdAt: now,
    updatedAt: now,
  };
  const nextTemplate = {
    ...template,
    styles: {
      ...(template.styles ?? {}),
      border: [...existing, entry],
    },
  };
  return { template: nextTemplate, styleId: id };
}
