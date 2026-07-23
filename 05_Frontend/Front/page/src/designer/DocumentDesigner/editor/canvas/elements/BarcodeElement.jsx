// editor/canvas/elements/BarcodeElement.jsx — Barcode preview (bwip-js).
//
// Render APROXIMADO en el editor (el pixel-perfect lo hace el back desde el mismo
// modelo). El SVG se dibuja a tamaño real (derivado de moduleWidth/alto en mm) vía
// el adaptador barcodePreview; el texto de datos lo renderizamos aquí (HTML) para
// respetar la posición (arriba/abajo · izq/centro/der) y el estilo de texto.

import { useMemo } from 'react';
import { renderBarcodeSVG } from './barcodePreview.js';
import { sanitizeSvg } from './htmlSanitizer.js';
import { getSymbology } from '../../../engine/barcodeSymbologies.js';
import { resolveTextStyle } from '../../../engine/textStyleUtils.js';
import { textStyleToCSS } from './contentAreaUtils.js';
import './BarcodeElement.css';

const ALIGN_H = { left: 'flex-start', center: 'center', right: 'flex-end' };
const ALIGN_V = { top: 'flex-start', center: 'center', bottom: 'flex-end' };

export default function BarcodeElement({ element, fillStyles = [], textStyles = [] }) {
  const { svg, error, unsupported } = useMemo(
    () => renderBarcodeSVG(element, fillStyles),
    [element, fillStyles]
  );
  const sym = getSymbology(element.symbology);

  // Indicador "dinámico": sombreado verde cuando el objeto está
  // atado a una variable. Es ayuda visual SOLO del editor (no se exporta).
  const variable = element.content?.variable ?? null;
  const hasVariable = !!variable;
  const varTitle = hasVariable ? `Vinculado a variable: ${variable}` : undefined;
  const varOverlay = hasVariable
    ? <div className="bce__var-overlay" aria-hidden="true"><span className="bce__var-chip">⊟ {variable}</span></div>
    : null;
  const dynClass = hasVariable ? ' bce--dynamic' : '';

  if (unsupported) {
    return (
      <div className={`bce bce--unsupported${dynClass}`} title={varTitle ?? 'Se genera en el back'}>
        <span className="bce__warn">▤ {sym.label}</span>
        <span className="bce__err-msg">Vista previa no disponible — se genera en el documento final</span>
        {varOverlay}
      </div>
    );
  }
  if (error) {
    return (
      <div className={`bce bce--error${dynClass}`} title={varTitle ?? error}>
        <span className="bce__warn">⚠︎ {sym.label}</span>
        <span className="bce__err-msg">{error}</span>
        {varOverlay}
      </div>
    );
  }

  // ── Texto de datos (posición + estilo) ──
  const text = element.text ?? {};
  const pos  = text.position ?? 'none';
  const showText = pos !== 'none';
  const textTop  = pos.startsWith('top');
  const textAlign = pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center';
  const dataText = (element.content?.data ?? '').trim() || sym.sample || '';

  let textCss = {};
  if (showText) {
    const ts = resolveTextStyle(text.textStyleId, textStyles);
    textCss = textStyleToCSS(ts, fillStyles, 1);
  }

  const align = element.align ?? {};
  const dx = (text.deltaX ?? 0);
  const dy = (text.deltaY ?? 0);

  const textEl = showText ? (
    <div
      className="bce__data-text"
      style={{ ...textCss, textAlign, width: '100%', transform: (dx || dy) ? `translate(${dx}mm, ${dy}mm)` : undefined }}
    >
      {dataText}
    </div>
  ) : null;

  return (
    <div
      className={`bce bce--rendered${dynClass}`}
      title={varTitle}
      style={{ justifyContent: ALIGN_H[align.horizontal] ?? 'flex-start', alignItems: ALIGN_V[align.vertical] ?? 'flex-start' }}
    >
      <div className="bce__unit">
        {showText && textTop && textEl}
        <div className="bce__svg" dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />
        {showText && !textTop && textEl}
      </div>
      {varOverlay}
    </div>
  );
}
