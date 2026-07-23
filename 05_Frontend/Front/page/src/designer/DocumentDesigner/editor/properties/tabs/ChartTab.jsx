// ChartTab.jsx — Tab "Gráfico" del panel de propiedades (General del gráfico
// en el panel lateral): tipo, nº de series/valores, relleno aleatorio y
// el botón "Editar gráfico…" que abre el ChartEditorModal (props avanzadas).

import { Shuffle, Pencil } from 'lucide-react';
import { CHART_TYPES, hasAxes, resizeValues, resizeSeries, randomizeValues } from '../../../engine/chartModel.js';
import './ChartTab.css';

export default function ChartTab({ element, onUpdate, state }) {
  const cats   = element.categories ?? [];
  const series = element.series ?? [];
  const multiCapable = hasAxes(element.chartType);

  return (
    <>
      <div className="pp-field">
        <label className="pp-field__label">Tipo de gráfico</label>
        <select className="pp-field__select" value={element.chartType ?? 'column'}
          onChange={e => onUpdate({ chartType: e.target.value })}>
          {CHART_TYPES.map(ct => <option key={ct.id} value={ct.id}>{ct.label}</option>)}
        </select>
      </div>

      <div className="pp-row">
        {multiCapable && (
          <div className="pp-field">
            <label className="pp-field__label">Nº de series</label>
            <input type="number" min={1} max={12} className="pp-field__input"
              value={series.length} onChange={e => onUpdate(resizeSeries(element, parseInt(e.target.value, 10)))} />
          </div>
        )}
        <div className="pp-field">
          <label className="pp-field__label">Nº de valores</label>
          <input type="number" min={1} max={50} className="pp-field__input"
            value={cats.length} onChange={e => onUpdate(resizeValues(element, parseInt(e.target.value, 10)))} />
        </div>
      </div>

      <button className="ctab-btn" onClick={() => onUpdate(randomizeValues(element))}>
        <Shuffle size={13} /> Rellenar con valores aleatorios
      </button>

      <button className="ctab-btn ctab-btn--primary" onClick={() => state?.openChartEditor?.(element.id)}>
        <Pencil size={13} /> Editar gráfico…
      </button>

      <p className="pp-field__hint" style={{ marginTop: 8 }}>
        Doble clic sobre el gráfico también abre el editor (tipo, datos, ejes, colores y leyenda).
      </p>
    </>
  );
}
