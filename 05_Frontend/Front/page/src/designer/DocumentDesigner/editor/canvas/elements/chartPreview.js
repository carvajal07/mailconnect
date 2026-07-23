// chartPreview.js — Adaptador de PREVIEW del gráfico.
//
// ÚNICO archivo que conoce Vega/Vega-Lite. Traduce NUESTRO modelo limpio →
// spec Vega-Lite y lo renderiza a un string SVG para el editor. En el back, el
// mismo modelo se compila al MISMO spec y vl-convert (Python) genera el gráfico
// vectorial final → WYSIWYG (mismo motor Vega). Vega se carga de forma diferida
// (import dinámico) para no inflar el bundle principal.

import { isCircular, paletteColor } from '../../../engine/chartModel.js';

let _vega = null;
let _vl = null;
async function loadLibs() {
  if (!_vega) _vega = import('vega');
  if (!_vl) _vl = import('vega-lite');
  const [vega, vl] = await Promise.all([_vega, _vl]);
  return { vega, vl };
}

// Resuelve una ref de color (fill style o color del documento) → hex.
function resolveColor(ref, fillStyles, colors, fallback) {
  if (!ref) return fallback;
  const fs = (fillStyles ?? []).find(s => s.id === ref);
  if (fs) {
    if (fs.type === 'solid' && fs.color) return fs.color;
    if (fs.type === 'gradient' && fs.gradient?.stops?.length) return fs.gradient.stops[0].color ?? fallback;
  }
  const col = (colors ?? []).find(c => c.id === ref);
  if (col?.hex) return col.hex;
  return fallback;
}

// Formatea un valor de muestra (mockValue) para mostrarlo como texto.
function fmtSample(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (x == null ? '' : String(x))).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// Texto fijo o variable. Si hay texto fijo, gana. Si solo hay variable: en modo
// preview (varPreview) muestra su valor de muestra; si no, el token «{{path}}».
function textOrVar(text, varPath, varPreview) {
  if (text != null && String(text).trim() !== '') return text;
  if (varPath) {
    if (varPreview && varPreview[varPath] != null) return fmtSample(varPreview[varPath]);
    return `{{${varPath}}}`;
  }
  return null;
}

function axisCfg(axisModel, varPreview) {
  const cfg = {
    title: textOrVar(axisModel?.title, axisModel?.titleVar, varPreview),
    labels: axisModel?.showLabels !== false,
  };
  const tk = axisModel?.tickStyle;
  if (tk === 'none')        cfg.ticks = false;
  else if (tk === 'inside') { cfg.ticks = true; cfg.tickSize = -5; }
  else if (tk)              cfg.ticks = true;   // outside / cross
  if (axisModel?.axisLineWidth != null && axisModel?.axisLineWidth !== '') cfg.domainWidth = Number(axisModel.axisLineWidth);
  return cfg;
}

const SYMBOLS = { square: 'square', circle: 'circle', cross: 'cross', diamond: 'diamond', triangle: 'triangle-up' };

function legendCfg(legend, textStyles) {
  const cfg = {
    orient: legend?.position ?? 'right',
    title: null,
    direction: legend?.direction ?? 'vertical',
  };
  if (legend?.symbolType && SYMBOLS[legend.symbolType]) cfg.symbolType = SYMBOLS[legend.symbolType];
  const ts = (textStyles ?? []).find(t => t.id === legend?.textStyleId);
  if (ts) {
    if (ts.fontFamily) cfg.labelFont = ts.fontFamily;
    if (ts.fontSize)   cfg.labelFontSize = Number(ts.fontSize);
    if (ts.color)      cfg.labelColor = ts.color;
  }
  return cfg;
}

// Añade líneas de referencia (rule + label opcional) al spec sobre el eje de valor.
function appendRefLines(spec, lines, horizontal, varPreview) {
  const marks = [];
  (lines ?? []).filter(l => l && l.value != null && l.value !== '').forEach(l => {
    const color = l.color || '#ef4444';
    const val = Number(l.value);
    marks.push({
      mark: { type: 'rule', strokeDash: [5, 4], strokeWidth: 1.5 },
      encoding: { [horizontal ? 'x' : 'y']: { datum: val }, color: { value: color } },
    });
    const labelText = textOrVar(l.label, l.labelVar, varPreview);
    if (labelText) {
      marks.push({
        mark: { type: 'text', align: horizontal ? 'center' : 'right', baseline: 'bottom', dx: horizontal ? 0 : -3, dy: -2, fontSize: 9 },
        encoding: { [horizontal ? 'x' : 'y']: { datum: val }, text: { value: labelText }, color: { value: color } },
      });
    }
  });
  if (!marks.length) return spec;
  if (spec.layer) return { ...spec, layer: [...spec.layer, ...marks] };
  const { mark, encoding, ...rest } = spec;
  return { ...rest, layer: [{ mark, encoding }, ...marks] };
}

