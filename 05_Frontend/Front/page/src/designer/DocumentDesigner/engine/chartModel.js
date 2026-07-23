// chartModel.js — Registro ÚNICO de tipos de gráfico (familias núcleo).
//
// Fuente de verdad agnóstica de librería. El modelo guardado usa NUESTROS nombres;
// el adaptador (chartPreview.js) traduce a un spec Vega-Lite SOLO para el preview.
// En el back, el mismo modelo se compila al mismo spec y vl-convert (Python) genera
// el gráfico vectorial final → WYSIWYG front/back (mismo motor Vega).

// Familias de F1 (núcleo de negocio). `category` agrupa el comportamiento del
// adaptador; `circular` = pastel/dona (sin ejes cartesianos).
export const CHART_TYPES = [
  { id: 'column',  label: 'Columnas',   category: 'cartesian', circular: false },
  { id: 'bar',     label: 'Barras',     category: 'cartesian', circular: false },
  { id: 'line',    label: 'Línea',      category: 'cartesian', circular: false },
  { id: 'area',    label: 'Área',       category: 'cartesian', circular: false },
  { id: 'scatter', label: 'Dispersión', category: 'cartesian', circular: false },
  { id: 'bubble',  label: 'Burbujas',   category: 'cartesian', circular: false },
  { id: 'heatmap', label: 'Mapa de calor', category: 'matrix', circular: false },
  { id: 'funnel',  label: 'Embudo',     category: 'funnel',    circular: false },
  { id: 'pie',     label: 'Pastel',     category: 'circular',  circular: true },
  { id: 'donut',   label: 'Dona',       category: 'circular',  circular: true },
];

// ¿Tiene ejes de VALOR editables? (no: pastel, dona, embudo, mapa de calor)
export function hasAxes(id) {
  const c = getChartType(id);
  return !c.circular && c.id !== 'funnel' && c.id !== 'heatmap';
}

// ¿Admite apilado (stacked / 100%)? Solo columnas, barras y área con varias series.
export function supportsStacking(id) {
  return id === 'column' || id === 'bar' || id === 'area';
}
// ¿Admite combo barra+línea (algunas series como línea)? Columnas y barras.
export function supportsCombo(id) {
  return id === 'column' || id === 'bar';
}

const BY_ID = Object.fromEntries(CHART_TYPES.map(c => [c.id, c]));

export function getChartType(id) {
  return BY_ID[id] ?? CHART_TYPES[0];
}

export function isCircular(id) {
  return !!getChartType(id).circular;
}

// Paleta por defecto cuando un valor/serie no tiene color asignado (fillRef).
export const DEFAULT_PALETTE = [
  '#1e40af', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  '#6366f1', '#f97316', '#84cc16', '#06b6d4',
];

export function paletteColor(i) {
  return DEFAULT_PALETTE[i % DEFAULT_PALETTE.length];
}

// Valores aleatorios para "Rellenar aleatorio" (0.00–9.00, 2 decimales).
export function randomValue() {
  return Math.round(Math.random() * 900) / 100;
}

// Etiquetas por defecto de categorías: '1', '2', ….
export function defaultCategories(n) {
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

// ── Operaciones de modelo compartidas (modal + panel) ───────────────────────
// Devuelven el PARCHE de campos a aplicar (categories/series), no mutan.

export function resizeValues(model, n) {
  n = Math.max(1, Math.min(50, n | 0));
  const cats = (model.categories ?? []).slice(0, n);
  while (cats.length < n) cats.push(String(cats.length + 1));
  const series = (model.series ?? []).map(s => {
    const vals = (s.values ?? []).slice(0, n);
    while (vals.length < n) vals.push({ value: 0, fillRef: null });
    return { ...s, values: vals };
  });
  return { categories: cats, series };
}

export function resizeSeries(model, n) {
  n = Math.max(1, Math.min(12, n | 0));
  const len = (model.categories ?? []).length || 5;
  const series = (model.series ?? []).slice(0, n);
  while (series.length < n) {
    series.push({
      id: `ser_${Date.now()}_${series.length}_${Math.floor(Math.random() * 1e4)}`,
      name: `Serie ${series.length + 1}`,
      visible: true, fillRef: null, borderRef: null,
      values: Array.from({ length: len }, () => ({ value: 0, fillRef: null })),
    });
  }
  return { series };
}

export function randomizeValues(model) {
  return { series: (model.series ?? []).map(s => ({ ...s, values: (s.values ?? []).map(v => ({ ...v, value: randomValue() })) })) };
}
