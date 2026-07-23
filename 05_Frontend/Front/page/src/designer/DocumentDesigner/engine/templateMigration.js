// engine/templateMigration.js — Upgrades legacy template shapes to the current schema

import {
  createEmptyTemplate,
  createPagesConfig,
  DEFAULT_TEXT_STYLE_ID, createDefaultTextStyle,
  DEFAULT_PARAGRAPH_STYLE_ID, createDefaultParagraphStyle,
  DEFAULT_BLACK_COLOR_ID, createDefaultBlackColor,
  DEFAULT_FILL_STYLE_ID, createDefaultBlackFillStyle,
  DEFAULT_BORDER_STYLE_ID, createDefaultBorderStyle,
} from './elementFactory.js';
import { hexToRgb } from './colorUtils.js';
import { resourcifyInlineBorder, resourcifyInlineFill } from './tableResourceLink.js';
import { findOrCreateBorderStyle } from './borderStyleUtils.js';

// ── Inline hex→CMYK (no circular dep on resources/colorUtils) ────────────────

function _hexToCmyk(hex) {
  const { r, g, b } = hexToRgb(hex ?? '#000000');
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = Math.round(((1 - rn - k) / (1 - k)) * 100);
  const m = Math.round(((1 - gn - k) / (1 - k)) * 100);
  const y = Math.round(((1 - bn - k) / (1 - k)) * 100);
  return { c, m, y, k: Math.round(k * 100) };
}

// ── Find-or-create a Color+FillStyle pair for a given hex ────────────────────

function ensureColorFillForHex(t, hex, nameFallback) {
  // Look for existing fill style with this exact hex (solid)
  const existingFill = (t.styles?.fill ?? []).find(
    fs => fs.type === 'solid' && fs.color === hex
  );
  if (existingFill) return { t, fillStyleId: existingFill.id };

  // Find or create a Color entity
  let colors = t.colors ?? [];
  let colorId = colors.find(c => c.type === 'simple' && c.hex === hex)?.id ?? null;
  if (!colorId) {
    colorId = `col_mig_${hex.replace('#', '')}_${Math.random().toString(36).slice(2, 5)}`;
    const { r, g, b } = hexToRgb(hex);
    const { c, m, y, k } = _hexToCmyk(hex);
    const now = new Date().toISOString();
    colors = [...colors, {
      id: colorId, name: nameFallback ?? hex,
      type: 'simple', colorSpace: 'rgb',
      hex, r, g, b, c, m, y, k,
      alpha: 255, spotColor: null, mixSpotColor: false,
      cases: [], defaultColorId: null,
      createdAt: now, updatedAt: now,
    }];
    t = { ...t, colors };
  }

  // Create FillStyle
  const fillStyleId = `fs_mig_${hex.replace('#', '')}_${Math.random().toString(36).slice(2, 5)}`;
  const now = new Date().toISOString();
  const fill = {
    id: fillStyleId, name: nameFallback ?? hex,
    type: 'solid', color: hex, colorId, opacity: 1,
    gradient: { type: 'linear', angle: 0, cx: 50, cy: 50, stops: [] },
    imageId: null, offsetX: 0, offsetY: 0, rotation: 0,
    scaleX: 1, scaleY: 1, flipX: false, flipY: false, autofit: true, tile: false,
    createdAt: now, updatedAt: now,
  };
  t = { ...t, styles: { ...t.styles, fill: [...(t.styles?.fill ?? []), fill] } };
  return { t, fillStyleId };
}

// ── Main migration ────────────────────────────────────────────────────────────

