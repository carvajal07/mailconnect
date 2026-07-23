// barcodePreview.js — Adaptador de PREVIEW con bwip-js.
//
// Único archivo que conoce la API de bwip-js. Traduce NUESTRO modelo limpio →
// opciones de bwip-js SOLO para dibujar la previsualización en el editor. Su
// salida (SVG) es efímera: nunca se guarda ni se envía al back. Si se cambia la
// librería de preview, solo se toca este archivo.

import { toSVG } from 'bwip-js';
import { getSymbology, is2D, validateBarcodeData } from '../../../engine/barcodeSymbologies.js';

// Resuelve un fill style (ref a Recursos) → color hex. Para barras necesitamos
// un color sólido; si es gradiente tomamos el primer stop.
function fillToHex(fillStyleId, fillStyles, fallback) {
  if (!fillStyleId) return fallback;
  const fs = (fillStyles ?? []).find(s => s.id === fillStyleId);
  if (!fs) return fallback;
  if (fs.type === 'solid' && fs.color) return fs.color;
  if (fs.type === 'gradient' && fs.gradient?.stops?.length) return fs.gradient.stops[0].color ?? fallback;
  return fallback;
}
const noHash = (hex) => (hex ?? '').replace('#', '');

// Factor de diseño (144 DPI): 1 mm = 144/25.4 px ≈ 5.67. bwip usa la misma escala
// en su viewBox, así que el SVG sale a tamaño real (mm) en px de diseño; el zoom
// de la página lo aplica el transform del canvas.
const PX_PER_MM = 144 / 25.4;

// Modelo → opciones bwip-js (efímero, solo preview). SIN texto: el texto de datos
// lo renderiza BarcodeElement por separado (para respetar posición + text style).
function modelToBwip(model, fillStyles) {
  const sym  = getSymbology(model.symbology);
  const data = (model.content?.data ?? '').trim() || sym.sample || sym.label;
  const twoD = is2D(model.symbology);
  const moduleWidth = model.metrics?.moduleWidth ?? 0.33;
  const scale = Math.max(0.5, moduleWidth * PX_PER_MM); // ancho del módulo en px de diseño

  const opts = {
    bcid: sym.bwipId,
    text: data,
    barcolor: noHash(fillToHex(model.style?.barcodeFillId, fillStyles, '#000000')),
  };

  if (twoD) {
    opts.scale = scale;            // módulo cuadrado (X=Y)
  } else {
    opts.scaleX = scale;           // ancho de módulo (X) → refleja moduleWidth
    opts.height = model.metrics?.height ?? 15;  // alto en mm → refleja "Alto"
  }

  const bg = fillToHex(model.style?.backgroundFillId, fillStyles, null);
  if (bg) opts.backgroundcolor = noHash(bg);

  // Opciones por-tipo relevantes para el preview. Traducimos nuestros nombres
  // GENÉRICOS → nombres bwip aquí (este es el único punto de acoplamiento). Las
  // correcciones finas (barWidthNarrow/Wide, ratio, eci, symbolSize, validateString,
  // subsets, checkDigitMode, métrica directa) NO se reflejan en el preview de bwip;
  // viajan en el JSON y las aplica el motor del back.
  const o = model.options ?? {};
  if ((model.symbology === 'qr' || model.symbology === 'gs1qr' || model.symbology === 'microqr') && o.errorCorrection) opts.eclevel = o.errorCorrection;
  if ((model.symbology === 'pdf417' || model.symbology === 'macropdf417')) {
    if (o.errorCorrection && o.errorCorrection !== 'auto') opts.eclevel = Number(o.errorCorrection);
    if (o.truncated) opts.compact = true;
  }
  if ((model.symbology === 'datamatrix' || model.symbology === 'datamatrixresponse') && o.encoding && o.encoding !== 'auto') {
    opts.encoding = o.encoding; // bwip usa los mismos nombres: ascii/c40/text/x12/edifact/base256
  }
  if ((sym.optionFields ?? []).includes('checkDigit') && o.checkDigit) opts.includecheck = true;

  return opts;
}

// Renderiza el SVG del barcode a TAMAÑO REAL (no estirado). Devuelve
// { svg } | { error } | { unsupported }.
export function renderBarcodeSVG(model, fillStyles) {
  const sym = getSymbology(model.symbology);
  // Tipo sin equivalente en bwip-js (simbología propietaria): el back lo genera.
  if (!sym.bwipId) return { unsupported: true };
  const err = validateBarcodeData(model.symbology, model.content?.data ?? '');
  if (err) return { error: err };
  try {
    let svg = toSVG(modelToBwip(model, fillStyles));
    // Fijar el tamaño del SVG a sus unidades de viewBox (px de diseño) → tamaño real.
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    if (vb) {
      const w = vb[1], h = vb[2];
      svg = svg
        .replace(/(<svg[^>]*?)\s+width="[^"]*"/, '$1')
        .replace(/(<svg[^>]*?)\s+height="[^"]*"/, '$1')
        .replace(/<svg /, `<svg width="${w}" height="${h}" style="display:block" `);
    }
    return { svg };
  } catch (e) {
    return { error: e?.message ?? 'Datos inválidos para esta simbología' };
  }
}
