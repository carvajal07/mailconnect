// useTextParagraphStyles.js — Text + Paragraph style CRUD for useDesignerState

import { useCallback } from 'react';
import {
  findMatchingStyle, buildStyleName, uniqueStyleName,
  extractStyleProps, resolveTextStyle,
} from '../../engine/textStyleUtils.js';
import {
  findMatchingParagraphStyle, buildParagraphStyleName, uniqueParagraphStyleName,
  extractParagraphStyleProps, resolveParagraphStyle,
} from '../../engine/paragraphStyleUtils.js';
import { DEFAULT_TEXT_STYLE_ID, DEFAULT_PARAGRAPH_STYLE_ID, DEFAULT_FILL_STYLE_ID, createDefaultParagraphStyle } from '../../engine/elementFactory.js';

export function useTextParagraphStyles(template, setTemplate) {

  // ── Text Styles ─────────────────────────────────────────────────────────────

  const addTextStyle = useCallback(() => {
    const id = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.text ?? [];
      const usedNums = existing
        .map(s => s.name?.match(/^Nuevo estilo de texto\s*(\d+)$/)?.[1])
        .filter(Boolean).map(Number);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      return {
        ...t,
        styles: {
          ...t.styles,
          text: [...existing, {
            id, name: `Nuevo estilo de texto ${next}`,
            fontFamily: 'Inter', fontWeight: 'Regular', fontSize: 11,
            color: '#1f2937', fillStyleId: DEFAULT_FILL_STYLE_ID, italic: false, smallCaps: false,
            letterSpacing: 0, lineHeight: 1.4, textTransform: 'none',
            kerning: true, horizontalScale: 100, baselineShift: 0,
            superscript: false, subscript: false,
            superscriptOffset: 33, subscriptOffset: 33, superSubSize: 58, smallCapsSize: 70,
            underline: false, strikethrough: false,
            underlineStyleId: null, strikethroughStyleId: null, customUnderlineStrike: false,
            underlineOffset: 10.6, underlineWidth: 7.3, strikethroughOffset: 23.6, strikethroughWidth: 7.3,
            borderStyleId: null, connectBorders: false,
          }],
        },
      };
    });
    return id;
  }, [setTemplate]);

  const updateTextStyle = useCallback((id, changes) => {
    setTemplate(t => {
      if ((t.styles?.text ?? []).find(s => s.id === id)?.isDefault) return t;
      return {
        ...t,
        styles: { ...t.styles, text: (t.styles?.text ?? []).map(s => s.id === id ? { ...s, ...changes } : s) },
      };
    });
  }, [setTemplate]);

  const removeTextStyle = useCallback((id) => {
    if (id === DEFAULT_TEXT_STYLE_ID) return;
    setTemplate(t => {
      if ((t.styles?.text ?? []).find(s => s.id === id)?.isDefault) return t;
      return {
        ...t,
        styles: { ...t.styles, text: (t.styles?.text ?? []).filter(s => s.id !== id) },
      };
    });
  }, [setTemplate]);

  const cloneTextStyle = useCallback((id) => {
    const newId = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.text ?? [];
      const source = existing.find(s => s.id === id);
      if (!source) return t;
      const { isDefault: _def, ...rest } = source;
      return { ...t, styles: { ...t.styles, text: [...existing, { ...rest, id: newId, name: `${source.name} (copia)` }] } };
    });
    return newId;
  }, [setTemplate]);

  const findOrCreateTextStyle = useCallback((currentStyleId, changes) => {
    const styles = template.styles?.text ?? [];
    const current = resolveTextStyle(currentStyleId, styles);
    const merged = { ...extractStyleProps(current), ...changes };
    const match = findMatchingStyle(styles, merged);
    if (match) return match.id;
    const id = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const name = uniqueStyleName(buildStyleName(merged), styles);
    setTemplate(t => ({
      ...t,
      styles: { ...t.styles, text: [...(t.styles?.text ?? []), { id, name, ...merged }] },
    }));
    return id;
  }, [template, setTemplate]);

  const getTextStyleUsage = useCallback((textStyleId) => {
    const usages = [];
    for (const page of template.pages ?? []) {
      for (const el of page.elements ?? []) {
        if (el.type === 'text' && el.textStyleId === textStyleId) {
          usages.push({ type: 'element', pageId: page.id, pageName: page.name, elementId: el.id, label: el.label });
        }
      }
    }
    function searchAreas(areas) {
      for (const area of areas ?? []) {
        if (area.defaultTextStyleId === textStyleId) usages.push({ type: 'area', areaId: area.id, label: area.label });
        if ((area.inlineStyleRefs ?? []).includes(textStyleId)) usages.push({ type: 'inline', areaId: area.id, label: area.label });
        for (const el of area.elements ?? []) {
          if (el.type === 'text' && el.textStyleId === textStyleId) {
            usages.push({ type: 'element-in-area', areaId: area.id, elementId: el.id, label: el.label });
          }
        }
        if (area.children?.length) searchAreas(area.children);
      }
    }
    searchAreas(template.contentAreas);
    return usages;
  }, [template]);

  // ── Paragraph Styles ────────────────────────────────────────────────────────

  const addParagraphStyle = useCallback(() => {
    const id = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.paragraph ?? [];
      const usedNums = existing
        .map(s => s.name?.match(/^Nuevo estilo de párrafo\s*(\d+)$/)?.[1])
        .filter(Boolean).map(Number);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      return {
        ...t,
        styles: { ...t.styles, paragraph: [...existing, { ...createDefaultParagraphStyle(), id, name: `Nuevo estilo de párrafo ${next}` }] },
      };
    });
    return id;
  }, [setTemplate]);

  const updateParagraphStyle = useCallback((id, changes) => {
    setTemplate(t => {
      if ((t.styles?.paragraph ?? []).find(s => s.id === id)?.isDefault) return t;
      return {
        ...t,
        styles: { ...t.styles, paragraph: (t.styles?.paragraph ?? []).map(s => s.id === id ? { ...s, ...changes } : s) },
      };
    });
  }, [setTemplate]);

  const removeParagraphStyle = useCallback((id) => {
    if (id === DEFAULT_PARAGRAPH_STYLE_ID) return;
    setTemplate(t => {
      if ((t.styles?.paragraph ?? []).find(s => s.id === id)?.isDefault) return t;
      return {
        ...t,
        styles: { ...t.styles, paragraph: (t.styles?.paragraph ?? []).filter(s => s.id !== id) },
      };
    });
  }, [setTemplate]);

  const cloneParagraphStyle = useCallback((id) => {
    const newId = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setTemplate(t => {
      const existing = t.styles?.paragraph ?? [];
      const source = existing.find(s => s.id === id);
      if (!source) return t;
      const { isDefault: _def, ...rest } = source;
      return { ...t, styles: { ...t.styles, paragraph: [...existing, { ...rest, id: newId, name: `${source.name} (copia)` }] } };
    });
    return newId;
  }, [setTemplate]);

  const getParagraphStyleUsage = useCallback((paragraphStyleId) => {
    const usages = [];
    for (const page of template.pages ?? []) {
      for (const el of page.elements ?? []) {
        if (el.paragraphStyleId === paragraphStyleId) {
          usages.push({ type: 'element', pageId: page.id, pageName: page.name, elementId: el.id, label: el.label });
        }
      }
    }
    function searchAreas(areas) {
      for (const area of areas ?? []) {
        if (area.paragraphStyleId === paragraphStyleId) usages.push({ type: 'area', areaId: area.id, label: area.label });
        for (const el of area.elements ?? []) {
          if (el.paragraphStyleId === paragraphStyleId) {
            usages.push({ type: 'element-in-area', areaId: area.id, elementId: el.id, label: el.label });
          }
        }
        if (area.children?.length) searchAreas(area.children);
      }
    }
    searchAreas(template.contentAreas);
    return usages;
  }, [template]);

  const findOrCreateParagraphStyle = useCallback((currentStyleId, changes) => {
    const styles = template.styles?.paragraph ?? [];
    const current = resolveParagraphStyle(currentStyleId, styles);
    const merged = { ...extractParagraphStyleProps(current), ...changes };
    const match = findMatchingParagraphStyle(styles, merged);
    if (match) return match.id;
    const id = `ps_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const name = uniqueParagraphStyleName(buildParagraphStyleName(merged), styles);
    setTemplate(t => ({
      ...t,
      styles: { ...t.styles, paragraph: [...(t.styles?.paragraph ?? []), { id, name, ...merged }] },
    }));
    return id;
  }, [template, setTemplate]);

  return {
    addTextStyle, updateTextStyle, removeTextStyle, cloneTextStyle,
    findOrCreateTextStyle, getTextStyleUsage,
    addParagraphStyle, updateParagraphStyle, removeParagraphStyle, cloneParagraphStyle,
    findOrCreateParagraphStyle, getParagraphStyleUsage,
  };
}