export function migrateTemplate(t) {
  if (!t) return createEmptyTemplate();

  // pagesConfigs[] (array anterior) → pagesConfig (objeto) + pages planas
  if (t.pagesConfigs && !t.pagesConfig) {
    const first = t.pagesConfigs[0];
    const { pages: pcPages, id: _id, name: _name, ...pcRest } = first ?? {};
    t = { ...t, pagesConfig: createPagesConfig(pcRest), pages: pcPages ?? [] };
  }
  // pages[] sin pagesConfig
  if (t.pages && !t.pagesConfig) {
    t = { ...t, pagesConfig: createPagesConfig() };
  }
  // Migrate element.areas → template.contentAreas + element.areaRef
  if (!t.contentAreas) {
    const pool = [];
    const pages = (t.pages ?? []).map(page => ({
      ...page,
      elements: (page.elements ?? []).map(el => {
        if (el.type === 'contentarea' && el.areas?.length > 0 && !el.areaRef) {
          const area = el.areas[0];
          pool.push(area);
          const { areas: _a, ...rest } = el;
          return { ...rest, areaRef: area.id };
        }
        return el;
      }),
    }));
    t = { ...t, pages, contentAreas: pool };
  }
  // Migrate type:'text' elements → type:'contentarea' with pool entry
  const hasTextEls = (t.pages ?? []).some(p => (p.elements ?? []).some(el => el.type === 'text'));
  if (hasTextEls) {
    const pool = [...(t.contentAreas ?? [])];
    const now = new Date().toISOString();
    const pages = (t.pages ?? []).map(page => ({
      ...page,
      elements: (page.elements ?? []).map(el => {
        if (el.type !== 'text') return el;
        const areaId = `area_mig_${el.id}_${Math.random().toString(36).slice(2, 5)}`;
        pool.push({
          id: areaId, label: el.name ?? 'Texto',
          flowType: 'simple', content: el.content ?? '',
          elements: [], children: [], visible: true, condition: null,
          dataPath: '', selectionType: 'condition', selectionVariable: '',
          selectionMappings: [], selectionScript: '', conditions: [],
          defaultAreaId: '', trueAreaId: '', falseAreaId: '',
          defaultTextStyleId: el.textStyleId ?? null,
          isSectionFlow: false, fittingMode: 'none', fittingFlows: [],
          createdAt: now, updatedAt: now,
        });
        const { content: _c, textStyleId: _ts, textStyle: _tst, paragraphStyle: _ps, overflow: _ov, ...rest } = el;
        return { ...rest, type: 'contentarea', areaRef: areaId };
      }),
    }));
    t = { ...t, pages, contentAreas: pool };
  }

  // Ensure images pool exists
  if (!t.images) t = { ...t, images: [] };
  // Ensure fonts pool exists
  if (!t.fonts) t = { ...t, fonts: [] };
  // Ensure default text style exists
  const textStyles = t.styles?.text ?? [];
  if (!textStyles.some(s => s.id === DEFAULT_TEXT_STYLE_ID)) {
    t = { ...t, styles: { ...t.styles, text: [createDefaultTextStyle(), ...textStyles] } };
  }
  // Ensure default paragraph style exists
  const paraStyles = t.styles?.paragraph ?? [];
  if (!paraStyles.some(s => s.id === DEFAULT_PARAGRAPH_STYLE_ID)) {
    t = { ...t, styles: { ...t.styles, paragraph: [createDefaultParagraphStyle(), ...paraStyles] } };
  }
  // Ensure colors array exists and has the default black color
  if (!t.colors) t = { ...t, colors: [] };
  if (!t.colors.some(c => c.id === DEFAULT_BLACK_COLOR_ID)) {
    t = { ...t, colors: [createDefaultBlackColor(), ...t.colors] };
  }
  // Ensure default black fill style exists
  if (!(t.styles?.fill ?? []).some(f => f.id === DEFAULT_FILL_STYLE_ID)) {
    t = { ...t, styles: { ...t.styles, fill: [createDefaultBlackFillStyle(), ...(t.styles?.fill ?? [])] } };
  }

  // Mark all known defaults as isDefault: true, and enforce canonical names.
  // Also normalize the default lineHeight to 'normal' (font-intrinsic metrics
  // = PDF/print standard behavior; no multiplier). Idempotent: ONLY the
  // historic values 1.4 (legacy) and 1.2 (the brief intermediate fix) are
  // bumped — user-customized lineHeight pass through unchanged.
  t = {
    ...t,
    colors: (t.colors ?? []).map(c =>
      c.id === DEFAULT_BLACK_COLOR_ID ? { ...c, isDefault: true, name: 'Color Negro' } : c
    ),
    styles: {
      ...t.styles,
      fill: (t.styles?.fill ?? []).map(f =>
        f.id === DEFAULT_FILL_STYLE_ID ? { ...f, isDefault: true, name: 'Relleno Negro' } : f
      ),
      text: (t.styles?.text ?? []).map(s => {
        if (s.id !== DEFAULT_TEXT_STYLE_ID) return s;
        // Drop the legacy `color` hex field — the text color is resolved by
        // the chain fillStyleId → fill style → colorId → color resource.
        // Idempotent: only acts when the field is present.
        // eslint-disable-next-line no-unused-vars
        const { color: _legacy, ...rest } = s;
        return {
          ...rest,
          isDefault: true,
          // Bump historic fontFamily 'Inter' → 'Arial' (Word/print default).
          fontFamily: s.fontFamily === 'Inter' ? 'Arial' : s.fontFamily,
          lineHeight: (s.lineHeight === 1.4 || s.lineHeight === 1.2) ? 'normal' : s.lineHeight,
        };
      }),
      paragraph: (t.styles?.paragraph ?? []).map(s =>
        s.id === DEFAULT_PARAGRAPH_STYLE_ID
          ? { ...s, isDefault: true, lineHeight: (s.lineHeight === 1.4 || s.lineHeight === 1.2) ? 'normal' : s.lineHeight }
          : s
      ),
    },
  };

  // Fix bug: duplicate fillStyleId key in createDefaultTextStyle caused migration
  // to create a spurious Color+FillStyle from ts.color instead of linking to DEFAULT_FILL_STYLE_ID.
  // Repair the default text style and remove the orphaned auto-generated entities.
  const tsDefault = (t.styles?.text ?? []).find(s => s.id === DEFAULT_TEXT_STYLE_ID);
  if (tsDefault && tsDefault.fillStyleId !== DEFAULT_FILL_STYLE_ID) {
    const badFillId = tsDefault.fillStyleId;
    // Force correct link
    t = {
      ...t,
      styles: {
        ...t.styles,
        text: (t.styles?.text ?? []).map(s =>
          s.id === DEFAULT_TEXT_STYLE_ID ? { ...s, fillStyleId: DEFAULT_FILL_STYLE_ID } : s
        ),
      },
    };
    // Remove the spurious auto-generated fill style (only if it was created by migration)
    if (badFillId && badFillId.startsWith('fs_mig_')) {
      const badFill = (t.styles?.fill ?? []).find(f => f.id === badFillId);
      const badColorId = badFill?.colorId;
      t = {
        ...t,
        styles: { ...t.styles, fill: (t.styles?.fill ?? []).filter(f => f.id !== badFillId) },
      };
      // Remove the associated auto-generated color
      if (badColorId && badColorId.startsWith('col_mig_')) {
        t = { ...t, colors: (t.colors ?? []).filter(c => c.id !== badColorId) };
      }
    }
  }

  // Migrate text styles: raw color hex → fillStyleId
  // For each text style without fillStyleId that has a color, find-or-create Color+Fill
  const textStylesMigrated = [];
  for (const ts of t.styles?.text ?? []) {
    if (!ts.fillStyleId && ts.color && ts.color !== '') {
      const { t: t2, fillStyleId } = ensureColorFillForHex(t, ts.color, ts.name ?? ts.color);
      t = t2;
      textStylesMigrated.push({ ...ts, fillStyleId });
    } else {
      textStylesMigrated.push(ts);
    }
  }
  t = { ...t, styles: { ...t.styles, text: textStylesMigrated } };

  // Migrate paragraph styles: listColor hex → listFillStyleId
  const paraStylesMigrated = [];
  for (const ps of t.styles?.paragraph ?? []) {
    if (!ps.listFillStyleId && ps.listColor && ps.listColor !== '') {
      const { t: t2, fillStyleId } = ensureColorFillForHex(t, ps.listColor, ps.name ?? ps.listColor);
      t = t2;
      paraStylesMigrated.push({ ...ps, listFillStyleId: fillStyleId });
    } else {
      paraStylesMigrated.push(ps);
    }
  }
  t = { ...t, styles: { ...t.styles, paragraph: paraStylesMigrated } };

  // Resourcify all TABLE cells: inline border → { styleRef, sides:{enabled} }
  // and inline fill { color } → { fillStyleId }. Deduped across the whole
  // template (identical pens share one border style; identical hex shares one
  // fill style + color). Idempotent: already-referenced borders/fills pass
  // through unchanged.
  t = migrateTableCellsToResources(t);

  // ── Model B ──────────────────────────────────────────────────────────────
  // 1. Ensure the protected default border style exists in the pool.
  t = ensureDefaultBorderStyle(t);
  // 2. Absorb each cell's separate `cell.fill` INTO its border style
  //    (borderStyle.fillFillStyleId), since in Model B the borderStyle IS the
  //    complete cell box (lines + fill). Always forks (never clobbers a shared
  //    named style); dedupes identical look+fill combos. Removes cell.fill.
  t = migrateAbsorbCellFill(t);

  // Wire the DEFAULT PARAGRAPH STYLE to every content area / table cell flow
  // that has no paragraphStyleId yet AND no inline paragraphStyle — so that
  // editing 'Default Paragraph Style' propagates to every default-styled
  // area/cell (parity with how Default Text Style is already referenced).
  // Idempotent: areas/cells that already have a paragraphStyleId or an inline
  // paragraphStyle pass through unchanged.
  t = migrateAttachParagraphDefault(t);

  return t;
}

