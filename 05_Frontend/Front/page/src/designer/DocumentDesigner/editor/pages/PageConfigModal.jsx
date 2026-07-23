// PageConfigModal.jsx — Configuración completa de una página
// Tabs: Tamaño | Márgenes | Fondo | Flujo
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import { PAGE_PRESETS } from '../../engine/units.js';
import { SYSTEM_FIELDS } from '../../engine/systemFields.js';
import './PageConfigModal.css';

const TABS = ['Tamaño', 'Márgenes', 'Fondo', 'Flujo'];

const FLOW_TYPES = [
  { value: null,          label: 'Normal (siguiente en orden)' },
  { value: 'goto',        label: 'Ir a página específica' },
  { value: 'conditional', label: 'Condicional (por datos)' },
  { value: 'repeat',      label: 'Repetir por array de datos' },
];

const OPERATORS = [
  { value: '===',         label: '== Igual a' },
  { value: '!==',         label: '≠ Distinto de' },
  { value: '>',           label: '> Mayor que' },
  { value: '>=',          label: '≥ Mayor o igual' },
  { value: '<',           label: '< Menor que' },
  { value: '<=',          label: '≤ Menor o igual' },
  { value: 'includes',    label: '∈ Contiene' },
  { value: 'starts_with', label: '^ Empieza con' },
  { value: 'is_true',     label: '✓ Es verdadero' },
  { value: 'is_false',    label: '✗ Es falso' },
  { value: 'is_empty',    label: '∅ Está vacío' },
  { value: 'is_not_empty',label: '• No está vacío' },
  { value: 'exists',      label: '? Existe' },
];

