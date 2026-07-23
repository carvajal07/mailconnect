// ChartEditorModal.jsx — Editor del gráfico (propiedades del gráfico).
//
// Doble-clic en el gráfico lo abre. Preview en vivo arriba + tabs:
//  · Tipo   — familia + nº de series/valores + relleno aleatorio
//  · Datos  — categorías, valores por serie y colores
//  · Ejes   — títulos, min/max, etiquetas (solo cartesianos)
//  · Leyenda— mostrar + posición
// Edita en vivo: cada cambio se refleja en el preview y en el canvas (onUpdate).
// El borde del objeto se edita en el panel lateral (tab Borde).

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Shuffle } from 'lucide-react';
import { CHART_TYPES, isCircular, hasAxes, resizeValues, resizeSeries, randomizeValues, supportsStacking, supportsCombo } from '../../engine/chartModel.js';
import { renderChartSVG } from '../canvas/elements/chartPreview.js';
import FillStyleSelector from '../resources/fill/FillStyleSelector.jsx';
import VariableTreeSelect from '../components/VariableTreeSelect.jsx';
import './ChartEditorModal.css';

// ── Preview (responsive: rellena su columna) ─────────────────────────────────
function ChartPreviewBox({ model, fillStyles, colors, textStyles }) {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth - 16, h: el.clientHeight - 16 });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (size.w < 40 || size.h < 40) return;
    let alive = true;
    renderChartSVG(model, { width: size.w, height: size.h, fillStyles, colors, textStyles }).then(res => {
      if (!alive) return;
      if (res.error) { setErr(res.error); setSvg(''); }
      else { setSvg(res.svg); setErr(null); }
    });
    return () => { alive = false; };
  }, [model, size.w, size.h, fillStyles, colors, textStyles]);

  return (
    <div className="cem-preview" ref={ref}>
      {err ? <span className="cem-preview__err">⚠︎ {err}</span>
        : svg ? <div className="cem-preview__svg" dangerouslySetInnerHTML={{ __html: svg }} />
        : <span className="cem-preview__loading">…</span>}
    </div>
  );
}

// Selector de variable (ƒx) — usa el picker en árbol con badges de tipo.
// El valor fijo de al lado es el fallback de preview; el back usa la variable.
function VarSelect({ value, onChange, fields, accept }) {
  if (!fields?.length) return null;
  return <VariableTreeSelect value={value} onChange={onChange} fields={fields} accept={accept} />;
}

// Tipos aceptados por contexto (filtran el picker de variable).
const T_NUM = ['number', 'integer'];
const T_STR = ['string', 'date'];
const T_ARR = ['array'];

// Campo de texto que puede ser fijo O una variable (input + selector ƒx).
function TextOrVar({ label, value, onText, varValue, onVar, fields, placeholder, accept = T_STR }) {
  return (
    <div className="pp-field">
      <label className="pp-field__label">{label}</label>
      <input className="pp-field__input" value={value ?? ''} placeholder={placeholder} onChange={e => onText(e.target.value)} />
      <VarSelect value={varValue} onChange={onVar} fields={fields} accept={accept} />
    </div>
  );
}

// Switch estilo iOS (label a la izquierda, control a la derecha).
function Switch({ checked, onChange, label }) {
  return (
    <label className="cem-switch">
      <span className="cem-switch__label">{label}</span>
      <span className={`cem-switch__track${checked ? ' cem-switch__track--on' : ''}`}>
        <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
        <span className="cem-switch__thumb" />
      </span>
    </label>
  );
}