// Antepone bandas (stripes) de color en el eje de valor (rect layers de fondo).
function prependStripes(spec, stripes, horizontal) {
  const rects = (stripes ?? [])
    .filter(s => s && s.from != null && s.from !== '' && s.to != null && s.to !== '')
    .map(s => ({
      mark: { type: 'rect', opacity: s.opacity ?? 0.18 },
      encoding: {
        [horizontal ? 'x' : 'y']:  { datum: Number(s.from) },
        [horizontal ? 'x2' : 'y2']: { datum: Number(s.to) },
        color: { value: s.color || '#fbbf24' },
      },
    }));
  if (!rects.length) return spec;
  if (spec.layer) return { ...spec, layer: [...rects, ...spec.layer] };
  const { mark, encoding, ...rest } = spec;
  return { ...rest, layer: [...rects, { mark, encoding }] };
}

// Capa de texto para etiquetas de dato (valor o porcentaje), con posición,
// rotación y estilo de texto (resuelto desde Recursos).
function labelTextLayer(pl, baseEncoding, fmt, horizontal, textStyles) {
  const pos = pl?.position ?? 'outside';
  const ts  = (textStyles ?? []).find(t => t.id === pl?.textStyleId);
  const off = Number(pl?.offset) || 0;
  const mark = { type: 'text', angle: Number(pl?.rotation) || 0 };
  if (horizontal) {
    mark.align = pos === 'inside' ? 'right' : pos === 'center' ? 'center' : 'left';
    mark.dx = (pos === 'inside' ? -4 : pos === 'center' ? 0 : 4) + off;
    mark.baseline = 'middle';
  } else {
    mark.baseline = pos === 'inside' ? 'top' : pos === 'center' ? 'middle' : 'bottom';
    mark.dy = (pos === 'inside' ? 4 : pos === 'center' ? 0 : -4) - off;
  }
  if (pl?.formatWidth != null && pl?.formatWidth !== '') mark.limit = Number(pl.formatWidth);
  if (ts?.fontSize)   mark.fontSize = Number(ts.fontSize);
  if (ts?.fontFamily) mark.font = ts.fontFamily;
  const enc = { ...baseEncoding, color: { value: ts?.color || '#1e293b' } };
  let transform;
  if ((pl?.content ?? 'value') === 'percent') {
    transform = [
      { joinaggregate: [{ op: 'sum', field: 'val', as: '_tot' }] },
      { calculate: 'datum._tot ? datum.val / datum._tot : 0', as: '_pct' },
    ];
    enc.text = { field: '_pct', type: 'quantitative', format: '.0%' };
  } else {
    enc.text = { field: 'val', type: 'quantitative', format: fmt ?? '.2f' };
  }
  return { ...(transform ? { transform } : {}), mark, encoding: enc };
}

