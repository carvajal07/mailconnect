// editor/properties/FillTab.jsx — Fill (elemento): fill style o relleno inline

import FillStyleSelector from '../../resources/fill/FillStyleSelector.jsx';

const INLINE_TYPES = [
  { value: 'none',     label: 'Sin relleno' },
  { value: 'solid',    label: 'Color sólido' },
  { value: 'gradient', label: 'Degradado'    },
];

export default function FillTab({ element, onUpdate, fillStyles = [], addFillStyle, onNavigateToStyle }) {
  const fill = element.fill ?? { type: 'none', color: '#ffffff', opacity: 1 };

  function updateFill(changes) { onUpdate({ fill: { ...fill, ...changes } }); }

  const hasFillStyle = !!fill.fillStyleId;

  return (
    <div>
      {/* ── Fill Style (selector universal) ── */}
      <p className="pp-section-title">Fill Style</p>
      <div className="pp-field">
        <FillStyleSelector
          fillStyleId={fill.fillStyleId ?? null}
          fillStyles={fillStyles}
          onSelect={id => {
            if (id) {
              updateFill({ fillStyleId: id });
            } else {
              const { fillStyleId: _removed, ...rest } = fill;
              onUpdate({ fill: { ...rest } });
            }
          }}
          onNavigate={onNavigateToStyle}
          onAddFillStyle={addFillStyle}
          fallbackColor={fill.color ?? '#ffffff'}
          fallbackOpacity={fill.opacity ?? 1}
        />
      </div>

      {/* ── Inline (solo si no hay fill style) ── */}
      {!hasFillStyle && (
        <>
          <p className="pp-section-title" style={{ marginTop: 10 }}>Relleno inline</p>
          <div className="pp-field">
            <select
              className="pp-field__select"
              value={fill.type ?? 'none'}
              onChange={e => updateFill({ type: e.target.value })}
            >
              {INLINE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {fill.type === 'solid' && (
            <>
              <div className="pp-field">
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {/* Compact swatch trigger → popup con fill styles + color picker */}
                  <FillStyleSelector
                    compact
                    fillStyleId={null}
                    fillStyles={fillStyles}
                    onSelect={id => { if (id) updateFill({ fillStyleId: id }); }}
                    onNavigate={onNavigateToStyle}
                    onAddFillStyle={addFillStyle}
                    fallbackColor={fill.color ?? '#ffffff'}
                    fallbackOpacity={fill.opacity ?? 1}
                  />
                  <input
                    className="pp-field__input"
                    type="text"
                    value={fill.color ?? '#ffffff'}
                    onChange={e => updateFill({ color: e.target.value })}
                    style={{ fontFamily: 'monospace', width: 80 }}
                  />
                </div>
              </div>
              <div className="pp-field">
                <label className="pp-field__label">Opacidad (%)</label>
                <input
                  className="pp-field__input"
                  type="range" min="0" max="100" step="1"
                  value={Math.round((fill.opacity ?? 1) * 100)}
                  onChange={e => updateFill({ opacity: parseInt(e.target.value) / 100 })}
                />
                <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {Math.round((fill.opacity ?? 1) * 100)}%
                </span>
              </div>
            </>
          )}

          {fill.type === 'gradient' && addFillStyle && (
            <div className="pp-field">
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>
                Configura el degradado desde un Fill Style.
              </p>
              <button
                className="pp-field__btn-secondary"
                onClick={() => {
                  const id = addFillStyle({ type: 'gradient' });
                  if (id) { updateFill({ fillStyleId: id }); onNavigateToStyle?.(id); }
                }}
              >
                + Crear Fill Style de Degradado
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