// ── Resourcify table cells (run once via migrateTemplate) ────────────────────

function _resourcifyTableCells(t, table) {
  let t2 = t;
  const rowSets = (table.rowSets ?? []).map(rs => {
    if (rs.type !== 'single-row') return rs;
    const cells = (rs.cells ?? []).map(c => {
      let cell = c;
      if (cell.border) {
        const r = resourcifyInlineBorder(t2, cell.border);
        t2 = r.t; cell = { ...cell, border: r.border };
      }
      if (cell.fill) {
        const r = resourcifyInlineFill(t2, cell.fill);
        t2 = r.t; cell = { ...cell, fill: r.fill };
      }
      return cell;
    });
    return { ...rs, cells };
  });
  return { t: t2, table: { ...table, rowSets } };
}

function _walkAreas(areas, transform) {
  return (areas ?? []).map(a => ({
    ...a,
    elements: (a.elements ?? []).map(transform),
    children: a.children?.length ? _walkAreas(a.children, transform) : (a.children ?? []),
  }));
}

function migrateTableCellsToResources(t) {
  let tt = t;
  // Single transform shared by all walks — captures `tt` via closure.
  const transform = el => {
    if (!el || el.type !== 'table') return el;
    const r = _resourcifyTableCells(tt, el);
    tt = r.t;
    return r.table;
  };
  // 1. Standalone tables on every page.
  tt = {
    ...tt,
    pages: (tt.pages ?? []).map(p => ({
      ...p,
      elements: (p.elements ?? []).map(transform),
    })),
  };
  // 2. Pool contentAreas (top-level + nested children).
  if ((tt.contentAreas ?? []).length) {
    tt = { ...tt, contentAreas: _walkAreas(tt.contentAreas, transform) };
  }
  // 3. Legacy inline model: element.areas[] on page elements.
  tt = {
    ...tt,
    pages: (tt.pages ?? []).map(p => ({
      ...p,
      elements: (p.elements ?? []).map(el =>
        el.areas?.length ? { ...el, areas: _walkAreas(el.areas, transform) } : el
      ),
    })),
  };
  return tt;
}

