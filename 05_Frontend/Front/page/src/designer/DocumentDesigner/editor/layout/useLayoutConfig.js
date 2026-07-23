// layout/useLayoutConfig.js — Persisted layout config hook

import { useState, useCallback } from 'react';
import { DEFAULT_LAYOUT, ZONE_IDS } from './layoutConfig.js';

const STORAGE_KEY = 'dde-layout-config-v5';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Validate: must have all zones as arrays
    if (ZONE_IDS.every(z => Array.isArray(parsed[z]))) {
      return { ...parsed, splitZones: Array.isArray(parsed.splitZones) ? parsed.splitZones : [] };
    }
  } catch {}
  return null;
}

function saveToStorage(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {}
}

export function useLayoutConfig() {
  const [layout, setLayoutState] = useState(() => loadFromStorage() ?? DEFAULT_LAYOUT);

  const setLayout = useCallback((newLayout) => {
    setLayoutState(newLayout);
    saveToStorage(newLayout);
  }, []);

  const resetLayout = useCallback(() => {
    setLayoutState(DEFAULT_LAYOUT);
    saveToStorage(DEFAULT_LAYOUT);
  }, []);

  return { layout, setLayout, resetLayout };
}
