// useAssetResources.js — Image + Font asset pool management for useDesignerState

import { useCallback } from 'react';

const DEFAULT_IMAGE_PROPS = {
  useImageDpi: true, dpiX: 96, dpiY: 96,
  resizeWidth: false, resizeHeight: false,
  resizeWidthValue: 50, resizeHeightValue: 50,
  resizeUnit: 'mm', maintainAspectRatio: true,
  useDifferentSizeForHtml: false, htmlWidth: '', htmlHeight: '',
  altText: '', useAlphaChannel: true,
};

export function useAssetResources(setTemplate) {

  // ── Image Assets ────────────────────────────────────────────────────────────

  const addImageAsset = useCallback(({ kind = 'static', name: forceName, defaultImageId } = {}) => {
    const id  = `img_asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    setTemplate(t => {
      const existing = t.images ?? [];
      const usedNums = existing
        .map(img => img.name?.match(/^Imagen\s*(\d+)$/)?.[1])
        .filter(Boolean).map(Number);
      const next = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      const name = forceName ?? `Imagen ${next}`;
      const asset = kind === 'variable'
        ? {
            id, name, assetKind: 'variable', source: null,
            properties: { ...DEFAULT_IMAGE_PROPS },
            variableConfig: {
              mode: 'variable', variableField: '',
              defaultImageId: defaultImageId ?? '',
              sampleImageId:  defaultImageId ?? '',
              mappings: [],
            },
            createdAt: now, updatedAt: now,
          }
        : {
            id, name, assetKind: 'static',
            source: { kind: 'static', url: '' },
            properties: { ...DEFAULT_IMAGE_PROPS },
            variableConfig: null,
            createdAt: now, updatedAt: now,
          };
      return { ...t, images: [...existing, asset] };
    });
    return id;
  }, [setTemplate]);

  const updateImageAsset = useCallback((id, changes) => {
    setTemplate(t => ({
      ...t,
      images: (t.images ?? []).map(img =>
        img.id === id ? { ...img, ...changes, updatedAt: new Date().toISOString() } : img
      ),
    }));
  }, [setTemplate]);

  const removeImageAsset = useCallback((id) => {
    setTemplate(t => ({
      ...t,
      images: (t.images ?? []).filter(img => img.id !== id),
    }));
  }, [setTemplate]);

  // ── Font Assets ─────────────────────────────────────────────────────────────

  const addFont = useCallback(({ name, family, variants = [] } = {}) => {
    const id  = `fnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    setTemplate(t => {
      const existing = t.fonts ?? [];
      const usedNums = existing
        .map(f => f.name?.match(/^Fuente\s*(\d+)$/)?.[1])
        .filter(Boolean).map(Number);
      const next     = usedNums.length > 0 ? Math.max(...usedNums) + 1 : existing.length + 1;
      const fontName = name ?? `Fuente ${next}`;
      return {
        ...t,
        fonts: [...existing, { id, name: fontName, family: family ?? fontName, variants, createdAt: now, updatedAt: now }],
      };
    });
    return id;
  }, [setTemplate]);

  const updateFont = useCallback((id, changes) => {
    setTemplate(t => ({
      ...t,
      fonts: (t.fonts ?? []).map(f =>
        f.id === id ? { ...f, ...changes, updatedAt: new Date().toISOString() } : f
      ),
    }));
  }, [setTemplate]);

  const removeFont = useCallback((id) => {
    setTemplate(t => ({
      ...t,
      fonts: (t.fonts ?? []).filter(f => f.id !== id),
    }));
  }, [setTemplate]);

  return { addImageAsset, updateImageAsset, removeImageAsset, addFont, updateFont, removeFont };
}