// ── Modal ────────────────────────────────────────────────────────────────────
export default function ChartEditorModal({ element, fillStyles = [], colors = [], textStyles = [], availableFields = [], onAddFillStyle, onNavigateFill, onUpdate, onClose }) {
  const [draft, setDraft] = useState(element);
  const [tab, setTab] = useState('Tipo');

  // Aplica cambios al draft y los propaga al canvas.
  const patch = (changes) => {
    setDraft(d => ({ ...d, ...changes }));
    onUpdate?.(changes);
  };

  const circular = isCircular(draft.chartType);
  const cats   = draft.categories ?? [];
  const series = draft.series ?? [];
  const single = series.length <= 1;

  // ── Operaciones sobre el modelo ──
  const setType = (id) => patch({ chartType: id });

  const setValuesCount = (n) => patch(resizeValues(draft, n));
  const setSeriesCount = (n) => patch(resizeSeries(draft, n));
  const fillRandom     = ()  => patch(randomizeValues(draft));

  const setCategoryLabel = (i, label) => {
    const next = cats.slice(); next[i] = label; patch({ categories: next });
  };
  const setValue = (si, vi, raw) => {
    const num = parseFloat(raw);
    patch({ series: series.map((s, k) => k !== si ? s
      : { ...s, values: s.values.map((v, j) => j !== vi ? v : { ...v, value: isNaN(num) ? 0 : num }) }) });
  };
  const setSeriesName  = (si, name) => patch({ series: series.map((s, k) => k === si ? { ...s, name } : s) });
  const setSeriesColor = (si, ref)  => patch({ series: series.map((s, k) => k === si ? { ...s, fillRef: ref } : s) });
  const setValueColor  = (vi, ref)  => patch({ series: series.map((s, k) => k !== 0 ? s
    : { ...s, values: s.values.map((v, j) => j === vi ? { ...v, fillRef: ref } : v) }) });
  const setValueVar    = (vi, path) => patch({ series: series.map((s, k) => k !== 0 ? s
    : { ...s, values: s.values.map((v, j) => j === vi ? { ...v, valueVar: path || null } : v) }) });

  const setAxis = (which, ch) => patch({ axes: { ...draft.axes, [which]: { ...draft.axes?.[which], ...ch } } });
  const setLegend = (ch) => patch({ legend: { ...draft.legend, ...ch } });
  const setPointLabels = (ch) => patch({ pointLabels: { ...draft.pointLabels, ...ch } });
  const setDataBinding = (ch) => patch({ dataBinding: { ...draft.dataBinding, ...ch } });
  const setPlacement   = (ch) => patch({ placement: { ...draft.placement, ...ch } });
  const setBarBorder   = (ch) => patch({ barBorder: { ...draft.barBorder, ...ch } });
  const setValueLow    = (vi, raw) => patch({ series: series.map((s, k) => k !== 0 ? s
    : { ...s, values: s.values.map((v, j) => j === vi ? { ...v, lowest: raw === '' ? null : (parseFloat(raw) || 0) } : v) }) });
  const setSeriesLegendVar = (si, path) => patch({ series: series.map((s, k) => k === si ? { ...s, legendVar: path || null } : s) });
  const setSeriesDashed = (si, val) => patch({ series: series.map((s, k) => k === si ? { ...s, dashed: val } : s) });

  // Líneas de referencia (eje de valores)
  const refLines = draft.axes?.y?.lines ?? [];
  const setRefLines = (next) => setAxis('y', { lines: next });
  const addRefLine    = () => setRefLines([...refLines, { id: `rl_${Date.now()}`, value: 0, color: '#ef4444', label: '', labelVar: null }]);
  const updateRefLine = (i, ch) => setRefLines(refLines.map((l, k) => k === i ? { ...l, ...ch } : l));
  const removeRefLine = (i) => setRefLines(refLines.filter((_, k) => k !== i));

  // Bandas (stripes) del eje de valores
  const stripes = draft.axes?.y?.stripes ?? [];
  const setStripes = (next) => setAxis('y', { stripes: next });
  const addStripe    = () => setStripes([...stripes, { id: `st_${Date.now()}`, from: 0, to: 1, color: '#fbbf24' }]);
  const updateStripe = (i, ch) => setStripes(stripes.map((s, k) => k === i ? { ...s, ...ch } : s));
  const removeStripe = (i) => setStripes(stripes.filter((_, k) => k !== i));

  const TABS = ['Tipo', 'Datos', 'Ejes', 'Etiquetas', 'Leyenda', 'Diseño'];

  return createPortal(
    <div className="cem-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cem-modal">
        <div className="cem-header">
          <span className="cem-header__title">Propiedades del gráfico</span>
          <button className="cem-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="cem-main">
          <div className="cem-left">
            <ChartPreviewBox model={draft} fillStyles={fillStyles} colors={colors} textStyles={textStyles} />
          </div>

          <div className="cem-right">
            <div className="cem-tabs">
              {TABS.map(t => (
                <button key={t} className={`cem-tab${tab === t ? ' cem-tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
              ))}
            </div>

            <div className="cem-body">
          {tab === 'Tipo' && (
            <>
              <div className="pp-section-title">Tipo de gráfico</div>
              <div className="cem-typegrid">
                {CHART_TYPES.map(ct => (
                  <button
                    key={ct.id}
                    className={`cem-type${draft.chartType === ct.id ? ' cem-type--active' : ''}`}
                    onClick={() => setType(ct.id)}
                  >{ct.label}</button>
                ))}
              </div>

              <div className="pp-row" style={{ marginTop: 12 }}>
                {hasAxes(draft.chartType) && (
                  <div className="pp-field">
                    <label className="pp-field__label">Nº de series</label>
                    <input type="number" min={1} max={12} className="pp-field__input"
                      value={series.length} onChange={e => setSeriesCount(parseInt(e.target.value, 10))} />
                  </div>
                )}
                <div className="pp-field">
                  <label className="pp-field__label">Nº de valores</label>
                  <input type="number" min={1} max={50} className="pp-field__input"
                    value={cats.length} onChange={e => setValuesCount(parseInt(e.target.value, 10))} />
                </div>
              </div>
              <button className="cem-btn" onClick={fillRandom}><Shuffle size={13} /> Rellenar con valores aleatorios</button>
              {circular && <p className="pp-field__hint" style={{ marginTop: 6 }}>Pastel y dona usan una sola serie; cada valor es un sector.</p>}

              {(supportsStacking(draft.chartType) || (supportsCombo(draft.chartType) && series.length > 1)) && (
                <div className="pp-section-title" style={{ marginTop: 12 }}>Disposición</div>
              )}
              {supportsStacking(draft.chartType) && (
                <div className="pp-field">
                  <label className="pp-field__label">Apilado</label>
                  <select className="pp-field__select" value={draft.stacking ?? 'none'} onChange={e => patch({ stacking: e.target.value })}>
                    <option value="none">Agrupado (sin apilar)</option>
                    <option value="stacked">Apilado</option>
                    <option value="normalize">Apilado 100%</option>
                  </select>
                </div>
              )}
              {supportsCombo(draft.chartType) && series.length > 1 && (
                <div className="pp-field">
                  <label className="pp-field__label">Series como línea (combo)</label>
                  <input type="number" min={0} max={series.length - 1} className="pp-field__input"
                    value={draft.lineSeriesCount ?? 0} onChange={e => patch({ lineSeriesCount: Math.max(0, Math.min(series.length - 1, parseInt(e.target.value, 10) || 0)) })} />
                  <p className="pp-field__hint">Las últimas N series se dibujan como línea sobre las barras.</p>
                </div>
              )}
              {(draft.chartType === 'column' || draft.chartType === 'bar') && (
                <div className="pp-field">
                  <label className="pp-field__label">Ancho de barra ({Math.round((draft.barWidth ?? 0.8) * 100)}%)</label>
                  <input type="range" min={0.1} max={0.95} step={0.05} value={draft.barWidth ?? 0.8}
                    onChange={e => patch({ barWidth: parseFloat(e.target.value) })} />
                </div>
              )}
              {!circular && draft.chartType !== 'funnel' && (
                <Switch checked={!!draft.categoriesReverse} onChange={v => patch({ categoriesReverse: v })} label="Categorías en orden inverso" />
              )}
              {(draft.chartType === 'column' || draft.chartType === 'bar' || draft.chartType === 'scatter') && (
                <div className="pp-row" style={{ alignItems: 'flex-end' }}>
                  <div className="pp-field pp-row" style={{ flex: 2 }}>
                    <label className="pp-field__label">Borde de barras</label>
                    <FillStyleSelector fillStyleId={draft.barBorder?.fillRef} fillStyles={fillStyles}
                      onSelect={ref => setBarBorder({ fillRef: ref })} onAddFillStyle={onAddFillStyle} onNavigate={onNavigateFill} allowNone label="Sin borde" />
                  </div>
                  <div className="pp-field" style={{ flex: 1 }}>
                    <label className="pp-field__label">Ancho borde</label>
                    <input type="number" min={0} step={0.5} className="pp-field__input" value={draft.barBorder?.width ?? 0}
                      onChange={e => setBarBorder({ width: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
              )}

              {(draft.chartType === 'line' || draft.chartType === 'area') && single && (
                <Switch checked={!!series[0]?.dashed} onChange={v => setSeriesDashed(0, v)} label="Línea punteada" />
              )}

              <div className="pp-field" style={{ marginTop: 8 }}>
                <label className="pp-field__label">Esquema de color</label>
                <select className="pp-field__select" value={draft.colorScheme ?? ''} onChange={e => patch({ colorScheme: e.target.value || null })}>
                  <option value="">— Colores propios —</option>
                  <optgroup label="Categórico">
                    {[['tableau10', 'Tableau 10'], ['tableau20', 'Tableau 20'], ['set2', 'Set 2'], ['dark2', 'Dark 2'], ['category10', 'Category 10']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </optgroup>
                  <optgroup label="Secuencial (mapa de calor)">
                    {[['blues', 'Azules'], ['greens', 'Verdes'], ['oranges', 'Naranjas'], ['viridis', 'Viridis'], ['magma', 'Magma']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </optgroup>
                  <optgroup label="Divergente">
                    {[['redblue', 'Rojo-Azul'], ['spectral', 'Spectral'], ['redyellowgreen', 'Rojo-Amarillo-Verde']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </optgroup>
                </select>
                <p className="pp-field__hint">Sobrescribe los colores por valor/serie. El mapa de calor usa siempre un esquema (Azules por defecto).</p>
              </div>
            </>
          )}

          {tab === 'Datos' && (
            <div className="cem-data">
              <div className="pp-field">
                <label className="pp-field__label">Fuente de datos</label>
                <select className="pp-field__select" value={draft.dataBinding?.mode ?? 'static'}
                  onChange={e => setDataBinding({ mode: e.target.value })}>
                  <option value="static">Estático (valores fijos)</option>
                  <option value="variable">Variable (array de datos)</option>
                </select>
              </div>
              {draft.dataBinding?.mode === 'variable' && (
                <div className="pp-field">
                  <label className="pp-field__label">Variable (array)</label>
                  <VariableTreeSelect value={draft.dataBinding?.valuesArrayVar} onChange={p => setDataBinding({ valuesArrayVar: p })}
                    fields={availableFields} accept={T_ARR} placeholder="— Selecciona campo —" clearLabel="— Sin asignar —" />
                  <p className="pp-field__hint">Los valores se toman de esta variable al generar. Abajo defines los valores de muestra (preview).</p>
                </div>
              )}

              <div className="pp-section-title" style={{ marginTop: 8 }}>{draft.dataBinding?.mode === 'variable' ? 'Valores de muestra' : 'Valores'}</div>
              <table className="cem-table">
                <thead>
                  <tr>
                    <th>Categoría</th>
                    {series.map((s, si) => (
                      <th key={s.id}>
                        {single ? 'Valor' : (
                          <>
                            <input className="cem-th-input" value={s.name} onChange={e => setSeriesName(si, e.target.value)} />
                            <VarSelect value={s.legendVar} onChange={p => setSeriesLegendVar(si, p)} fields={availableFields} accept={T_STR} />
                          </>
                        )}
                      </th>
                    ))}
                    {single && <th>Variable</th>}
                    {single && <th>Base</th>}
                    {single && <th>Color</th>}
                    {!single && <th></th>}
                  </tr>
                  {!single && (
                    <tr>
                      <th></th>
                      {series.map((s, si) => (
                        <th key={s.id}>
                          <FillStyleSelector fillStyleId={s.fillRef} fillStyles={fillStyles}
                            onSelect={ref => setSeriesColor(si, ref)} onAddFillStyle={onAddFillStyle} onNavigate={onNavigateFill} allowNone label="Color serie" />
                          {(draft.chartType === 'line' || draft.chartType === 'area') && (
                            <label className="pp-toggle-row" style={{ marginTop: 2 }}>
                              <input type="checkbox" checked={!!s.dashed} onChange={e => setSeriesDashed(si, e.target.checked)} />
                              <span style={{ fontSize: 10 }}>Punteada</span>
                            </label>
                          )}
                        </th>
                      ))}
                      <th></th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {cats.map((c, vi) => (
                    <tr key={vi}>
                      <td><input className="cem-cell-input" value={c} onChange={e => setCategoryLabel(vi, e.target.value)} /></td>
                      {series.map((s, si) => (
                        <td key={s.id}>
                          <input type="number" step="0.01" className="cem-cell-input"
                            value={s.values?.[vi]?.value ?? 0} onChange={e => setValue(si, vi, e.target.value)} />
                        </td>
                      ))}
                      {single && (
                        <td>
                          <VariableTreeSelect value={series[0]?.values?.[vi]?.valueVar} onChange={p => setValueVar(vi, p)} fields={availableFields} accept={T_NUM} />
                        </td>
                      )}
                      {single && (
                        <td>
                          <input type="number" step="0.01" className="cem-cell-input" placeholder="base"
                            value={series[0]?.values?.[vi]?.lowest ?? ''} onChange={e => setValueLow(vi, e.target.value)} />
                        </td>
                      )}
                      {single && (
                        <td>
                          <FillStyleSelector fillStyleId={series[0]?.values?.[vi]?.fillRef} fillStyles={fillStyles}
                            onSelect={ref => setValueColor(vi, ref)} onAddFillStyle={onAddFillStyle} onNavigate={onNavigateFill} allowNone label="Color" />
                        </td>
                      )}
                      {!single && <td></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cem-data-actions">
                <button className="cem-btn" onClick={() => setValuesCount(cats.length + 1)}><Plus size={13} /> Añadir valor</button>
                {cats.length > 1 && <button className="cem-btn" onClick={() => setValuesCount(cats.length - 1)}><Trash2 size={13} /> Quitar último</button>}
              </div>
            </div>
          )}

          {tab === 'Ejes' && (
            !hasAxes(draft.chartType) ? (
              <p className="pp-field__hint">Pastel, dona y embudo no tienen ejes cartesianos.</p>
            ) : (
              <>
                <div className="pp-section-title">Eje de categorías (X)</div>
                <TextOrVar label="Título" value={draft.axes?.x?.title} placeholder="(sin título)"
                  onText={v => setAxis('x', { title: v })} varValue={draft.axes?.x?.titleVar} onVar={p => setAxis('x', { titleVar: p })} fields={availableFields} />
                <Switch checked={draft.axes?.x?.showLabels !== false} onChange={v => setAxis('x', { showLabels: v })} label="Mostrar etiquetas" />
                <div className="pp-row">
                  <div className="pp-field">
                    <label className="pp-field__label">Rotación de etiquetas (°)</label>
                    <input type="number" step={5} className="pp-field__input" value={draft.axes?.x?.labelAngle ?? 0}
                      onChange={e => setAxis('x', { labelAngle: parseInt(e.target.value, 10) || 0 })} />
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Marcas</label>
                    <select className="pp-field__select" value={draft.axes?.x?.tickStyle ?? 'outside'} onChange={e => setAxis('x', { tickStyle: e.target.value })}>
                      {[['outside', 'Fuera'], ['inside', 'Dentro'], ['none', 'Ninguna']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </div>
                <div className="pp-field">
                  <label className="pp-field__label">Etiquetas desde variable</label>
                  <VarSelect value={draft.axes?.x?.labelsVar} onChange={p => setAxis('x', { labelsVar: p })} fields={availableFields} accept={T_ARR} />
                  {!availableFields.length && <p className="pp-field__hint">Sin campos de datos disponibles.</p>}
                </div>
                <Switch checked={!!draft.axes?.x?.temporal} onChange={v => setAxis('x', { temporal: v })} label="Eje de fecha/tiempo (categorías como fechas)" />

                <div className="pp-section-title">Eje de valores (Y)</div>
                <TextOrVar label="Título" value={draft.axes?.y?.title} placeholder="(sin título)"
                  onText={v => setAxis('y', { title: v })} varValue={draft.axes?.y?.titleVar} onVar={p => setAxis('y', { titleVar: p })} fields={availableFields} />
                <div className="pp-row">
                  <div className="pp-field">
                    <label className="pp-field__label">Mínimo</label>
                    <input type="number" className="pp-field__input" value={draft.axes?.y?.min ?? ''} placeholder="auto"
                      onChange={e => setAxis('y', { min: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                    <VarSelect value={draft.axes?.y?.minVar} onChange={p => setAxis('y', { minVar: p })} fields={availableFields} accept={T_NUM} />
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Máximo</label>
                    <input type="number" className="pp-field__input" value={draft.axes?.y?.max ?? ''} placeholder="auto"
                      onChange={e => setAxis('y', { max: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                    <VarSelect value={draft.axes?.y?.maxVar} onChange={p => setAxis('y', { maxVar: p })} fields={availableFields} accept={T_NUM} />
                  </div>
                </div>
                <Switch checked={draft.axes?.y?.showLabels !== false} onChange={v => setAxis('y', { showLabels: v })} label="Mostrar etiquetas" />
                <Switch checked={draft.axes?.y?.grid !== false} onChange={v => setAxis('y', { grid: v })} label="Líneas de cuadrícula" />
                <div className="pp-row">
                  <div className="pp-field">
                    <label className="pp-field__label">Decimales</label>
                    <input type="number" min={0} max={6} className="pp-field__input" value={draft.axes?.y?.decimals ?? ''} placeholder="auto"
                      onChange={e => setAxis('y', { decimals: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })} />
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Paso de marcas</label>
                    <input type="number" step="0.5" className="pp-field__input" value={draft.axes?.y?.tickStep ?? ''} placeholder="auto"
                      onChange={e => setAxis('y', { tickStep: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                    <VarSelect value={draft.axes?.y?.tickStepVar} onChange={p => setAxis('y', { tickStepVar: p })} fields={availableFields} accept={T_NUM} />
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Base (lowest)</label>
                    <input type="number" step="0.5" className="pp-field__input" value={draft.axes?.y?.baseline ?? 0}
                      onChange={e => setAxis('y', { baseline: parseFloat(e.target.value) || 0 })} />
                  </div>
                </div>
                <Switch checked={!!draft.axes?.y?.nice} onChange={v => setAxis('y', { nice: v })} label="Redondear máximo (nice)" />
                <Switch checked={!!draft.axes?.y?.log} onChange={v => setAxis('y', { log: v })} label="Escala logarítmica" />
                <div className="pp-row">
                  <div className="pp-field">
                    <label className="pp-field__label">Marcas</label>
                    <select className="pp-field__select" value={draft.axes?.y?.tickStyle ?? 'outside'} onChange={e => setAxis('y', { tickStyle: e.target.value })}>
                      {[['outside', 'Fuera'], ['inside', 'Dentro'], ['none', 'Ninguna']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Ancho de línea de eje</label>
                    <input type="number" min={0} step={0.5} className="pp-field__input" value={draft.axes?.y?.axisLineWidth ?? ''} placeholder="auto"
                      onChange={e => setAxis('y', { axisLineWidth: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                  </div>
                </div>

                <div className="pp-section-title">Bandas (stripes)</div>
                {stripes.length === 0 && <p className="pp-field__hint">Sin bandas. Útil para resaltar rangos (p.ej. zona buena/mala).</p>}
                {stripes.map((s, i) => (
                  <div key={s.id ?? i} className="pp-row" style={{ alignItems: 'flex-end' }}>
                    <div className="pp-field" style={{ flex: 1 }}>
                      <label className="pp-field__label">Desde</label>
                      <input type="number" step="0.5" className="pp-field__input" value={s.from ?? 0} onChange={e => updateStripe(i, { from: parseFloat(e.target.value) || 0 })} />
                      <VarSelect value={s.fromVar} onChange={p => updateStripe(i, { fromVar: p })} fields={availableFields} accept={T_NUM} />
                    </div>
                    <div className="pp-field" style={{ flex: 1 }}>
                      <label className="pp-field__label">Hasta</label>
                      <input type="number" step="0.5" className="pp-field__input" value={s.to ?? 0} onChange={e => updateStripe(i, { to: parseFloat(e.target.value) || 0 })} />
                      <VarSelect value={s.toVar} onChange={p => updateStripe(i, { toVar: p })} fields={availableFields} accept={T_NUM} />
                    </div>
                    <div className="pp-field" style={{ flex: 1 }}>
                      <label className="pp-field__label">Color</label>
                      <input type="color" className="pp-field__input" style={{ padding: 2, height: 30 }} value={s.color ?? '#fbbf24'} onChange={e => updateStripe(i, { color: e.target.value })} />
                    </div>
                    <button className="cem-btn" style={{ marginTop: 0 }} onClick={() => removeStripe(i)}><Trash2 size={13} /></button>
                  </div>
                ))}
                <button className="cem-btn" onClick={addStripe}><Plus size={13} /> Añadir banda</button>

                <div className="pp-section-title">Líneas de referencia</div>
                {refLines.length === 0 && <p className="pp-field__hint">Sin líneas. Útil para marcar metas/umbrales.</p>}
                {refLines.map((l, i) => (
                  <div key={l.id ?? i} className="cem-subcard">
                    <div className="pp-row" style={{ alignItems: 'flex-end' }}>
                      <div className="pp-field" style={{ flex: 2 }}>
                        <label className="pp-field__label">Valor</label>
                        <input type="number" step="0.01" className="pp-field__input" value={l.value ?? 0}
                          onChange={e => updateRefLine(i, { value: parseFloat(e.target.value) || 0 })} />
                        <VarSelect value={l.valueVar} onChange={p => updateRefLine(i, { valueVar: p })} fields={availableFields} accept={T_NUM} />
                      </div>
                      <div className="pp-field" style={{ flex: 1 }}>
                        <label className="pp-field__label">Color</label>
                        <input type="color" className="pp-field__input" style={{ padding: 2, height: 30 }} value={l.color ?? '#ef4444'}
                          onChange={e => updateRefLine(i, { color: e.target.value })} />
                      </div>
                      <button className="cem-btn" style={{ marginTop: 0 }} onClick={() => removeRefLine(i)}><Trash2 size={13} /></button>
                    </div>
                    <TextOrVar label="Etiqueta" value={l.label} placeholder="(sin etiqueta)"
                      onText={v => updateRefLine(i, { label: v })} varValue={l.labelVar} onVar={p => updateRefLine(i, { labelVar: p })} fields={availableFields} />
                  </div>
                ))}
                <button className="cem-btn" onClick={addRefLine}><Plus size={13} /> Añadir línea</button>
              </>
            )
          )}

          {tab === 'Etiquetas' && (
            <>
              <Switch checked={!!draft.pointLabels?.show} onChange={v => setPointLabels({ show: v })} label="Mostrar etiquetas de dato" />
              {draft.pointLabels?.show && (
                <>
                  <div className="pp-field">
                    <label className="pp-field__label">Contenido</label>
                    <select className="pp-field__select" value={draft.pointLabels?.content ?? 'value'} onChange={e => setPointLabels({ content: e.target.value })}>
                      <option value="value">Valor</option>
                      <option value="percent">Porcentaje</option>
                    </select>
                  </div>
                  <div className="pp-row">
                    <div className="pp-field">
                      <label className="pp-field__label">Posición</label>
                      <select className="pp-field__select" value={draft.pointLabels?.position ?? 'outside'} onChange={e => setPointLabels({ position: e.target.value })}>
                        <option value="outside">Fuera</option>
                        <option value="inside">Dentro</option>
                        <option value="center">Centro</option>
                      </select>
                    </div>
                    <div className="pp-field">
                      <label className="pp-field__label">Rotación (°)</label>
                      <input type="number" step={5} className="pp-field__input" value={draft.pointLabels?.rotation ?? 0}
                        onChange={e => setPointLabels({ rotation: parseInt(e.target.value, 10) || 0 })} />
                    </div>
                  </div>
                  <div className="pp-row">
                    <div className="pp-field">
                      <label className="pp-field__label">Estilo de texto</label>
                      <select className="pp-field__select" value={draft.pointLabels?.textStyleId ?? ''} onChange={e => setPointLabels({ textStyleId: e.target.value || null })}>
                        <option value="">— Por defecto —</option>
                        {textStyles.map(ts => <option key={ts.id} value={ts.id}>{ts.name ?? ts.id}</option>)}
                      </select>
                    </div>
                    <div className="pp-field">
                      <label className="pp-field__label">Offset (px)</label>
                      <input type="number" step={1} className="pp-field__input" value={draft.pointLabels?.offset ?? 0}
                        onChange={e => setPointLabels({ offset: parseFloat(e.target.value) || 0 })} />
                    </div>
                    <div className="pp-field">
                      <label className="pp-field__label">Ancho máx.</label>
                      <input type="number" min={0} className="pp-field__input" value={draft.pointLabels?.formatWidth ?? ''} placeholder="auto"
                        onChange={e => setPointLabels({ formatWidth: e.target.value === '' ? null : parseFloat(e.target.value) })} />
                    </div>
                  </div>
                  <p className="pp-field__hint">El porcentaje se calcula sobre el total de los valores visibles.</p>
                </>
              )}
            </>
          )}

          {tab === 'Leyenda' && (
            <>
              <Switch checked={!!draft.legend?.show} onChange={v => setLegend({ show: v })} label="Mostrar leyenda" />
              {draft.legend?.show && (
                <>
                  <div className="pp-field">
                    <label className="pp-field__label">Posición</label>
                    <select className="pp-field__select" value={draft.legend?.position ?? 'right'} onChange={e => setLegend({ position: e.target.value })}>
                      {[['right', 'Derecha'], ['left', 'Izquierda'], ['top', 'Arriba'], ['bottom', 'Abajo']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Dirección</label>
                    <select className="pp-field__select" value={draft.legend?.direction ?? 'vertical'} onChange={e => setLegend({ direction: e.target.value })}>
                      <option value="vertical">Vertical (una columna)</option>
                      <option value="horizontal">Horizontal (una fila)</option>
                    </select>
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Estilo de texto</label>
                    <select className="pp-field__select" value={draft.legend?.textStyleId ?? ''} onChange={e => setLegend({ textStyleId: e.target.value || null })}>
                      <option value="">— Por defecto —</option>
                      {textStyles.map(ts => <option key={ts.id} value={ts.id}>{ts.name ?? ts.id}</option>)}
                    </select>
                  </div>
                  <div className="pp-field">
                    <label className="pp-field__label">Símbolo</label>
                    <select className="pp-field__select" value={draft.legend?.symbolType ?? 'square'} onChange={e => setLegend({ symbolType: e.target.value })}>
                      {[['square', 'Cuadro'], ['circle', 'Círculo'], ['cross', 'Cruz'], ['diamond', 'Diamante'], ['triangle', 'Triángulo']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                </>
              )}
            </>
          )}

          {tab === 'Diseño' && (
            <>
              <div className="pp-section-title">Título</div>
              <TextOrVar label="Texto" value={draft.title} placeholder="(sin título)"
                onText={v => patch({ title: v })} varValue={draft.titleVar} onVar={p => patch({ titleVar: p })} fields={availableFields} />
              <div className="pp-field">
                <label className="pp-field__label">Estilo de título</label>
                <select className="pp-field__select" value={draft.titleStyleId ?? ''} onChange={e => patch({ titleStyleId: e.target.value || null })}>
                  <option value="">— Por defecto —</option>
                  {textStyles.map(ts => <option key={ts.id} value={ts.id}>{ts.name ?? ts.id}</option>)}
                </select>
              </div>

              <div className="pp-section-title">Rellenos</div>
              <div className="pp-field pp-row">
                <label className="pp-field__label">Fondo del objeto</label>
                <FillStyleSelector fillStyleId={draft.placement?.backgroundFillId} fillStyles={fillStyles}
                  onSelect={ref => setPlacement({ backgroundFillId: ref })} onAddFillStyle={onAddFillStyle} onNavigate={onNavigateFill} allowNone label="Transparente" />
              </div>
              <div className="pp-field pp-row">
                <label className="pp-field__label">Área de series</label>
                <FillStyleSelector fillStyleId={draft.placement?.seriesFillId} fillStyles={fillStyles}
                  onSelect={ref => setPlacement({ seriesFillId: ref })} onAddFillStyle={onAddFillStyle} onNavigate={onNavigateFill} allowNone label="Transparente" />
              </div>

              <div className="pp-section-title">Márgenes (mm)</div>
              <div className="pp-row">
                <div className="pp-field">
                  <label className="pp-field__label">Arriba</label>
                  <input type="number" min={0} step={0.5} className="pp-field__input" value={draft.placement?.marginTop ?? 0}
                    onChange={e => setPlacement({ marginTop: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="pp-field">
                  <label className="pp-field__label">Abajo</label>
                  <input type="number" min={0} step={0.5} className="pp-field__input" value={draft.placement?.marginBottom ?? 0}
                    onChange={e => setPlacement({ marginBottom: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="pp-field">
                  <label className="pp-field__label">Izquierda</label>
                  <input type="number" min={0} step={0.5} className="pp-field__input" value={draft.placement?.marginLeft ?? 0}
                    onChange={e => setPlacement({ marginLeft: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="pp-field">
                  <label className="pp-field__label">Derecha</label>
                  <input type="number" min={0} step={0.5} className="pp-field__input" value={draft.placement?.marginRight ?? 0}
                    onChange={e => setPlacement({ marginRight: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
            </>
          )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