// Modelo → spec Vega-Lite (efímero, solo preview).
export function modelToVegaLite(model, { width, height, fillStyles, colors, textStyles, varPreview } = {}) {
  const type     = model.chartType ?? 'column';
  const circular = isCircular(type);
  const series   = (model.series ?? []).filter(s => s.visible !== false);
  const single   = series.length <= 1;
  const ctxFill  = fillStyles ?? [];
  const ctxCol   = colors ?? [];
  const stacking = (type === 'column' || type === 'bar' || type === 'area') ? (model.stacking ?? 'none') : 'none';
  const lineCount = (type === 'column' || type === 'bar') ? Math.min(model.lineSeriesCount ?? 0, Math.max(0, series.length - 1)) : 0;
  const showLabels = !!model.pointLabels?.show;
  const yAxis = model.axes?.y ?? {};
  const fmt = (yAxis.decimals != null && yAxis.decimals !== '') ? `.${yAxis.decimals}f` : null;

  // Categorías: en preview, si el eje X tiene labelsVar resuelto a un array, úsalo.
  let cats = model.categories ?? [];
  if (varPreview && Array.isArray(varPreview[model.axes?.x?.labelsVar])) {
    cats = varPreview[model.axes.x.labelsVar].map(String);
  }

  // Filas de datos: una por (serie × categoría). `low` = valor base (lowest por
  // punto, o baseline del eje) usado por barras para dibujar desde ahí.
  const axisBaseline = Number(yAxis.baseline ?? 0) || 0;
  const lineNames = series.slice(series.length - lineCount).map((s, i) => s.name || `Serie ${series.length - lineCount + i + 1}`);
  const values = [];
  let hasLowest = false;
  series.forEach((s, si) => {
    const sname = s.name || `Serie ${si + 1}`;
    // En preview: la serie 0 puede venir de un array variable; cada valor de su variable.
    let sVals = s.values ?? [];
    if (varPreview && si === 0 && model.dataBinding?.mode === 'variable' && Array.isArray(varPreview[model.dataBinding?.valuesArrayVar])) {
      sVals = varPreview[model.dataBinding.valuesArrayVar].map(n => ({ value: Number(n) || 0 }));
    }
    sVals.forEach((v, vi) => {
      let val = Number(v.value) || 0;
      if (varPreview && v.valueVar && varPreview[v.valueVar] != null) val = Number(varPreview[v.valueVar]) || 0;
      const low = (v.lowest != null && v.lowest !== '') ? Number(v.lowest) : axisBaseline;
      if (low) hasLowest = true;
      values.push({ cat: cats[vi] ?? String(vi + 1), val, ser: sname, low });
    });
  });

  // Color: por categoría (pastel/dona/embudo y barras de 1 serie) o por serie.
  const colorByCat = circular || type === 'funnel' || (single && (type === 'bar' || type === 'column'));
  let domain, range, colorField;
  if (colorByCat) {
    colorField = 'cat';
    domain = cats;
    range  = cats.map((c, i) => resolveColor(series[0]?.values?.[i]?.fillRef, ctxFill, ctxCol, paletteColor(i)));
  } else {
    colorField = 'ser';
    domain = series.map((s, si) => s.name || `Serie ${si + 1}`);
    range  = series.map((s, si) => resolveColor(s.fillRef, ctxFill, ctxCol, paletteColor(si)));
  }
  // Esquema de color (override de los colores propios) o rango explícito.
  const colorScale = model.colorScheme ? { scheme: model.colorScheme } : { domain, range };
  const colorEnc = {
    field: colorField, type: 'nominal',
    scale: colorScale,
    legend: model.legend?.show ? legendCfg(model.legend, textStyles) : null,
  };

  // Escala del eje de valor: logarítmica o lineal (force-zero) + min/max + nice.
  const valScale = yAxis.log ? { type: 'log' } : { zero: true };
  if (yAxis.min != null && yAxis.min !== '') valScale.domainMin = Number(yAxis.min);
  if (yAxis.max != null && yAxis.max !== '') valScale.domainMax = Number(yAxis.max);
  if (yAxis.nice && !yAxis.log) valScale.nice = true;
  const stackVal = stacking === 'normalize' ? 'normalize' : stacking === 'stacked' ? 'zero' : null;

  // Placement: márgenes (mm→px), relleno de fondo (objeto) y del área de series.
  const MM2PX = 96 / 25.4;
  const pl = model.placement ?? {};
  const padTop = (pl.marginTop || 0) * MM2PX, padBot = (pl.marginBottom || 0) * MM2PX;
  const padLeft = (pl.marginLeft || 0) * MM2PX, padRight = (pl.marginRight || 0) * MM2PX;
  const bgColor = resolveColor(pl.backgroundFillId, ctxFill, ctxCol, null);
  const seriesFill = resolveColor(pl.seriesFillId, ctxFill, ctxCol, null);

  const baseSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width, height,
    autosize: { type: 'fit', contains: 'padding' },
    background: bgColor || null,
    data: { values },
  };
  if (padTop || padBot || padLeft || padRight) baseSpec.padding = { top: padTop, bottom: padBot, left: padLeft, right: padRight };
  if (seriesFill) baseSpec.view = { fill: seriesFill };
  const titleText = textOrVar(model.title, model.titleVar, varPreview);
  if (titleText) {
    const tts = (textStyles ?? []).find(t => t.id === model.titleStyleId);
    baseSpec.title = {
      text: titleText,
      fontSize: tts?.fontSize ? Number(tts.fontSize) : 12,
      ...(tts?.fontFamily ? { font: tts.fontFamily } : {}),
      ...(tts?.color ? { color: tts.color } : {}),
    };
  }

  // Borde de barras/puntos (contorno común).
  const bbColor = resolveColor(model.barBorder?.fillRef, ctxFill, ctxCol, null);
  const bbWidth = Number(model.barBorder?.width) || 0;
  const strokeMark = (bbColor && bbWidth > 0) ? { stroke: bbColor, strokeWidth: bbWidth } : {};

  // ── Circular (pastel / dona) ──
  if (circular) {
    const arc = type === 'donut'
      ? { type: 'arc', innerRadius: Math.max(8, Math.min(width, height) * 0.28) }
      : { type: 'arc' };
    const enc = { theta: { field: 'val', type: 'quantitative', stack: true }, color: colorEnc };
    if (showLabels) {
      const ts = (textStyles ?? []).find(t => t.id === model.pointLabels?.textStyleId);
      const pct = (model.pointLabels?.content ?? 'value') === 'percent';
      const textLayer = {
        ...(pct ? { transform: [
          { joinaggregate: [{ op: 'sum', field: 'val', as: '_tot' }] },
          { calculate: 'datum._tot ? datum.val / datum._tot : 0', as: '_pct' },
        ] } : {}),
        mark: { type: 'text', radius: Math.min(width, height) * 0.38, angle: Number(model.pointLabels?.rotation) || 0,
                ...(ts?.fontSize ? { fontSize: Number(ts.fontSize) } : {}), ...(ts?.fontFamily ? { font: ts.fontFamily } : {}) },
        encoding: {
          theta: { field: 'val', type: 'quantitative', stack: true },
          text: pct ? { field: '_pct', type: 'quantitative', format: '.0%' } : { field: 'val', type: 'quantitative', format: fmt ?? '.2f' },
          color: { value: ts?.color || '#1e293b' },
        },
      };
      return { ...baseSpec, layer: [{ mark: arc, encoding: enc }, textLayer] };
    }
    return { ...baseSpec, mark: arc, encoding: enc };
  }

  // ── Embudo (funnel): barra horizontal centrada (stack 'center'), 1 serie ──
  if (type === 'funnel') {
    return {
      ...baseSpec,
      mark: { type: 'bar' },
      encoding: {
        y: { field: 'cat', type: 'nominal', sort: null, axis: axisCfg(model.axes?.x, varPreview) },
        x: { field: 'val', type: 'quantitative', stack: 'center', axis: null },
        color: colorByCat
          ? { field: 'cat', type: 'nominal', scale: { domain, range }, legend: model.legend?.show ? legendCfg(model.legend, textStyles) : null }
          : colorEnc,
      },
    };
  }

  // ── Mapa de calor: x=categoría, y=serie, color=valor (cuantitativo) ──
  if (type === 'heatmap') {
    const catTypeH = model.axes?.x?.temporal ? 'temporal' : 'nominal';
    const enc = {
      x: { field: 'cat', type: catTypeH, axis: axisCfg(model.axes?.x, varPreview) },
      y: { field: 'ser', type: 'nominal', axis: { title: model.axes?.y?.title || null } },
      color: { field: 'val', type: 'quantitative', scale: { scheme: model.colorScheme || 'blues' },
               legend: model.legend?.show ? legendCfg(model.legend, textStyles) : null },
    };
    if (showLabels) {
      return { ...baseSpec, layer: [
        { mark: { type: 'rect' }, encoding: enc },
        { mark: { type: 'text' }, encoding: { ...enc, color: { value: '#1e293b' }, text: { field: 'val', type: 'quantitative', format: fmt ?? '.2f' } } },
      ] };
    }
    return { ...baseSpec, mark: { type: 'rect' }, encoding: enc };
  }

  // ── Cartesianos ──
  const refLines = model.axes?.y?.lines ?? [];
  const stripes  = model.axes?.y?.stripes ?? [];
  const xAngle   = Number(model.axes?.x?.labelAngle) || 0;
  // Escala de categoría: orden inverso + ancho de barra (paddingInner).
  const catScale = {};
  if (model.categoriesReverse) catScale.reverse = true;
  if ((type === 'column' || type === 'bar') && model.barWidth != null) {
    catScale.paddingInner = Math.max(0, Math.min(0.9, 1 - Number(model.barWidth)));
  }
  const catType = model.axes?.x?.temporal ? 'temporal' : 'nominal';
  const catEnc = { field: 'cat', type: catType, ...(catType === 'nominal' ? { sort: null } : {}),
    axis: { ...axisCfg(model.axes?.x, varPreview), ...(xAngle ? { labelAngle: xAngle } : {}) },
    ...(Object.keys(catScale).length ? { scale: catScale } : {}) };
  const valAxis = {
    ...axisCfg(model.axes?.y, varPreview), grid: yAxis.grid !== false,
    ...(fmt ? { format: fmt } : {}),
    ...(yAxis.tickStep != null && yAxis.tickStep !== '' ? { tickMinStep: Number(yAxis.tickStep) } : {}),
  };
  const valEnc = { field: 'val', type: 'quantitative', scale: valScale, stack: stackVal, axis: valAxis };
  const horizontal = type === 'bar';
  // Barra desde el valor base (lowest por punto o baseline del eje) — solo sin apilar.
  const useLow = hasLowest && (type === 'column' || type === 'bar') && stacking === 'none';
  // Aplica stripes + ref lines a un spec cartesiano (orden: stripes detrás, líneas delante).
  const decorate = (spec) => appendRefLines(prependStripes(spec, stripes, horizontal), refLines, horizontal, varPreview);

  // Combo barra+línea: capas filtradas por nombre de serie.
  if (lineCount > 0) {
    const xE = horizontal ? valEnc : catEnc;
    const yE = horizontal ? catEnc : valEnc;
    return decorate({ ...baseSpec, layer: [
      { transform: [{ filter: { not: { field: 'ser', oneOf: lineNames } } }],
        mark: { type: 'bar', ...strokeMark },
        encoding: { x: xE, y: yE, color: colorEnc,
          ...(useLow ? (horizontal ? { x2: { field: 'low' } } : { y2: { field: 'low' } }) : {}),
          ...(single ? {} : (horizontal ? { yOffset: { field: 'ser' } } : { xOffset: { field: 'ser' } })) } },
      { transform: [{ filter: { field: 'ser', oneOf: lineNames } }],
        mark: { type: 'line', point: true },
        encoding: { x: horizontal ? valEnc : catEnc, y: horizontal ? catEnc : valEnc, color: colorEnc } },
    ] });
  }

  let mark;
  if (type === 'line')         mark = { type: 'line', point: true };
  else if (type === 'area')    mark = { type: 'area', line: true, opacity: 0.85 };
  else if (type === 'scatter') mark = { type: 'point', filled: true, size: 90, ...strokeMark };
  else if (type === 'bubble')  mark = { type: 'point', filled: true, opacity: 0.75, ...strokeMark };
  else                         mark = { type: 'bar', ...strokeMark };
  // Línea punteada (single series): el patrón va en el mark.
  if ((type === 'line' || type === 'area') && single && series[0]?.dashed) mark.strokeDash = [5, 4];

  const encoding = horizontal ? { y: catEnc, x: valEnc, color: colorEnc } : { x: catEnc, y: valEnc, color: colorEnc };
  // Burbujas: el tamaño codifica el valor.
  if (type === 'bubble') encoding.size = { field: 'val', type: 'quantitative', legend: null, scale: { range: [30, 700] } };
  // Línea punteada por serie (multi): codifica strokeDash por serie.
  if ((type === 'line' || type === 'area') && !single && series.some(s => s.dashed)) {
    encoding.strokeDash = {
      field: 'ser', legend: null,
      scale: { domain: series.map((s, si) => s.name || `Serie ${si + 1}`), range: series.map(s => s.dashed ? [5, 4] : [1, 0]) },
    };
  }
  // Barra desde el valor base (lowest/baseline): la barra va de `low` al valor.
  if (useLow) {
    if (type === 'column') encoding.y2 = { field: 'low' };
    if (type === 'bar')    encoding.x2 = { field: 'low' };
  }
  // Agrupado (offset) solo cuando hay varias series y NO está apilado.
  if (!single && stacking === 'none') {
    if (type === 'column') encoding.xOffset = { field: 'ser' };
    if (type === 'bar')    encoding.yOffset = { field: 'ser' };
  }

  if (showLabels) {
    const textLayer = labelTextLayer(model.pointLabels, encoding, fmt, horizontal, textStyles);
    return decorate({ ...baseSpec, layer: [{ mark, encoding }, textLayer] });
  }

  return decorate({ ...baseSpec, mark, encoding });
}

// Renderiza el gráfico a un string SVG. Devuelve { svg } | { error }.
export async function renderChartSVG(model, opts = {}) {
  try {
    const { vega, vl } = await loadLibs();
    const spec = modelToVegaLite(model, opts);
    const vg = vl.compile(spec).spec;
    const view = new vega.View(vega.parse(vg), { renderer: 'none' });
    await view.runAsync();
    const svg = await view.toSVG();
    view.finalize();
    return { svg };
  } catch (e) {
    return { error: e?.message ?? 'No se pudo generar el gráfico' };
  }
}
