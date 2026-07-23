// editor/properties/BasicTab.jsx — Position, size, rotation, scale, visibility, lock

import { useState, useEffect } from 'react';
import { Crosshair, ExternalLink, Pencil, FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { UnitInput } from '../UnitInput.jsx';

const SNAP_MM = 5;
function snapVal(v) { return Math.round(v / SNAP_MM) * SNAP_MM; }

// Number input with local state so the user can type intermediate values like "-" or ""
function NumInput({ value, fallback = 0, min, max, step, validate, className, onChange }) {
  const [local, setLocal] = useState(String(value));
  // Sync from prop when the external value changes (not while typing)
  useEffect(() => { setLocal(String(value)); }, [value]);

  return (
    <input
      className={className}
      type="number"
      step={step}
      min={min}
      max={max}
      value={local}
      onChange={e => {
        setLocal(e.target.value);
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && (!validate || validate(v))) onChange(v);
      }}
      onBlur={() => {
        const v = parseFloat(local);
        if (isNaN(v) || (validate && !validate(v))) {
          setLocal(String(fallback));
          onChange(fallback);
        }
      }}
    />
  );
}

export default function BasicTab({ element, onUpdate, state }) {
  const { x = 0, y = 0, width = 0, height = 0, rotation = 0,
          scaleX = 1, scaleY = 1, visible = true, locked = false } = element;

  const isEmbedded = element.embedded === true;
  const isContentArea = element.type === 'contentarea';
  // Content areas: use template.contentAreas pool
  const allAreas = state?.template?.contentAreas ?? [];
  const currentAreaRef = element.areaRef ?? '';

  function handleAreaSelect(e) {
    const val = e.target.value;
    if (val === '__create__') {
      // Create new area in template pool and assign to this element
      const newId = state?.addContentArea?.();
      if (newId) onUpdate({ areaRef: newId });
    } else if (val) {
      onUpdate({ areaRef: val });
    }
  }

  function handleFocusArea() {
    if (!currentAreaRef || !state) return;
    state.clearSelection?.();
    state.setFocusedAreaCtx?.({ caId: element.id, areaId: currentAreaRef });
  }

  function handleEditArea() {
    if (!currentAreaRef || !state) return;
    state.enterAreaEdit?.(element.id, currentAreaRef, { miniCanvas: true });
  }

  return (
    <div>
      {/* ── Nombre del elemento (se muestra en el árbol de páginas) ── */}
      <div className="pp-field" style={{ marginBottom: 8 }}>
        <label className="pp-field__label">Nombre</label>
        <input
          className="pp-field__input"
          value={element.label ?? ''}
          placeholder="(nombre automático)"
          onChange={e => onUpdate({ label: e.target.value || null })}
        />
      </div>

      {/* ── Área por defecto (solo ContentArea) ── */}
      {isContentArea && (
        <>
          <p className="pp-section-title">Área por defecto</p>
          <div className="bt-style-row">
            <select className="pp-field__select" value={currentAreaRef} onChange={handleAreaSelect}>
              <option value="" disabled>(Sin área)</option>
              {allAreas.map((a, i) => (
                <option key={a.id} value={a.id}>{a.label || `Área ${i + 1}`}</option>
              ))}
              <option value="__create__">+ Crear nueva área...</option>
            </select>
            {currentAreaRef && (
              <>
                <button
                  className="bt-edit-btn"
                  title="Ver propiedades del área"
                  onClick={handleFocusArea}
                >
                  <ExternalLink size={14} />
                </button>
                <button
                  className="bt-edit-btn"
                  title="Editar área (mini-canvas)"
                  onClick={handleEditArea}
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Posición (oculto para elementos embebidos — no tienen posición absoluta) ── */}
      {!isEmbedded && (
        <>
          <div className="pp-section-header">
            <span className="pp-section-title pp-section-title--inline">Posición</span>
            <button
              className="pp-snap-btn"
              title={`Snap a grilla (${SNAP_MM}mm)`}
              onClick={() => onUpdate({ x: snapVal(x), y: snapVal(y) })}
            >
              <Crosshair size={11} />
              <span>⌖{SNAP_MM}</span>
            </button>
          </div>
          <div className="pp-row pp-row--mb">
            <div className="pp-field">
              <label className="pp-field__label">X</label>
              <UnitInput valueMm={x}      min={0} onChange={v => onUpdate({ x: v })} />
            </div>
            <div className="pp-field">
              <label className="pp-field__label">Y</label>
              <UnitInput valueMm={y}      min={0} onChange={v => onUpdate({ y: v })} />
            </div>
          </div>
        </>
      )}

      {/* ── Tamaño ── */}
      <p className="pp-section-title">Tamaño</p>
      <div className="pp-row pp-row--mb">
        <div className="pp-field">
          <label className="pp-field__label">Ancho</label>
          <UnitInput valueMm={width}  min={1} onChange={v => onUpdate({ width: v })} />
        </div>
        <div className="pp-field">
          <label className="pp-field__label">Alto</label>
          <UnitInput valueMm={height} min={1} onChange={v => onUpdate({ height: v })} />
        </div>
      </div>

      {/* ── Transformación (oculto para elementos embebidos) ── */}
      {!isEmbedded && (
        <>
          <p className="pp-section-title">Transformación</p>
          <div className="pp-row pp-row--mb">
            <div className="pp-field">
              <label className="pp-field__label">Rotación (°)</label>
              <NumInput
                className="pp-field__input"
                step={1} min={-360} max={360}
                value={rotation} fallback={0}
                onChange={v => onUpdate({ rotation: v })}
              />
            </div>
          </div>
          <div className="pp-row pp-row--mb">
            <div className="pp-field">
              <label className="pp-field__label">Escala X</label>
              <NumInput
                className="pp-field__input"
                step={0.05} min={0.05} max={10}
                value={Math.abs(scaleX)} fallback={1}
                validate={v => v > 0}
                onChange={v => onUpdate({ scaleX: (scaleX < 0 ? -1 : 1) * v })}
              />
            </div>
            <div className="pp-field">
              <label className="pp-field__label">Escala Y</label>
              <NumInput
                className="pp-field__input"
                step={0.05} min={0.05} max={10}
                value={Math.abs(scaleY)} fallback={1}
                validate={v => v > 0}
                onChange={v => onUpdate({ scaleY: (scaleY < 0 ? -1 : 1) * v })}
              />
            </div>
          </div>
          <div className="pp-row pp-row--mb">
            <div className="pp-field">
              <label className="pp-field__label">Voltear</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className={`pp-field__btn-inline${scaleX < 0 ? ' pp-field__btn-inline--active' : ''}`}
                  title="Voltear horizontalmente (Flip X)"
                  onClick={() => onUpdate({ scaleX: -scaleX })}
                >
                  <FlipHorizontal2 size={13} />
                </button>
                <button
                  className={`pp-field__btn-inline${scaleY < 0 ? ' pp-field__btn-inline--active' : ''}`}
                  title="Voltear verticalmente (Flip Y)"
                  onClick={() => onUpdate({ scaleY: -scaleY })}
                >
                  <FlipVertical2 size={13} />
                </button>
              </div>
            </div>
          </div>

          {isContentArea && (
            <div className="pp-row pp-row--mb">
              <div className="pp-field">
                <label className="pp-field__label">Shear (°)</label>
                <NumInput
                  className="pp-field__input"
                  step={0.5} min={-89} max={89}
                  value={element.shearX ?? 0} fallback={0}
                  validate={v => v >= -89 && v <= 89}
                  onChange={v => onUpdate({ shearX: v })}
                />
              </div>
              <div className="pp-field" style={{ flex: 2 }}>
                <label className="pp-field__label">&nbsp;</label>
                <input
                  type="range" min="-60" max="60" step="0.5"
                  style={{ width: '100%', accentColor: '#7c3aed', cursor: 'pointer', height: 22 }}
                  value={element.shearX ?? 0}
                  onChange={e => onUpdate({ shearX: parseFloat(e.target.value) })}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Comportamiento ── */}
      <p className="pp-section-title">Comportamiento</p>
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Visible</span>
        <input type="checkbox" checked={visible} onChange={e => onUpdate({ visible: e.target.checked })} />
      </div>
      {!isEmbedded && (
        <div className="pp-toggle-row">
          <span className="pp-toggle-row__label">Bloqueado</span>
          <input type="checkbox" checked={locked} onChange={e => onUpdate({ locked: e.target.checked })} />
        </div>
      )}
    </div>
  );
}