function genId() { return `cond_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Tabs de contenido ─────────────────────────────────────────────────────

function SizeTab({ data, onChange }) {
  const isCustom = data.size?.preset === 'custom';

  return (
    <div className="pcm-form">
      <div className="pcm-field">
        <label>Nombre de la página</label>
        <input
          value={data.name ?? ''}
          onChange={e => onChange({ name: e.target.value })}
          className="pcm-input"
        />
      </div>

      <div className="pcm-field">
        <label>Preset</label>
        <div className="pcm-presets">
          {[...Object.keys(PAGE_PRESETS), 'custom'].map(preset => (
            <button
              key={preset}
              className={`pcm-preset-btn${(data.size?.preset ?? 'A4') === preset ? ' pcm-preset-btn--active' : ''}`}
              onClick={() => {
                if (preset === 'custom') {
                  onChange({ size: { ...data.size, preset: 'custom' } });
                } else {
                  const { width, height } = PAGE_PRESETS[preset];
                  onChange({ size: { preset, width, height, unit: 'mm' } });
                }
              }}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      {isCustom && (
        <div className="pcm-row">
          <div className="pcm-field">
            <label>Ancho (mm)</label>
            <input
              type="number" min="10" max="1000"
              value={data.size?.width ?? 210}
              onChange={e => onChange({ size: { ...data.size, width: parseFloat(e.target.value) || 210 } })}
              className="pcm-input pcm-input--number"
            />
          </div>
          <div className="pcm-field">
            <label>Alto (mm)</label>
            <input
              type="number" min="10" max="1000"
              value={data.size?.height ?? 297}
              onChange={e => onChange({ size: { ...data.size, height: parseFloat(e.target.value) || 297 } })}
              className="pcm-input pcm-input--number"
            />
          </div>
        </div>
      )}

      <div className="pcm-field">
        <label>Orientación</label>
        <div className="pcm-toggle">
          {['portrait', 'landscape'].map(o => (
            <button
              key={o}
              className={`pcm-toggle-btn${(data.orientation ?? 'portrait') === o ? ' pcm-toggle-btn--active' : ''}`}
              onClick={() => onChange({ orientation: o })}
            >
              {o === 'portrait' ? '⬜ Vertical' : '⬛ Horizontal'}
            </button>
          ))}
        </div>
      </div>

      <div className="pcm-field">
        <label>Página visible en el documento</label>
        <label className="pcm-checkbox">
          <input
            type="checkbox"
            checked={data.visible !== false}
            onChange={e => onChange({ visible: e.target.checked })}
          />
          <span>Visible</span>
        </label>
      </div>

      <div className="pcm-field">
        <label>Altura dinámica</label>
        <label className="pcm-checkbox">
          <input
            type="checkbox"
            checked={data.dynamicHeight ?? false}
            onChange={e => onChange({ dynamicHeight: e.target.checked })}
          />
          <span>Ajustar altura al contenido</span>
        </label>
      </div>

      {data.dynamicHeight && (
        <div className="pcm-field">
          <label>Altura extra (mm)</label>
          <input
            type="number" min="0" max="100"
            value={data.addHeightToPage ?? 0}
            onChange={e => onChange({ addHeightToPage: parseFloat(e.target.value) || 0 })}
            className="pcm-input pcm-input--number"
          />
        </div>
      )}
    </div>
  );
}

function MarginsTab({ data, onChange }) {
  const m = data.margins ?? { top: 20, right: 20, bottom: 20, left: 20 };
  const [linked, setLinked] = useState(true);

  function updateMargin(side, value) {
    const val = parseFloat(value) || 0;
    if (linked) {
      onChange({ margins: { top: val, right: val, bottom: val, left: val } });
    } else {
      onChange({ margins: { ...m, [side]: val } });
    }
  }

  return (
    <div className="pcm-form">
      <div className="pcm-field">
        <label>Márgenes iguales en todos los lados</label>
        <label className="pcm-checkbox">
          <input type="checkbox" checked={linked} onChange={e => setLinked(e.target.checked)} />
          <span>Vincular márgenes</span>
        </label>
      </div>

      <div className="pcm-margins-grid">
        <div />
        <div className="pcm-field pcm-field--center">
          <label>Superior</label>
          <input type="number" min="0" value={m.top} onChange={e => updateMargin('top', e.target.value)} className="pcm-input pcm-input--number" />
          <span className="pcm-unit">mm</span>
        </div>
        <div />

        <div className="pcm-field pcm-field--center">
          <label>Izq.</label>
          <input type="number" min="0" value={m.left} onChange={e => updateMargin('left', e.target.value)} className="pcm-input pcm-input--number" />
          <span className="pcm-unit">mm</span>
        </div>
        <div className="pcm-margins-preview">
          <div className="pcm-margins-outer">
            <div
              className="pcm-margins-inner"
              style={{
                top: `${(m.top / ((data.size?.height ?? 297))) * 100}%`,
                right: `${(m.right / ((data.size?.width ?? 210))) * 100}%`,
                bottom: `${(m.bottom / ((data.size?.height ?? 297))) * 100}%`,
                left: `${(m.left / ((data.size?.width ?? 210))) * 100}%`,
              }}
            />
          </div>
        </div>
        <div className="pcm-field pcm-field--center">
          <label>Der.</label>
          <input type="number" min="0" value={m.right} onChange={e => updateMargin('right', e.target.value)} className="pcm-input pcm-input--number" />
          <span className="pcm-unit">mm</span>
        </div>

        <div />
        <div className="pcm-field pcm-field--center">
          <label>Inferior</label>
          <input type="number" min="0" value={m.bottom} onChange={e => updateMargin('bottom', e.target.value)} className="pcm-input pcm-input--number" />
          <span className="pcm-unit">mm</span>
        </div>
        <div />
      </div>
    </div>
  );
}

function BackgroundTab({ data, onChange }) {
  const bg = data.background ?? { type: 'solid', color: '#ffffff' };

  return (
    <div className="pcm-form">
      <div className="pcm-field">
        <label>Tipo de fondo</label>
        <select
          value={bg.type}
          onChange={e => onChange({ background: { ...bg, type: e.target.value } })}
          className="pcm-select"
        >
          <option value="none">Sin fondo</option>
          <option value="solid">Color sólido</option>
        </select>
      </div>

      {bg.type === 'solid' && (
        <div className="pcm-field">
          <label>Color</label>
          <div className="pcm-color-row">
            <input
              type="color"
              value={bg.color ?? '#ffffff'}
              onChange={e => onChange({ background: { ...bg, color: e.target.value } })}
              className="pcm-color-input"
            />
            <input
              type="text"
              value={bg.color ?? '#ffffff'}
              onChange={e => onChange({ background: { ...bg, color: e.target.value } })}
              className="pcm-input"
              placeholder="#ffffff"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FlowTab({ data, onChange, allPages }) {
  const flow = data.pageFlow ?? { type: null };
  const flowType = flow.type ?? null;

  function setFlowType(type) {
    if (!type) {
      onChange({ pageFlow: null });
    } else if (type === 'goto') {
      onChange({ pageFlow: { type, gotoPageId: '' } });
    } else if (type === 'conditional') {
      onChange({ pageFlow: { type, conditions: [], defaultNextPageId: null } });
    } else if (type === 'repeat') {
      onChange({ pageFlow: { type, dataSource: '', minRepetitions: 1, maxRepetitions: 100, continueAfter: true } });
    }
  }

  function updateFlow(changes) {
    onChange({ pageFlow: { ...flow, ...changes } });
  }

  function addCondition() {
    const cond = { id: genId(), variable: '', operator: '===', value: '', nextPageId: '' };
    updateFlow({ conditions: [...(flow.conditions ?? []), cond] });
  }

  function updateCondition(id, changes) {
    updateFlow({
      conditions: (flow.conditions ?? []).map(c => c.id === id ? { ...c, ...changes } : c),
    });
  }

  function removeCondition(id) {
    updateFlow({ conditions: (flow.conditions ?? []).filter(c => c.id !== id) });
  }

  const otherPages = allPages.filter(p => p.id !== data.id);

  return (
    <div className="pcm-form">
      <div className="pcm-field">
        <label>Tipo de flujo</label>
        <select
          value={flowType ?? ''}
          onChange={e => setFlowType(e.target.value || null)}
          className="pcm-select"
        >
          {FLOW_TYPES.map(f => (
            <option key={String(f.value)} value={f.value ?? ''}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {/* ── Goto ── */}
      {flowType === 'goto' && (
        <div className="pcm-field">
          <label>Ir a página</label>
          <select
            value={flow.gotoPageId ?? ''}
            onChange={e => updateFlow({ gotoPageId: e.target.value })}
            className="pcm-select"
          >
            <option value="">— Seleccionar página —</option>
            {otherPages.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* ── Repeat ── */}
      {flowType === 'repeat' && (
        <>
          <div className="pcm-field">
            <label>Fuente de datos (array)</label>
            <input
              value={flow.dataSource ?? ''}
              onChange={e => updateFlow({ dataSource: e.target.value })}
              placeholder="customers, orders, items..."
              className="pcm-input"
            />
            <p className="pcm-hint">
              Path al array en el WorkflowPacket. Ej: <code>orders</code>, <code>customer.items</code>
            </p>
          </div>
          <div className="pcm-row">
            <div className="pcm-field">
              <label>Mín. repeticiones</label>
              <input type="number" min="0" value={flow.minRepetitions ?? 1}
                onChange={e => updateFlow({ minRepetitions: parseInt(e.target.value) || 1 })}
                className="pcm-input pcm-input--number" />
            </div>
            <div className="pcm-field">
              <label>Máx. repeticiones</label>
              <input type="number" min="1" value={flow.maxRepetitions ?? 100}
                onChange={e => updateFlow({ maxRepetitions: parseInt(e.target.value) || 100 })}
                className="pcm-input pcm-input--number" />
            </div>
          </div>
          <div className="pcm-field">
            <label className="pcm-checkbox">
              <input type="checkbox" checked={flow.continueAfter ?? true}
                onChange={e => updateFlow({ continueAfter: e.target.checked })} />
              <span>Continuar con la siguiente página tras repetir</span>
            </label>
          </div>
          <p className="pcm-hint">
            Variables disponibles: <code>{'{{$item.campo}}'}</code>, <code>{'{{$index}}'}</code>, <code>{'{{$iteration}}'}</code>, <code>{'{{$isFirst}}'}</code>, <code>{'{{$isLast}}'}</code>, <code>{'{{$total}}'}</code>
          </p>
        </>
      )}

      {/* ── Conditional ── */}
      {flowType === 'conditional' && (
        <>
          <p className="pcm-section-label">Condiciones (se evalúan en orden)</p>

          {(flow.conditions ?? []).map((cond, i) => (
            <div key={cond.id} className="pcm-condition">
              <div className="pcm-condition__header">
                <span className="pcm-condition__num">{i + 1}</span>
                <button className="pcm-condition__del" onClick={() => removeCondition(cond.id)}>
                  <Trash2 size={11} />
                </button>
              </div>
              <div className="pcm-field">
                <label>Variable / campo</label>
                <input
                  value={cond.variable ?? ''}
                  onChange={e => updateCondition(cond.id, { variable: e.target.value })}
                  placeholder="order.status, total, $overflow..."
                  className="pcm-input"
                  list="pcm-sysvars"
                />
              </div>
              <div className="pcm-row">
                <div className="pcm-field">
                  <label>Operador</label>
                  <select
                    value={cond.operator ?? '==='}
                    onChange={e => updateCondition(cond.id, { operator: e.target.value })}
                    className="pcm-select"
                  >
                    {OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                </div>
                {!['is_true','is_false','is_empty','is_not_empty','exists'].includes(cond.operator) && (
                  <div className="pcm-field">
                    <label>Valor</label>
                    <input
                      value={cond.value ?? ''}
                      onChange={e => updateCondition(cond.id, { value: e.target.value })}
                      placeholder="valor..."
                      className="pcm-input"
                    />
                  </div>
                )}
              </div>
              <div className="pcm-field">
                <label>Ir a página</label>
                <select
                  value={cond.nextPageId ?? ''}
                  onChange={e => updateCondition(cond.id, { nextPageId: e.target.value })}
                  className="pcm-select"
                >
                  <option value="">— Seleccionar página —</option>
                  <option value={data.id}>↩ Esta misma página (self-loop)</option>
                  {otherPages.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
          ))}

          <button className="pcm-add-btn" onClick={addCondition}>
            <Plus size={12} /> Agregar condición
          </button>

          <div className="pcm-field" style={{ marginTop: 12 }}>
            <label>Por defecto (si ninguna condición se cumple)</label>
            <select
              value={flow.defaultNextPageId ?? ''}
              onChange={e => updateFlow({ defaultNextPageId: e.target.value || null })}
              className="pcm-select"
            >
              <option value="">Flujo normal (siguiente en orden)</option>
              {otherPages.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <p className="pcm-hint">
            Usa <code>$overflow</code> (variable de sistema booleana) para repetir/encadenar páginas cuando
            el contenido desborda — ej. <em>si <code>$overflow</code> es verdadero → ir a esta misma página</em>.
            Al escribir en "Variable" aparecen las variables de sistema disponibles.
          </p>
          {/* Variables de SISTEMA disponibles en el autocompletado del input "Variable". */}
          <datalist id="pcm-sysvars">
            {SYSTEM_FIELDS.map(f => (
              <option key={f.path} value={f.path}>{f.label}</option>
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}

// ── Modal principal ───────────────────────────────────────────────────────

export default function PageConfigModal({ page, allPages, onSave, onClose }) {
  const [activeTab, setActiveTab] = useState('Tamaño');
  const [data, setData] = useState({ ...page });

  function merge(changes) {
    setData(prev => ({ ...prev, ...changes }));
  }

  const tabContent = {
    'Tamaño':   <SizeTab      data={data} onChange={merge} />,
    'Márgenes': <MarginsTab   data={data} onChange={merge} />,
    'Fondo':    <BackgroundTab data={data} onChange={merge} />,
    'Flujo':    <FlowTab      data={data} onChange={merge} allPages={allPages} />,
  };

  return createPortal(
    <div className="pcm-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="pcm-modal">
        {/* Header */}
        <div className="pcm-modal__header">
          <span className="pcm-modal__title">Configurar página: {page.name}</span>
          <button className="pcm-modal__close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="pcm-tabs">
          {TABS.map(tab => (
            <button
              key={tab}
              className={`pcm-tab${activeTab === tab ? ' pcm-tab--active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="pcm-modal__body">
          {tabContent[activeTab]}
        </div>

        {/* Footer */}
        <div className="pcm-modal__footer">
          <button className="pcm-btn pcm-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="pcm-btn pcm-btn--primary" onClick={() => onSave(data)}>Guardar</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