// ── Model B: default border style + absorb cell.fill ─────────────────────────

function ensureDefaultBorderStyle(t) {
  const border = t.styles?.border ?? [];
  if (border.some(s => s.id === DEFAULT_BORDER_STYLE_ID || s.isDefault)) return t;
  return { ...t, styles: { ...t.styles, border: [createDefaultBorderStyle(), ...border] } };
}

function _absorbCellFillInTable(t, table) {
  let t2 = t;
  const rowSets = (table.rowSets ?? []).map(rs => {
    if (rs.type !== 'single-row') return rs;
    const cells = (rs.cells ?? []).map(c => {
      // Only cells carrying a separate fill ref need absorbing.
      if (!c.fill?.fillStyleId) {
        // Drop empty/cleared inline fills so they don't linger.
        if (c.fill && !c.fill.fillStyleId && !c.fill.color) {
          const { fill: _d, ...rest } = c;
          return rest;
        }
        return c;
      }
      const baseId = c.border?.styleRef ?? DEFAULT_BORDER_STYLE_ID;
      // findOrCreateBorderStyle always forks + dedupes, so distinct cell fills
      // never clobber a shared style.
      const { t: tn, id: newId } = findOrCreateBorderStyle(
        t2, baseId, { fillFillStyleId: c.fill.fillStyleId, fill: '' });
      t2 = tn;
      const sides = c.border?.sides ?? {
        top: { enabled: false }, right: { enabled: false },
        bottom: { enabled: false }, left: { enabled: false },
      };
      const { fill: _drop, ...rest } = c;
      return { ...rest, border: { ...(c.border ?? {}), styleRef: newId, sides } };
    });
    return { ...rs, cells };
  });
  return { t: t2, table: { ...table, rowSets } };
}

