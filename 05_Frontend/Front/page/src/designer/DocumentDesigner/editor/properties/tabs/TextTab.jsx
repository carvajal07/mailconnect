// editor/properties/TextTab.jsx — Text style properties
import { ExternalLink, Plus } from 'lucide-react';
import './TextTab.css';

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New', 'Roboto', 'Open Sans'];
const WEIGHTS = ['Thin', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold'];
const ALIGNS  = ['left', 'center', 'right', 'justify'];
const VALIGNS = ['top', 'middle', 'bottom'];

export default function TextTab({ element, onUpdate, textStyles = [], addTextStyle, onNavigateToStyle }) {
  const ts = element.textStyle ?? {};
  const ps = element.paragraphStyle ?? {};
  const linkedId = element.textStyleId ?? '';

  function updateTs(changes) { onUpdate({ textStyle: { ...ts, ...changes } }); }
  function updatePs(changes) { onUpdate({ paragraphStyle: { ...ps, ...changes } }); }

  function handleStyleSelect(e) {
    const val = e.target.value;
    if (val === '__new__') {
      const newId = addTextStyle?.();
      if (newId) {
        onUpdate({ textStyleId: newId });
        onNavigateToStyle?.(newId);
      }
      return;
    }
    onUpdate({ textStyleId: val || null });
  }

  return (
    <div>
      {/* ── Named style selector ──────────────────────────────────────── */}
      <div className="tt__style-row">
        <label className="pp-field__label">Estilo nombrado</label>
        <div className="tt__style-controls">
          <select className="pp-field__select" value={linkedId} onChange={handleStyleSelect}>
            <option value="">Sin estilo</option>
            {textStyles.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            <option value="__new__">+ Crear nuevo</option>
          </select>
          {linkedId && (
            <button
              className="tt__nav-btn"
              title="Ir al estilo"
              onClick={() => onNavigateToStyle?.(linkedId)}
            >
              <ExternalLink size={12} />
            </button>
          )}
        </div>
      </div>

      {linkedId && (
        <p className="tt__linked-hint">
          Las propiedades de fuente se controlan desde el estilo nombrado.
        </p>
      )}

      {/* ── Inline font props (hidden when linked) ────────────────────── */}
      {!linkedId && (
        <>
          <p className="pp-section-title">Fuente</p>
          <div className="pp-field">
            <label className="pp-field__label">Familia</label>
            <select className="pp-field__select" value={ts.fontFamily ?? 'Inter'} onChange={e => updateTs({ fontFamily: e.target.value })}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="pp-row pp-row--mb">
            <div className="pp-field">
              <label className="pp-field__label">Estilo</label>
              <select className="pp-field__select" value={ts.fontWeight ?? 'Regular'} onChange={e => updateTs({ fontWeight: e.target.value })}>
                {WEIGHTS.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
            </div>
            <div className="pp-field">
              <label className="pp-field__label">Tamaño (pt)</label>
              <input
                className="pp-field__input"
                type="number"
                min="4" max="200" step="0.5"
                value={ts.fontSize ?? 12}
                onChange={e => updateTs({ fontSize: parseFloat(e.target.value) || 12 })}
              />
            </div>
          </div>

          <div className="pp-field">
            <label className="pp-field__label">Color</label>
            <div className="tt__color-row">
              <input
                type="color" className="tt__color-pick"
                value={ts.color ?? '#1f2937'}
                onChange={e => updateTs({ color: e.target.value })}
              />
              <input
                className="pp-field__input tt__hex-input"
                type="text"
                value={ts.color ?? '#1f2937'}
                onChange={e => updateTs({ color: e.target.value })}
              />
            </div>
          </div>

          <div className="tt__deco-row">
            {[
              { key: 'italic',        label: 'I',  cls: 'tt__tog--i' },
              { key: 'underline',     label: 'U',  cls: 'tt__tog--u' },
              { key: 'strikethrough', label: 'S',  cls: 'tt__tog--s' },
            ].map(({ key, label, cls }) => (
              <button
                key={key}
                className={`tt__tog ${cls}${ts[key] ? ' tt__tog--active' : ''}`}
                onClick={() => updateTs({ [key]: !ts[key] })}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="pp-section-title">Párrafo</p>
      <div className="pp-field">
        <label className="pp-field__label">Alineación horizontal</label>
        <div className="tt__align-row">
          {ALIGNS.map(a => (
            <button
              key={a}
              title={a}
              className={`tt__align-btn${ps.alignment === a ? ' tt__align-btn--active' : ''}`}
              onClick={() => updatePs({ alignment: a })}
            >
              {a === 'left' ? '≡L' : a === 'center' ? '≡C' : a === 'right' ? '≡R' : '≡J'}
            </button>
          ))}
        </div>
      </div>
      <div className="pp-field">
        <label className="pp-field__label">Alineación vertical</label>
        <select className="pp-field__select" value={ps.verticalAlign ?? 'top'} onChange={e => updatePs({ verticalAlign: e.target.value })}>
          {VALIGNS.map(v => <option key={v} value={v}>{v === 'top' ? 'Arriba' : v === 'middle' ? 'Centro' : 'Abajo'}</option>)}
        </select>
      </div>
      <div className="pp-field">
        <label className="pp-field__label">Interlineado</label>
        <input
          className="pp-field__input"
          type="number" min="0.5" max="5" step="0.1"
          value={ts.lineHeight ?? 1.4}
          onChange={e => updateTs({ lineHeight: parseFloat(e.target.value) || 1.4 })}
        />
      </div>
    </div>
  );
}
