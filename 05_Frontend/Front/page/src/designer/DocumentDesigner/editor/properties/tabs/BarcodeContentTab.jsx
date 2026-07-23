// BarcodeContentTab.jsx — Tab "Contenido" del código de barras.
// Data/Variable, simbología (agrupada), fills por referencia a Recursos, encoding.

import FillStyleSelector from '../../resources/fill/FillStyleSelector.jsx';
import VariableTreeSelect from '../../components/VariableTreeSelect.jsx';
import { SYMBOLOGIES, defaultOptionsFor } from '../../../engine/barcodeSymbologies.js';

const CATEGORY_LABELS = { '1d': '1D / Lineal', matrix: '2D / Matriz', stacked: '2D / Apilado', postal: 'Postal', other: 'Otros' };

export default function BarcodeContentTab({ element, onUpdate, state, availableFields = [] }) {
  const content = element.content ?? {};
  const style   = element.style ?? {};
  const fillStyles = state?.template?.styles?.fill ?? [];

  const setContent = (ch) => onUpdate({ content: { ...content, ...ch } });
  const setStyle   = (ch) => onUpdate({ style: { ...style, ...ch } });

  function changeSymbology(id) {
    // Al cambiar de tipo, reseteamos las options a los defaults del nuevo tipo.
    onUpdate({ symbology: id, options: defaultOptionsFor(id) });
  }

  // Agrupar simbologías por categoría para el dropdown.
  const groups = {};
  for (const s of SYMBOLOGIES) (groups[s.category] ??= []).push(s);

  return (
    <>
      <div className="pp-field">
        <label className="pp-field__label">Tipo de código</label>
        <select
          className="pp-field__select"
          value={element.symbology ?? 'code128'}
          onChange={e => changeSymbology(e.target.value)}
        >
          {Object.entries(groups).map(([cat, syms]) => (
            <optgroup key={cat} label={CATEGORY_LABELS[cat] ?? cat}>
              {syms.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="pp-field">
        <label className="pp-field__label">Variable (dato dinámico)</label>
        <VariableTreeSelect
          value={content.variable}
          onChange={p => setContent({ variable: p })}
          fields={availableFields}
          accept={['string', 'number', 'integer', 'date']}
          placeholder="— Sin variable (usar dato estático) —"
          clearLabel="— Sin variable —"
        />
      </div>

      <div className="pp-field">
        <label className="pp-field__label">Dato {content.variable ? '(fallback)' : '(estático)'}</label>
        <input
          className="pp-field__input"
          value={content.data ?? ''}
          onChange={e => setContent({ data: e.target.value })}
          placeholder="Valor a codificar"
        />
      </div>

      <div className="pp-section-title">Colores (Recursos)</div>

      <div className="pp-field pp-row">
        <label className="pp-field__label">Color de barras</label>
        <FillStyleSelector
          fillStyleId={style.barcodeFillId ?? null}
          fillStyles={fillStyles}
          onSelect={id => setStyle({ barcodeFillId: id })}
          onNavigate={id => state?.setPanelContext?.('fillStyle:' + id)}
          onAddFillStyle={state?.addFillStyle}
          allowNone={false}
          label="Color de barras"
        />
      </div>

      <div className="pp-field pp-row">
        <label className="pp-field__label">Fondo</label>
        <FillStyleSelector
          fillStyleId={style.backgroundFillId ?? null}
          fillStyles={fillStyles}
          onSelect={id => setStyle({ backgroundFillId: id })}
          onNavigate={id => state?.setPanelContext?.('fillStyle:' + id)}
          onAddFillStyle={state?.addFillStyle}
          allowNone
          label="Transparente"
        />
      </div>

      <div className="pp-field" style={{ marginTop: 8 }}>
        <label className="pp-toggle-row">
          <input
            type="checkbox"
            checked={!!content.useEncoding}
            onChange={e => setContent({ useEncoding: e.target.checked })}
          />
          <span>Usar codificación de texto</span>
        </label>
        <p className="pp-field__hint">
          Interpreta secuencias de escape en el dato (ej. <code>\\t</code>, <code>\\xNN</code>) en vez de tomarlas literales. Útil para datos con caracteres de control.
        </p>
      </div>
    </>
  );
}