function migrateAbsorbCellFill(t) {
  let tt = t;
  const transform = el => {
    if (!el || el.type !== 'table') return el;
    const r = _absorbCellFillInTable(tt, el);
    tt = r.t;
    return r.table;
  };
  // 1. Standalone tables on pages.
  tt = { ...tt, pages: (tt.pages ?? []).map(p => ({ ...p, elements: (p.elements ?? []).map(transform) })) };
  // 2. Pool contentAreas.
  if ((tt.contentAreas ?? []).length) tt = { ...tt, contentAreas: _walkAreas(tt.contentAreas, transform) };
  // 3. Legacy inline el.areas[].
  tt = {
    ...tt,
    pages: (tt.pages ?? []).map(p => ({
      ...p,
      elements: (p.elements ?? []).map(el =>
        el.areas?.length ? { ...el, areas: _walkAreas(el.areas, transform) } : el),
    })),
  };
  return tt;
}

// ── Attach the default paragraph style to areas/cells (Opción A) ─────────────
// An area or cell.flow gets `paragraphStyleId = DEFAULT_PARAGRAPH_STYLE_ID`
// IF it has no paragraphStyleId AND no inline paragraphStyle. Otherwise it's
// left intact (user-customized).

function _attachPsToArea(a) {
  if (!a) return a;
  // Recurse into children first.
  const children = a.children?.length ? a.children.map(_attachPsToArea) : (a.children ?? []);
  const next = (a.paragraphStyleId || a.paragraphStyle)
    ? { ...a, children }
    : { ...a, paragraphStyleId: DEFAULT_PARAGRAPH_STYLE_ID, children };
  return next;
}

function _attachPsToCellFlow(flow) {
  if (!flow) return flow;
  if (flow.paragraphStyleId || flow.paragraphStyle) return flow;
  return { ...flow, paragraphStyleId: DEFAULT_PARAGRAPH_STYLE_ID };
}

function _attachPsToTableEl(el) {
  if (!el || el.type !== 'table') return el;
  const rowSets = (el.rowSets ?? []).map(rs => {
    if (rs.type !== 'single-row') return rs;
    const cells = (rs.cells ?? []).map(c => ({ ...c, flow: _attachPsToCellFlow(c.flow) }));
    return { ...rs, cells };
  });
  return { ...el, rowSets };
}

function migrateAttachParagraphDefault(t) {
  // Reuse the same walking pattern as the resource migration.
  const transformEl = el => {
    if (el?.type === 'table') return _attachPsToTableEl(el);
    return el;
  };
  // 1. Standalone tables on every page.
  let tt = {
    ...t,
    pages: (t.pages ?? []).map(p => ({
      ...p,
      elements: (p.elements ?? []).map(transformEl),
    })),
  };
  // 2. Pool contentAreas (recursive children) — attach to each area AND
  //    transform embedded tables (their cell flows).
  if ((tt.contentAreas ?? []).length) {
    const walkAreaAndElements = (a) => {
      const withPs = _attachPsToArea(a);
      return {
        ...withPs,
        elements: (withPs.elements ?? []).map(transformEl),
      };
    };
    // Walk pool recursively; _attachPsToArea recurses children, but we also
    // need to transform element trees inside.
    const walkPool = (areas) => (areas ?? []).map(a => {
      const updated = walkAreaAndElements(a);
      return updated.children?.length
        ? { ...updated, children: walkPool(updated.children) }
        : updated;
    });
    tt = { ...tt, contentAreas: walkPool(tt.contentAreas) };
  }
  // 3. Legacy inline el.areas on page elements.
  tt = {
    ...tt,
    pages: (tt.pages ?? []).map(p => ({
      ...p,
      elements: (p.elements ?? []).map(el => {
        if (!el.areas?.length) return el;
        const areas = el.areas.map(a => {
          const withPs = _attachPsToArea(a);
          return {
            ...withPs,
            elements: (withPs.elements ?? []).map(transformEl),
          };
        });
        return { ...el, areas };
      }),
    })),
  };
  return tt;
}
