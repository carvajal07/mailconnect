// useBulletNumbering.js — CRUD del recurso "Viñetas y numeración" para useDesignerState
//
// El recurso vive en template.styles.bulletNumbering[] y es referenciado por
// paragraphStyle.bulletNumberingId (modelo de viñetas/numeración).

import { useCallback } from 'react';
import { createBulletNumbering } from '../../engine/elementFactory.js';

export function useBulletNumbering(template, setTemplate) {

  const addBulletNumbering = useCallback((overrides = {}) => {
    const item = createBulletNumbering(overrides);
    setTemplate(t => {
      const existing = t.styles?.bulletNumbering ?? [];
      const usedNums = existing
        .map(s => s.name?.match(/^Viñeta\s*(\d+)$/)?.[1])
        .filter(Boolean).map(Number);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      const named = overrides.name ? item : { ...item, name: `Viñeta ${next}` };
      return { ...t, styles: { ...t.styles, bulletNumbering: [...existing, named] } };
    });
    return item.id;
  }, [setTemplate]);

  const updateBulletNumbering = useCallback((id, changes) => {
    setTemplate(t => ({
      ...t,
      styles: {
        ...t.styles,
        bulletNumbering: (t.styles?.bulletNumbering ?? []).map(s =>
          s.id === id ? { ...s, ...changes } : s
        ),
      },
    }));
  }, [setTemplate]);

  const removeBulletNumbering = useCallback((id) => {
    setTemplate(t => ({
      ...t,
      styles: {
        ...t.styles,
        bulletNumbering: (t.styles?.bulletNumbering ?? []).filter(s => s.id !== id),
        // Limpia las referencias colgantes en estilos de párrafo
        paragraph: (t.styles?.paragraph ?? []).map(p =>
          p.bulletNumberingId === id ? { ...p, bulletNumberingId: null } : p
        ),
      },
    }));
  }, [setTemplate]);

  const cloneBulletNumbering = useCallback((id) => {
    const newId = createBulletNumbering().id;
    setTemplate(t => {
      const existing = t.styles?.bulletNumbering ?? [];
      const source = existing.find(s => s.id === id);
      if (!source) return t;
      return {
        ...t,
        styles: {
          ...t.styles,
          bulletNumbering: [...existing, { ...source, id: newId, name: `${source.name} (copia)` }],
        },
      };
    });
    return newId;
  }, [setTemplate]);

  const getBulletNumberingUsage = useCallback((id) => {
    const usages = [];
    for (const ps of template.styles?.paragraph ?? []) {
      if (ps.bulletNumberingId === id) {
        usages.push({ type: 'paragraphStyle', styleId: ps.id, label: ps.name });
      }
    }
    return usages;
  }, [template]);

  return {
    addBulletNumbering, updateBulletNumbering, removeBulletNumbering,
    cloneBulletNumbering, getBulletNumberingUsage,
  };
}
