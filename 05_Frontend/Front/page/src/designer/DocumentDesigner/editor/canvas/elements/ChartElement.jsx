// editor/canvas/elements/ChartElement.jsx — Gráfico (preview Vega-Lite).
//
// Render APROXIMADO en el editor (el final lo hace el back desde el MISMO spec con
// vl-convert). Doble-clic abre el ChartEditorModal. Se mide el contenedor para
// generar el SVG al tamaño real del elemento.

import { useState, useRef, useEffect, useMemo } from 'react';
import { renderChartSVG } from './chartPreview.js';
import { getChartType } from '../../../engine/chartModel.js';
import { sanitizeSvg } from './htmlSanitizer.js';
import './ChartElement.css';

const EMPTY = [];  // referencia estable → evita re-render del SVG en cada render

export default function ChartElement({ element, state }) {
  const containerRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);

  const fillStyles = state?.template?.styles?.fill ?? EMPTY;
  const colors     = state?.template?.colors ?? EMPTY;
  const textStyles = state?.template?.styles?.text ?? EMPTY;

  // Vista previa de variables (toggle "Variables" del Ribbon): resuelve cada
  // variable a su valor de muestra (mockValue del campo) en vez del token {{…}}.
  const availableFields = state?.availableFields ?? EMPTY;
  const showVarPreview  = !!state?.showVarPreview;
  const varPreview = useMemo(() => {
    if (!showVarPreview) return null;
    const m = {};
    for (const f of availableFields) if (f.mockValue !== undefined) m[f.path] = f.mockValue;
    return m;
  }, [showVarPreview, availableFields]);

  // Mide el contenedor (px reales) para renderizar el gráfico a ese tamaño.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // (Re)genera el SVG cuando cambia el modelo, el tamaño o los recursos.
  useEffect(() => {
    if (size.w < 8 || size.h < 8) return;
    let alive = true;
    renderChartSVG(element, { width: size.w, height: size.h, fillStyles, colors, textStyles, varPreview })
      .then(res => {
        if (!alive) return;
        if (res.error) { setError(res.error); setSvg(''); }
        else { setSvg(res.svg); setError(null); }
      });
    return () => { alive = false; };
  }, [element, size.w, size.h, fillStyles, colors, textStyles, varPreview]);

  const variable = element.dataBinding?.valuesArrayVar ?? null;
  const sym = getChartType(element.chartType);

  return (
    <div
      ref={containerRef}
      className={`che${variable ? ' che--dynamic' : ''}`}
      title={variable ? `Vinculado a variable: ${variable}` : `${sym.label} — doble clic para editar`}
      onDoubleClick={(e) => { e.stopPropagation(); state?.openChartEditor?.(element.id); }}
    >
      {error ? (
        <div className="che__error"><span>⚠︎ {error}</span></div>
      ) : svg ? (
        <div className="che__svg" dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />
      ) : (
        <div className="che__loading">Generando gráfico…</div>
      )}

      {variable && <div className="che__var-overlay" aria-hidden="true"><span className="che__var-chip">⊟ {variable}</span></div>}
    </div>
  );
}
