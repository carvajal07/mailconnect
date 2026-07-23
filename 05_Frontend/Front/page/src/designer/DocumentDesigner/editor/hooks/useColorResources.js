// useColorResources.js — Color entity CRUD for useDesignerState

import { useCallback } from 'react';
import { hexToRgb, rgbToHex, inferColorName } from '../../engine/colorUtils.js';
import { hexToCmyk, cmykToHex } from '../resources/colorUtils.jsx';

function recomputeHex(color) {
  if (color.colorSpace === 'cmyk') {
    return cmykToHex(color.c ?? 0, color.m ?? 0, color.y ?? 0, color.k ?? 100);
  }
  return rgbToHex(color.r ?? 0, color.g ?? 0, color.b ?? 0);
}

function colorFromHex(hex) {
  const { r, g, b } = hexToRgb(hex);
  const { c, m, y, k } = hexToCmyk(hex);
  return { r, g, b, c, m, y, k, hex };
}

export function useColorResources(template, setTemplate) {

  const addColor = useCallback((initialProps = {}) => {
    const id = `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.colors ?? [];
      const hex = initialProps.hex ?? '#000000';
      const { r, g, b } = hexToRgb(hex);
      const { c, m, y, k } = hexToCmyk(hex);

      let name = initialProps.name;
      if (!name) {
        const base = inferColorName(hex) ?? 'Color';
        const usedNames = new Set(existing.map(col => col.name));
        if (!usedNames.has(base)) {
          name = base;
        } else {
          let n = 2;
          while (usedNames.has(`${base} ${n}`)) n++;
          name = `${base} ${n}`;
        }
      }

      const now = new Date().toISOString();
      return {
        ...t,
        colors: [...existing, {
          id, name,
          type: 'simple',
          colorSpace: 'rgb',
          hex, r, g, b, c, m, y, k,
          alpha: 255,
          spotColor: null,
          mixSpotColor: false,
          cases: [],
          defaultColorId: null,
          createdAt: now,
          updatedAt: now,
          ...initialProps,
          // Always ensure these are computed from hex if only hex was passed
          ...(initialProps.hex && !initialProps.r ? { r, g, b, c, m, y, k } : {}),
        }],
      };
    });
    return id;
  }, [setTemplate]);

  const updateColor = useCallback((id, changes) => {
    // Ignore name-only changes for defaults; block all other edits
    setTemplate(t => {
      const col = (t.colors ?? []).find(c => c.id === id);
      if (col?.isDefault) return t;
      let newHex = null;

      const colors = (t.colors ?? []).map(col => {
        if (col.id !== id) return col;
        let updated = { ...col, ...changes, updatedAt: new Date().toISOString() };

        // Recompute cross-space values when any component changes
        if ('hex' in changes) {
          const derived = colorFromHex(updated.hex);
          updated = { ...updated, ...derived };
        } else if ('r' in changes || 'g' in changes || 'b' in changes) {
          updated.hex = rgbToHex(updated.r ?? 0, updated.g ?? 0, updated.b ?? 0);
          const cmyk = hexToCmyk(updated.hex);
          updated = { ...updated, ...cmyk };
        } else if ('c' in changes || 'm' in changes || 'y' in changes || 'k' in changes) {
          updated.hex = cmykToHex(updated.c ?? 0, updated.m ?? 0, updated.y ?? 0, updated.k ?? 0);
          const rgb = hexToRgb(updated.hex);
          updated = { ...updated, ...rgb };
        } else if ('colorSpace' in changes) {
          updated.hex = recomputeHex(updated);
          const derived = colorFromHex(updated.hex);
          updated = { ...updated, ...derived };
        }

        newHex = updated.hex;
        return updated;
      });

      // Propagate hex change to all fill styles referencing this color
      const fill = newHex != null
        ? (t.styles?.fill ?? []).map(fs =>
            fs.colorId === id
              ? { ...fs, color: newHex, updatedAt: new Date().toISOString() }
              : fs
          )
        : t.styles?.fill ?? [];

      // Propagate to border styles (main lineColor + per-side overrides).
      // Border styles use a denormalized linkage: `lineColorId` is the link;
      // `lineColor` is the cached hex used by render code. We keep both in
      // sync so any updateColor change immediately reflects in every border.
      const border = newHex != null
        ? (t.styles?.border ?? []).map(bs => {
            const mainHit  = bs.lineColorId === id;
            const sides = bs.sides ?? null;
            let sidesChanged = false;
            const newSides = sides
              ? Object.fromEntries(Object.entries(sides).map(([side, sd]) => {
                  if (sd && sd.lineColorId === id) {
                    sidesChanged = true;
                    return [side, { ...sd, lineColor: newHex }];
                  }
                  return [side, sd];
                }))
              : sides;
            if (!mainHit && !sidesChanged) return bs;
            return {
              ...bs,
              ...(mainHit ? { lineColor: newHex } : {}),
              ...(sidesChanged ? { sides: newSides } : {}),
              updatedAt: new Date().toISOString(),
            };
          })
        : t.styles?.border ?? [];

      return { ...t, colors, styles: { ...t.styles, fill, border } };
    });
  }, [setTemplate]);

  const removeColor = useCallback((id) => {
    setTemplate(t => {
      if ((t.colors ?? []).find(c => c.id === id)?.isDefault) return t;
      return {
      ...t,
      colors: (t.colors ?? []).filter(c => c.id !== id),
      // Unlink from fill styles (keep their last color value, just remove the link)
      styles: {
        ...t.styles,
        fill: (t.styles?.fill ?? []).map(fs =>
          fs.colorId === id ? { ...fs, colorId: null } : fs
        ),
      },
    };
    });
  }, [setTemplate]);

  const cloneColor = useCallback((id) => {
    const newId = `col_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.colors ?? [];
      const source = existing.find(c => c.id === id);
      if (!source) return t;
      const now = new Date().toISOString();
      // Strip isDefault so clone is editable
      const { isDefault: _def, ...rest } = source;
      return {
        ...t,
        colors: [...existing, { ...rest, id: newId, name: `${source.name} (copia)`, createdAt: now, updatedAt: now }],
      };
    });
    return newId;
  }, [setTemplate]);

  const getColorUsage = useCallback((id) => {
    const usages = [];
    for (const fs of template?.styles?.fill ?? []) {
      if (fs.colorId === id) usages.push({ type: 'fillStyle', label: fs.name, elementId: fs.id });
    }
    return usages;
  }, [template]);

  const resolveColor = useCallback((colorId) => {
    return (template?.colors ?? []).find(c => c.id === colorId) ?? null;
  }, [template]);

  return { addColor, updateColor, removeColor, cloneColor, getColorUsage, resolveColor };
}
