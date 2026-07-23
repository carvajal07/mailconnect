// useBorderFillStyles.js — Border + Fill style CRUD for useDesignerState

import { useCallback } from 'react';
import { inferColorName, hexToRgb } from '../../engine/colorUtils.js';
import { hexToCmyk } from '../resources/colorUtils.jsx';
import { createTableStyle } from '../../engine/elementFactory.js';

export function useBorderFillStyles(template, setTemplate) {

  // ── Border Styles ───────────────────────────────────────────────────────────

  const addBorderStyle = useCallback(() => {
    const id = `bs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.border ?? [];
      const usedNums = existing
        .map(s => s.name?.match(/^Nuevo estilo\s*(\d+)$/)?.[1])
        .filter(Boolean).map(Number);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      return {
        ...t,
        styles: {
          ...t.styles,
          border: [...existing, {
            id, name: `Nuevo estilo ${next}`,
            lineWidth: 0.20, lineCap: 'Butt', lineStyle: 'Solid', lineColor: '#000000',
            sides: {
              top:    { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
              right:  { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
              bottom: { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
              left:   { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
            },
            corner: 'Standard', radiusX: 5, radiusY: 5,
            corners: {
              topLeft:     { corner: null, radiusX: null, radiusY: null },
              topRight:    { corner: null, radiusX: null, radiusY: null },
              bottomRight: { corner: null, radiusX: null, radiusY: null },
              bottomLeft:  { corner: null, radiusX: null, radiusY: null },
            },
            join: 'Miter', joinColor: '#000000', miter: 10,
            fill: '', shadowColor: '', shadowOffsetX: 0, shadowOffsetY: 0,
            marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
            offsetLeft: 0, offsetRight: 0, offsetTop: 0, offsetBottom: 0,
          }],
        },
      };
    });
    return id;
  }, [setTemplate]);

  const updateBorderStyle = useCallback((id, changes) => {
    setTemplate(t => ({
      ...t,
      // Clear `system`: once the user edits/renames a style in the panel it's
      // "owned" and must never be auto-removed by gcOrphanBorderStyles.
      styles: { ...t.styles, border: (t.styles?.border ?? []).map(s => s.id === id ? { ...s, ...changes, system: false } : s) },
    }));
  }, [setTemplate]);

  const removeBorderStyle = useCallback((id) => {
    setTemplate(t => ({
      ...t,
      styles: { ...t.styles, border: (t.styles?.border ?? []).filter(s => s.id !== id) },
    }));
  }, [setTemplate]);

  const cloneBorderStyle = useCallback((id) => {
    const newId = `bs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.border ?? [];
      const source = existing.find(s => s.id === id);
      if (!source) return t;
      // A clone is user-owned (not system, not default) so it persists.
      return { ...t, styles: { ...t.styles, border: [...existing, { ...source, id: newId, name: `${source.name} (copia)`, isDefault: false, system: false }] } };
    });
    return newId;
  }, [setTemplate]);

  // ── Fill Styles ─────────────────────────────────────────────────────────────

  const addFillStyle = useCallback((initialProps = {}) => {
    const id = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const isSolid = !initialProps.type || initialProps.type === 'solid';
    // Pre-generate colorId only for solid fills with an actual color
    const autoColorId = isSolid && initialProps.color
      ? `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      : (initialProps.colorId ?? null);

    setTemplate(t => {
      const existing = t.styles?.fill ?? [];
      let name;
      if (isSolid && initialProps.color) {
        const base = inferColorName(initialProps.color) ?? 'Fill';
        const usedNames = new Set(existing.map(s => s.name));
        if (!usedNames.has(base)) {
          name = base;
        } else {
          let n = 2;
          while (usedNames.has(`${base} ${n}`)) n++;
          name = `${base} ${n}`;
        }
      } else {
        const usedNums = existing
          .map(s => s.name?.match(/^Fill\s*(\d+)$/)?.[1])
          .filter(Boolean).map(Number);
        const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
        name = `Fill ${next}`;
      }

      // Auto-create Color entity for solid fills
      let newColors = t.colors ?? [];
      let resolvedColorId = initialProps.colorId ?? null;
      if (autoColorId && isSolid && initialProps.color && !initialProps.colorId) {
        const hex = initialProps.color;
        const { r, g, b } = hexToRgb(hex);
        const { c, m, y, k } = hexToCmyk(hex);
        // Avoid duplicating a color with the same hex
        const dup = newColors.find(col => col.hex === hex && col.type === 'simple');
        if (!dup) {
          const colorName = name;
          const usedColorNames = new Set(newColors.map(col => col.name));
          let cname = colorName;
          if (usedColorNames.has(cname)) {
            let n = 2;
            while (usedColorNames.has(`${colorName} ${n}`)) n++;
            cname = `${colorName} ${n}`;
          }
          const now = new Date().toISOString();
          newColors = [...newColors, {
            id: autoColorId, name: cname,
            type: 'simple', colorSpace: 'rgb',
            hex, r, g, b, c, m, y, k,
            alpha: 255, spotColor: null, mixSpotColor: false,
            cases: [], defaultColorId: null,
            createdAt: now, updatedAt: now,
          }];
          resolvedColorId = autoColorId;
        } else {
          resolvedColorId = dup.id;
        }
      }

      const now = new Date().toISOString();
      return {
        ...t,
        colors: newColors,
        styles: {
          ...t.styles,
          fill: [...existing, {
            id, name, type: 'solid', color: '#000000', opacity: 1,
            colorId: resolvedColorId,
            gradient: {
              type: 'linear', angle: 90, cx: 50, cy: 50,
              stops: [
                { color: '#000000', offset: 0,   opacity: 1 },
                { color: '#ffffff', offset: 100, opacity: 1 },
              ],
            },
            createdAt: now,
            updatedAt: now,
            ...initialProps,
            colorId: resolvedColorId,
          }],
        },
      };
    });
    return id;
  }, [setTemplate]);

  const updateFillStyle = useCallback((id, changes) => {
    setTemplate(t => {
      if ((t.styles?.fill ?? []).find(s => s.id === id)?.isDefault) return t;
      return {
        ...t,
        styles: {
          ...t.styles,
          fill: (t.styles?.fill ?? []).map(s =>
            s.id === id ? { ...s, ...changes, updatedAt: new Date().toISOString() } : s
          ),
        },
      };
    });
  }, [setTemplate]);

  const removeFillStyle = useCallback((id) => {
    setTemplate(t => {
      if ((t.styles?.fill ?? []).find(s => s.id === id)?.isDefault) return t;
      return {
        ...t,
        styles: { ...t.styles, fill: (t.styles?.fill ?? []).filter(s => s.id !== id) },
      };
    });
  }, [setTemplate]);

  const cloneFillStyle = useCallback((id) => {
    const newId = `fs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.fill ?? [];
      const source = existing.find(s => s.id === id);
      if (!source) return t;
      const { isDefault: _def, ...rest } = source;
      return { ...t, styles: { ...t.styles, fill: [...existing, { ...rest, id: newId, name: `${source.name} (copia)` }] } };
    });
    return newId;
  }, [setTemplate]);

  const getFillStyleUsage = useCallback((id) => {
    const usages = [];
    for (const page of template?.pages ?? []) {
      for (const el of page.elements ?? []) {
        if (el.fill?.fillStyleId === id) {
          usages.push({ type: 'element', pageId: page.id, pageName: page.name, elementId: el.id });
        }
      }
    }
    for (const bs of template?.styles?.border ?? []) {
      if (bs.fill?.fillStyleId === id || bs.lineFill?.fillStyleId === id || bs.shadowFill?.fillStyleId === id) {
        usages.push({ type: 'borderStyle', label: bs.name, elementId: bs.id });
      }
    }
    for (const ts of template?.styles?.text ?? []) {
      if (ts.fillStyleId === id) usages.push({ type: 'textStyle', label: ts.name, elementId: ts.id });
    }
    return usages;
  }, [template]);

  const resolveFillStyle = useCallback((fillStyleId) => {
    return (template?.styles?.fill ?? []).find(s => s.id === fillStyleId) ?? null;
  }, [template]);

  // ── Table Styles ──────────────────────────────────────────────────────────────

  const addTableStyle = useCallback((overrides = {}) => {
    const existing = template?.styles?.table ?? [];
    const usedNums = existing
      .map(s => s.name?.match(/^Table Style\s*(\d+)$/)?.[1]).filter(Boolean).map(Number);
    const next = usedNums.length ? Math.max(...usedNums) + 1 : existing.length + 1;
    const ts = createTableStyle(overrides.name ?? `Table Style ${next}`, overrides);
    setTemplate(t => ({
      ...t,
      styles: { ...t.styles, table: [...(t.styles?.table ?? []), ts] },
    }));
    return ts.id;
  }, [template, setTemplate]);

  const updateTableStyle = useCallback((id, changes) => {
    setTemplate(t => ({
      ...t,
      styles: {
        ...t.styles,
        table: (t.styles?.table ?? []).map(s =>
          s.id === id ? { ...s, ...changes, updatedAt: new Date().toISOString() } : s),
      },
    }));
  }, [setTemplate]);

  // Convenience: patch one region's slot(s) without rebuilding the whole object.
  const updateTableStyleRegion = useCallback((id, regionKey, slotChanges) => {
    setTemplate(t => ({
      ...t,
      styles: {
        ...t.styles,
        table: (t.styles?.table ?? []).map(s => {
          if (s.id !== id) return s;
          const region = { ...(s.regions?.[regionKey] ?? {}), ...slotChanges };
          return { ...s, regions: { ...s.regions, [regionKey]: region }, updatedAt: new Date().toISOString() };
        }),
      },
    }));
  }, [setTemplate]);

  const removeTableStyle = useCallback((id) => {
    setTemplate(t => ({
      ...t,
      styles: { ...t.styles, table: (t.styles?.table ?? []).filter(s => s.id !== id) },
    }));
  }, [setTemplate]);

  const cloneTableStyle = useCallback((id) => {
    const newId = `tbls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.table ?? [];
      const src = existing.find(s => s.id === id);
      if (!src) return t;
      return { ...t, styles: { ...t.styles, table: [...existing, { ...JSON.parse(JSON.stringify(src)), id: newId, name: `${src.name} (copia)` }] } };
    });
    return newId;
  }, [setTemplate]);

  return {
    addBorderStyle, updateBorderStyle, removeBorderStyle, cloneBorderStyle,
    addFillStyle, updateFillStyle, removeFillStyle, cloneFillStyle,
    getFillStyleUsage, resolveFillStyle,
    addTableStyle, updateTableStyle, updateTableStyleRegion, removeTableStyle, cloneTableStyle,
  };
}
