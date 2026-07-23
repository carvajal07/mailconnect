// src/nodes/ScriptProcessor/engine/scriptHelpers.js
// Utility functions injected into every user script as `helpers`.
// All functions are pure and side-effect-free.

export const helpers = {

  // ── Strings ────────────────────────────────────────────────────────────────

  capitalize: (s) =>
    s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).toLowerCase() : s,

  titleCase: (s) =>
    String(s ?? '').replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),

  truncate: (s, n = 100, suffix = '…') =>
    String(s ?? '').length > n ? String(s).slice(0, n) + suffix : String(s ?? ''),

  slugify: (s) =>
    String(s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, ''),

  padStart: (s, len, char = '0') => String(s ?? '').padStart(len, char),
  padEnd:   (s, len, char = ' ') => String(s ?? '').padEnd(len, char),

  trim:    (s) => String(s ?? '').trim(),
  lower:   (s) => String(s ?? '').toLowerCase(),
  upper:   (s) => String(s ?? '').toUpperCase(),

  replace: (s, search, replacement = '') =>
    String(s ?? '').replace(new RegExp(String(search), 'g'), replacement),

  // ── Validación ─────────────────────────────────────────────────────────────

  isEmail: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s ?? '')),

  isPhone: (s) => /^\+?[\d\s\-()\\.]{7,20}$/.test(String(s ?? '')),

  isEmpty: (v) =>
    v === null ||
    v === undefined ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0),

  isNumber: (v) => !isNaN(parseFloat(v)) && isFinite(v),

  inRange: (n, min, max) => Number(n) >= min && Number(n) <= max,

  // ── Números ────────────────────────────────────────────────────────────────

  round:   (n, decimals = 2) => Math.round(Number(n) * 10 ** decimals) / 10 ** decimals,
  floor:   (n) => Math.floor(Number(n)),
  ceil:    (n) => Math.ceil(Number(n)),
  clamp:   (n, min, max) => Math.min(Math.max(Number(n), min), max),
  abs:     (n) => Math.abs(Number(n)),
  percent: (part, total) => total === 0 ? 0 : Math.round((Number(part) / Number(total)) * 10000) / 100,

  formatNumber: (n, locale = 'es-ES', opts = {}) =>
    Number(n).toLocaleString(locale, opts),

  formatCurrency: (n, currency = 'EUR', locale = 'es-ES') =>
    Number(n).toLocaleString(locale, { style: 'currency', currency }),

  // ── Fechas ─────────────────────────────────────────────────────────────────

  isoNow: () => new Date().toISOString(),

  formatDate: (d, locale = 'es-ES', opts = {}) =>
    new Date(d).toLocaleDateString(locale, opts),

  formatDateTime: (d, locale = 'es-ES') =>
    new Date(d).toLocaleString(locale),

  dateDiff: (a, b, unit = 'days') => {
    const ms  = new Date(b) - new Date(a);
    const map = { ms: 1, seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };
    return Math.floor(ms / (map[unit] ?? map.days));
  },

  addDays: (d, n) => {
    const date = new Date(d);
    date.setDate(date.getDate() + n);
    return date.toISOString();
  },

  // ── Arrays ─────────────────────────────────────────────────────────────────

  groupBy: (arr, key) =>
    (arr ?? []).reduce((acc, item) => {
      const k = typeof key === 'function' ? key(item) : item[key];
      (acc[k] ??= []).push(item);
      return acc;
    }, {}),

  sumBy: (arr, key) =>
    (arr ?? []).reduce((acc, item) =>
      acc + (Number(typeof key === 'function' ? key(item) : item[key]) || 0), 0),

  avgBy: (arr, key) => {
    if (!arr?.length) return 0;
    const total = arr.reduce((acc, item) =>
      acc + (Number(typeof key === 'function' ? key(item) : item[key]) || 0), 0);
    return total / arr.length;
  },

  unique: (arr, key) =>
    key
      ? [...new Map((arr ?? []).map((i) => [i[key], i])).values()]
      : [...new Set(arr ?? [])],

  sortBy: (arr, key, dir = 'asc') =>
    [...(arr ?? [])].sort((a, b) => {
      const av = typeof key === 'function' ? key(a) : a[key];
      const bv = typeof key === 'function' ? key(b) : b[key];
      return dir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    }),

  filterBy: (arr, key, value) =>
    (arr ?? []).filter((item) =>
      typeof key === 'function' ? key(item) : item[key] === value),

  first: (arr, n = 1) => n === 1 ? (arr ?? [])[0] : (arr ?? []).slice(0, n),
  last:  (arr, n = 1) => n === 1 ? (arr ?? [])[(arr ?? []).length - 1] : (arr ?? []).slice(-n),
  chunk: (arr, size) => {
    const result = [];
    for (let i = 0; i < (arr ?? []).length; i += size) result.push(arr.slice(i, i + size));
    return result;
  },

  // ── Objetos ────────────────────────────────────────────────────────────────

  pick: (obj, keys) =>
    Object.fromEntries((keys ?? []).filter((k) => k in (obj ?? {})).map((k) => [k, obj[k]])),

  omit: (obj, keys) =>
    Object.fromEntries(Object.entries(obj ?? {}).filter(([k]) => !(keys ?? []).includes(k))),

  deepClone: (obj) => structuredClone(obj),

  merge: (...objs) => Object.assign({}, ...objs),

  get: (obj, path, fallback = undefined) => {
    const parts = String(path).split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return fallback;
      cur = cur[p];
    }
    return cur ?? fallback;
  },

  // ── Utilitarios ────────────────────────────────────────────────────────────

  generateId: () =>
    Math.random().toString(36).slice(2, 9) + Date.now().toString(36),

  sleep: (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)), // nota: solo en contextos async
};
