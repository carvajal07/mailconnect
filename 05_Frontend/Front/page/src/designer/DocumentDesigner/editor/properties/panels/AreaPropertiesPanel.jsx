// editor/properties/AreaPropertiesPanel.jsx — Properties panel shown when an area is active in area-edit mode

import { useState, useMemo, useEffect } from 'react';
import { ChevronRight, Plus, Trash2, RefreshCw, GitBranch, Layers, Pencil, Maximize2, Edit2, ExternalLink, Eye, List } from 'lucide-react';
import { UnitInput }       from '../UnitInput.jsx';
import ExpressionBuilder   from '../../pages/ExpressionBuilder.jsx';
import ScriptEditor        from '../../../../ScriptProcessor/config/ScriptEditor.jsx';
import ScriptEditorModal   from '../../pages/ScriptEditorModal.jsx';
import VariableTreeSelect  from '../../components/VariableTreeSelect.jsx';
import '../../../../ScriptProcessor/ScriptProcessor.config.css';
import './AreaPropertiesPanel.css';

// ── Flow type catalog ─────────────────────────────────────────────────────────

const FLOW_TYPES = [
  { value: 'simple',           label: 'Simple',   desc: 'Área estática de una sola instancia' },
  { value: 'repeated',         label: 'Repetido', desc: 'Se repite por cada ítem del array seleccionado' },
  { value: 'inline-condition', label: 'Variable', desc: 'Selecciona un área hija según una variable o condición' },
  { value: 'section',          label: 'Sección',  desc: 'Contenedor de varios flujos en secuencia' },
];

const FLOW_ICONS = {
  simple:             <Layers size={11} />,
  repeated:           <RefreshCw size={11} />,
  'inline-condition': <GitBranch size={11} />,
  section:            <List size={11} />,
};

const FITTING_MODES = [
  { value: 'none',                label: 'Ninguno' },
  { value: 'first-fitting',       label: 'Primer ajuste' },
  { value: 'first-fitting-auto',  label: 'Primer ajuste automático' },
];

// ── Selection sub-types ───────────────────────────────────────────────────────

const SEL_TYPES = [
  { v: 'condition', label: 'Condición', hint: 'Expresión JS' },
  { v: 'text',      label: 'Texto',     hint: 'Valor texto'  },
  { v: 'number',    label: 'Número',    hint: 'Valor número' },
  { v: 'bool',      label: 'Bool',      hint: 'Verdad/Falso' },
  { v: 'script',    label: 'Script',    hint: 'JS avanzado'  },
];

// ── System fields (always available) ─────────────────────────────────────────

const SYSTEM_FIELDS = [
  { path: '$item',         type: 'object'  },
  { path: '$index',        type: 'number'  },
  { path: '$pageNumber',   type: 'number'  },
  { path: '$totalPages',   type: 'number'  },
  { path: '$date',         type: 'string'  },
  { path: '$datetime',     type: 'string'  },
  { path: '$documentName', type: 'string'  },
  { path: '$overflow',     type: 'boolean' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function ruleConditionSummary(cond) {
  if (cond.conditionType === 'script') return '{ script }';
  const clauses = cond.expression?.clauses ?? [];
  if (!clauses.length) return '...';
  const c   = clauses[0];
  const lft = c.left?.path  || c.left?.value  || '?';
  const op  = c.operator?.replace(/_/g, ' ') || '?';
  const rgt = c.right?.value || c.right?.path || '?';
  return `${lft} ${op} ${rgt}${clauses.length > 1 ? ` +${clauses.length - 1}` : ''}`;
}

function genId(prefix = 'x') {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

function flattenFields(fields, result = []) {
  for (const f of fields ?? []) {
    result.push(f);
    if (f.children?.length) flattenFields(f.children, result);
  }
  return result;
}

// ── AreaSelect — select with "create new" option ──────────────────────────────

function AreaSelect({ value, children, onChange, onCreateNew, placeholder = '— seleccionar —' }) {
  return (
    <select
      className="ap-area-sel"
      value={value ?? ''}
      onChange={e => {
        if (e.target.value === '__new__') onCreateNew?.();
        else onChange(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {children.map(ch => (
        <option key={ch.id} value={ch.id}>{ch.label || `Subárea (${ch.id.slice(-4)})`}</option>
      ))}
      <option value="__new__">+ Crear nueva subárea</option>
    </select>
  );
}

// ── VariableSelect — grouped select: workflow fields + system fields ──────────

function VariableSelect({ value, onChange, workflowFields, systemFields, placeholder = '— seleccionar variable —' }) {
  // Une campos del workflow + variables del sistema en una sola lista para el
  // picker en árbol (badges de tipo + jerarquía).
  const fields = useMemo(() => ([
    ...(workflowFields ?? []),
    ...(systemFields ?? []).map(f => ({ ...f, path: f.path ?? f.name, label: f.path ?? f.name })),
  ]), [workflowFields, systemFields]);
  return (
    <VariableTreeSelect
      value={value}
      onChange={(p) => onChange(p ?? '')}
      fields={fields}
      placeholder={placeholder}
      clearLabel="— Sin variable —"
    />
  );
}

// ── FieldInput — input with datalist suggestions ──────────────────────────────

function FieldInput({ id, value, onChange, placeholder, fields }) {
  const listId = `ap-fl-${id}`;
  return (
    <div className="ap-field-input-wrap">
      <input
        className="pp-field__input ap-code-input"
        list={listId}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {(fields ?? []).map(f => (
          <option key={f.path ?? f.name} value={f.path ?? f.name}>{f.name ?? f.path}</option>
        ))}
      </datalist>
    </div>
  );
}

// ── FlujoTab ──────────────────────────────────────────────────────────────────

export function FlujoTab({ area, caId, updateArea, addArea, removeArea, enterAreaEdit, migrateAreaToCondition, migrateAreaFromCondition, previewAreaCtx, setPreviewAreaCtx, availableFields, getContentAreaUsage, textStyles, addTextStyle, onNavigateToStyle, allAreas }) {
  const flowType    = area.flowType          ?? 'simple';
  const height      = area.height            ?? 30;
  const visible     = area.visible           ?? true;
  const dataPath    = area.dataPath          ?? '';
  const selType     = area.selectionType     ?? 'condition';
  const selVariable = area.selectionVariable ?? '';
  const selMappings = area.selectionMappings ?? [];
  const selScript   = area.selectionScript   ?? '';
  const children      = area.children      ?? [];
  const conditions    = area.conditions    ?? [];
  const defaultAreaId = area.defaultAreaId ?? '';
  const trueAreaId    = area.trueAreaId    ?? '';
  const falseAreaId   = area.falseAreaId   ?? '';

  const [exprCondId,    setExprCondId]    = useState(null);
  const [showScriptModal, setShowScriptModal] = useState(false);

  // Field lists — workflow and system separated for grouped selects
  const wfFlat       = useMemo(() => flattenFields(availableFields ?? []), [availableFields]);
  const allFields    = useMemo(() => [...wfFlat, ...SYSTEM_FIELDS], [wfFlat]);
  const arrayFields  = useMemo(() => allFields.filter(f => f.type === 'array'   || f.type === 'object'),  [allFields]);
  const arrayOpts    = arrayFields.length ? arrayFields : allFields;

  // Per-type split: workflow vs system
  const wfStrings  = useMemo(() => wfFlat.filter(f => f.type === 'string'  || f.type === 'text'),    [wfFlat]);
  const wfNumbers  = useMemo(() => wfFlat.filter(f => f.type === 'number'  || f.type === 'integer'), [wfFlat]);
  const wfBools    = useMemo(() => wfFlat.filter(f => f.type === 'boolean' || f.type === 'bool'),    [wfFlat]);
  const sysStrings = SYSTEM_FIELDS.filter(f => f.type === 'string');
  const sysNumbers = SYSTEM_FIELDS.filter(f => f.type === 'number');
  const sysBools   = SYSTEM_FIELDS.filter(f => f.type === 'boolean');

  // Condition branch preview toggle
  function togglePreview(areaId) {
    setPreviewAreaCtx?.(prev =>
      prev?.caId === caId && prev?.areaId === areaId ? null : { caId, areaId }
    );
  }
  function isPreviewActive(areaId) {
    return previewAreaCtx?.caId === caId && previewAreaCtx?.areaId === areaId;
  }

  // Auto-activate the default area preview when this is an inline-condition area
  useEffect(() => {
    if (flowType !== 'inline-condition' || !defaultAreaId) return;
    if (!previewAreaCtx || previewAreaCtx.caId !== caId) {
      setPreviewAreaCtx?.({ caId, areaId: defaultAreaId });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowType, defaultAreaId, caId]);

  // Condition rows
  function addCondition() {
    updateArea(caId, area.id, {
      conditions: [...conditions, { id: genId('cond'), conditionType: 'expression', expression: null, script: '', areaId: '' }],
    });
  }
  function removeCondition(id) {
    updateArea(caId, area.id, { conditions: conditions.filter(c => c.id !== id) });
  }
  function updateCondition(id, changes) {
    updateArea(caId, area.id, { conditions: conditions.map(c => c.id === id ? { ...c, ...changes } : c) });
  }

  // Mapping rows (text / number)
  function addMapping() {
    updateArea(caId, area.id, { selectionMappings: [...selMappings, { id: genId('m'), value: '', areaId: '' }] });
  }
  function removeMapping(id) {
    updateArea(caId, area.id, { selectionMappings: selMappings.filter(m => m.id !== id) });
  }
  function updateMapping(id, changes) {
    updateArea(caId, area.id, { selectionMappings: selMappings.map(m => m.id === id ? { ...m, ...changes } : m) });
  }

  // Area helpers
  function areaChange(field) { return v => updateArea(caId, area.id, { [field]: v }); }
  function areaCreate(field) { return () => { const id = addArea(caId, area.id); updateArea(caId, area.id, { [field]: id }); }; }

  // Derived — open condition for ExpressionBuilder modal
  const openCond = exprCondId ? (conditions.find(c => c.id === exprCondId) ?? null) : null;

  // Usage info
  const usages = getContentAreaUsage?.(area.id) ?? [];

  return (
    <div>
      {/* ── Nombre ── */}
      <p className="pp-section-title">Nombre</p>
      <div className="pp-field">
        <input
          className="pp-field__input"
          value={area.label ?? ''}
          onChange={e => updateArea(caId, area.id, { label: e.target.value })}
          placeholder="Nombre del área"
        />
      </div>

      {/* ── Main flow type ── */}
      <p className="pp-section-title">Tipo de flujo</p>
      <div className="ap-type-row">
        {FLOW_TYPES.map(ft => (
          <button
            key={ft.value}
            className={`ap-type-chip${flowType === ft.value ? ' ap-type-chip--active' : ''}`}
            onClick={() => {
              if (ft.value === 'inline-condition') {
                migrateAreaToCondition?.(caId, area.id);
              } else if (flowType === 'inline-condition') {
                migrateAreaFromCondition?.(caId, area.id, ft.value);
              } else {
                updateArea(caId, area.id, { flowType: ft.value });
              }
            }}
            title={ft.desc}
          >
            <span className="ap-type-chip__icon">{FLOW_ICONS[ft.value]}</span>
            <span className="ap-type-chip__label">{ft.label}</span>
          </button>
        ))}
      </div>

      {/* ── Repeated ── */}
      {flowType === 'repeated' && (
        <>
          <p className="pp-section-title">Fuente de datos</p>
          <div className="pp-field">
            <label className="pp-field__label">Array a iterar</label>
            <FieldInput id="rep" value={dataPath} onChange={v => updateArea(caId, area.id, { dataPath: v })}
              placeholder="ej: items, orders.lines" fields={arrayOpts} />
          </div>
        </>
      )}

      {/* ── Variable (inline-condition) ── */}
      {flowType === 'inline-condition' && (
        <>
          {/* Sub-type selector */}
          <p className="pp-section-title">Tipo de selección</p>
          <div className="ap-sel-grid">
            {SEL_TYPES.map(st => (
              <button
                key={st.v}
                className={`ap-sel-card${selType === st.v ? ' ap-sel-card--active' : ''}`}
                onClick={() => updateArea(caId, area.id, { selectionType: st.v, selectionVariable: '' })}
                title={st.hint}
              >
                <span className="ap-sel-card__label">{st.label}</span>
                <span className="ap-sel-card__hint">{st.hint}</span>
              </button>
            ))}
          </div>

          {/* ── Condition ── */}
          {selType === 'condition' && (
            <>
              <p className="pp-section-title">Reglas de condición</p>
              <table className="ap-rules-table">
                <thead>
                  <tr><th>Condición</th><th>Subárea</th><th></th></tr>
                </thead>
                <tbody>
                  {conditions.map(cond => (
                    <tr key={cond.id} className="ap-rule-row">
                      <td>
                        <button className="ap-rule-expr-btn" onClick={() => setExprCondId(cond.id)}>
                          <Edit2 size={10} className="ap-rule-expr-icon" />
                          {ruleConditionSummary(cond)}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                          <AreaSelect value={cond.areaId} children={children}
                            onChange={v => updateCondition(cond.id, { areaId: v })}
                            onCreateNew={() => { const id = addArea(caId, area.id); updateCondition(cond.id, { areaId: id }); }}
                          />
                          {cond.areaId && (
                            <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(cond.areaId)}
                              style={isPreviewActive(cond.areaId) ? { color: '#f97316' } : undefined}>
                              <Eye size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        <button className="ap-icon-btn ap-icon-btn--danger" onClick={() => removeCondition(cond.id)}>
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="ap-rule-row ap-rule-row--default">
                    <td><span className="ap-default-label">Default</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                        <AreaSelect value={defaultAreaId} children={children}
                          onChange={areaChange('defaultAreaId')} onCreateNew={areaCreate('defaultAreaId')}
                          placeholder="— omitir —"
                        />
                        {defaultAreaId && (
                          <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(defaultAreaId)}
                            style={isPreviewActive(defaultAreaId) ? { color: '#f97316' } : undefined}>
                            <Eye size={11} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              <button className="ap-add-cond-btn" onClick={addCondition}>
                <Plus size={12} /> Añadir regla
              </button>

              {/* ExpressionBuilder modal */}
              {openCond && (
                <ExpressionBuilder
                  rule={openCond}
                  availableFields={allFields}
                  onSave={(expr) => {
                    updateCondition(openCond.id, {
                      conditionType: expr.type === 'script' ? 'script' : 'expression',
                      expression: expr,
                      script: expr.script ?? '',
                    });
                    setExprCondId(null);
                  }}
                  onClose={() => setExprCondId(null)}
                />
              )}
            </>
          )}

          {/* ── Text / Number panel ── */}
          {(selType === 'text' || selType === 'number') && (
            <div className="ap-vp">
              {/* Variable row */}
              <div className="ap-vp__var-row">
                <span className="ap-vp__var-label">Variable</span>
                <VariableSelect
                  value={selVariable}
                  onChange={v => updateArea(caId, area.id, { selectionVariable: v })}
                  workflowFields={selType === 'number' ? wfNumbers : wfStrings}
                  systemFields={selType === 'number' ? sysNumbers : sysStrings}
                />
              </div>

              {/* Column headers */}
              <div className="ap-vp__cols">
                <span className="ap-vp__col-hd ap-vp__col-hd--val">Valor</span>
                <span className="ap-vp__col-hd ap-vp__col-hd--area">Subárea</span>
              </div>

              {/* Value rows */}
              {selMappings.map(m => (
                <div key={m.id} className="ap-vp__row">
                  <input
                    className="ap-vp__val-input ap-code-input"
                    type={selType === 'number' ? 'number' : 'text'}
                    value={m.value ?? ''}
                    onChange={e => updateMapping(m.id, { value: selType === 'number' ? +e.target.value : e.target.value })}
                    placeholder={selType === 'number' ? '0' : 'valor'}
                  />
                  <AreaSelect value={m.areaId} children={children}
                    onChange={v => updateMapping(m.id, { areaId: v })}
                    onCreateNew={() => { const id = addArea(caId, area.id); updateMapping(m.id, { areaId: id }); }}
                  />
                  {m.areaId && (
                    <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(m.areaId)}
                      style={isPreviewActive(m.areaId) ? { color: '#f97316' } : undefined}>
                      <Eye size={11} />
                    </button>
                  )}
                  <button className="ap-icon-btn ap-icon-btn--danger" onClick={() => removeMapping(m.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}

              {/* Default row */}
              <div className="ap-vp__row ap-vp__row--default">
                <span className="ap-vp__default-lbl">Default</span>
                <AreaSelect value={defaultAreaId} children={children}
                  onChange={areaChange('defaultAreaId')} onCreateNew={areaCreate('defaultAreaId')}
                  placeholder="— sin defecto —"
                />
                {defaultAreaId && (
                  <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(defaultAreaId)}
                    style={isPreviewActive(defaultAreaId) ? { color: '#f97316' } : undefined}>
                    <Eye size={11} />
                  </button>
                )}
              </div>

              {/* Add */}
              <button className="ap-vp__add-btn" onClick={addMapping}>
                <Plus size={11} /> Añadir valor
              </button>
            </div>
          )}

          {/* ── Bool ── */}
          {selType === 'bool' && (
            <>
              <p className="pp-section-title">Variable booleana</p>
              <div className="pp-field">
                <VariableSelect
                  value={selVariable}
                  onChange={v => updateArea(caId, area.id, { selectionVariable: v })}
                  workflowFields={wfBools}
                  systemFields={sysBools}
                />
              </div>
              <div className="pp-field">
                <label className="pp-field__label">Si verdadero →</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <AreaSelect value={trueAreaId} children={children}
                    onChange={areaChange('trueAreaId')} onCreateNew={areaCreate('trueAreaId')} />
                  {trueAreaId && (
                    <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(trueAreaId)}
                      style={isPreviewActive(trueAreaId) ? { color: '#f97316' } : undefined}>
                      <Eye size={11} />
                    </button>
                  )}
                </div>
              </div>
              <div className="pp-field">
                <label className="pp-field__label">Si falso →</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <AreaSelect value={falseAreaId} children={children}
                    onChange={areaChange('falseAreaId')} onCreateNew={areaCreate('falseAreaId')} />
                  {falseAreaId && (
                    <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(falseAreaId)}
                      style={isPreviewActive(falseAreaId) ? { color: '#f97316' } : undefined}>
                      <Eye size={11} />
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── Script ── */}
          {selType === 'script' && (
            <>
              <p className="pp-section-title">Script</p>
              <div className="ap-script-toolbar">
                <span className="ap-script-label">Retorna <code>true</code> o <code>false</code></span>
                <button className="ap-script-expand" onClick={() => setShowScriptModal(true)} title="Ampliar editor">
                  <Maximize2 size={11} /> Ampliar
                </button>
              </div>
              <div className="ap-script-editor-wrap">
                <ScriptEditor
                  value={selScript}
                  onChange={v => updateArea(caId, area.id, { selectionScript: v })}
                  placeholder={'// Retorna true o false\nreturn $item.active;'}
                  upstreamFields={allFields}
                />
              </div>
              <div className="pp-field">
                <label className="pp-field__label">Si true →</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <AreaSelect value={trueAreaId} children={children}
                    onChange={areaChange('trueAreaId')} onCreateNew={areaCreate('trueAreaId')} />
                  {trueAreaId && (
                    <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(trueAreaId)}
                      style={isPreviewActive(trueAreaId) ? { color: '#f97316' } : undefined}>
                      <Eye size={11} />
                    </button>
                  )}
                </div>
              </div>
              <div className="pp-field">
                <label className="pp-field__label">Si false →</label>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <AreaSelect value={falseAreaId} children={children}
                    onChange={areaChange('falseAreaId')} onCreateNew={areaCreate('falseAreaId')} />
                  {falseAreaId && (
                    <button className="ap-icon-btn" title="Ver rama en canvas" onClick={() => togglePreview(falseAreaId)}
                      style={isPreviewActive(falseAreaId) ? { color: '#f97316' } : undefined}>
                      <Eye size={11} />
                    </button>
                  )}
                </div>
              </div>
              {showScriptModal && (
                <ScriptEditorModal
                  script={selScript}
                  onSave={v => updateArea(caId, area.id, { selectionScript: v })}
                  onClose={() => setShowScriptModal(false)}
                  availableFields={allFields}
                />
              )}
            </>
          )}
        </>
      )}

      {/* ── Section flow ── */}
      {flowType === 'section' && (
        <>
          <p className="pp-section-title">Sub-flujos de sección</p>
          <p className="ap-hint">Un flujo de sección contiene otros flujos que se componen en secuencia.</p>
          <div className="pp-field">
            <label className="pp-field__label">Flujo de sección</label>
            <input
              type="checkbox"
              checked={area.isSectionFlow ?? false}
              onChange={e => updateArea(caId, area.id, { isSectionFlow: e.target.checked })}
            />
            <span style={{ fontSize: 10, marginLeft: 6, color: '#6b7280' }}>Marcar como contenedor de sección</span>
          </div>
        </>
      )}

      {/* ── First Fitting ── */}
      {flowType === 'simple' && (
        <>
          <p className="pp-section-title">First Fitting</p>
          <div className="pp-field">
            <label className="pp-field__label">Modo</label>
            <select
              className="pp-field__select"
              value={area.fittingMode ?? 'none'}
              onChange={e => updateArea(caId, area.id, { fittingMode: e.target.value })}
            >
              {FITTING_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {(area.fittingMode ?? 'none') !== 'none' && (
            <>
              <p className="ap-hint">Orden de áreas a probar. Se usa la primera que ajuste el contenido.</p>
              <div className="ap-fitting-list">
                {(area.fittingFlows ?? []).map((flowId, idx) => {
                  const refArea = (allAreas ?? []).find(a => a.id === flowId);
                  return (
                    <div key={flowId} className="ap-fitting-row">
                      <span className="ap-fitting-row__idx">{idx + 1}</span>
                      <select
                        className="pp-field__select ap-fitting-row__sel"
                        value={flowId}
                        onChange={e => {
                          const flows = [...(area.fittingFlows ?? [])];
                          flows[idx] = e.target.value;
                          updateArea(caId, area.id, { fittingFlows: flows });
                        }}
                      >
                        <option value="">(Seleccionar…)</option>
                        {(allAreas ?? []).filter(a => a.id !== area.id).map(a => (
                          <option key={a.id} value={a.id}>{a.label ?? a.id}</option>
                        ))}
                      </select>
                      <button
                        className="ap-icon-btn ap-icon-btn--danger"
                        onClick={() => {
                          const flows = (area.fittingFlows ?? []).filter((_, i) => i !== idx);
                          updateArea(caId, area.id, { fittingFlows: flows });
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  );
                })}
                <button
                  className="ap-add-cond-btn"
                  onClick={() => updateArea(caId, area.id, { fittingFlows: [...(area.fittingFlows ?? []), ''] })}
                >
                  <Plus size={12} /> Añadir área
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Common ── */}
      <p className="pp-section-title">Dimensiones</p>
      <div className="pp-field">
        <label className="pp-field__label">Alto</label>
        <UnitInput valueMm={height} min={5} onChange={h => updateArea(caId, area.id, { height: h })} />
      </div>

      <p className="pp-section-title">Comportamiento</p>
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Visible</span>
        <input type="checkbox" checked={visible} onChange={e => updateArea(caId, area.id, { visible: e.target.checked })} />
      </div>

      {/* ── Estilo de texto por defecto ── */}
      <p className="pp-section-title">Estilo de texto</p>
      <div className="ap-ts-row">
        <select
          className="pp-field__select ap-ts-select"
          value={area.defaultTextStyleId ?? ''}
          onChange={e => {
            const v = e.target.value;
            if (v === '__new__') {
              const id = addTextStyle?.();
              if (id) {
                updateArea(caId, area.id, { defaultTextStyleId: id });
                onNavigateToStyle?.(id);
              }
            } else {
              updateArea(caId, area.id, { defaultTextStyleId: v || null });
            }
          }}
        >
          <option value="">Sin estilo (hereda)</option>
          {(textStyles ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.name || s.id}</option>
          ))}
          <option value="__new__">+ Crear nuevo estilo</option>
        </select>
        {area.defaultTextStyleId && (
          <button
            className="ap-ts-nav"
            title="Ir al estilo"
            onClick={() => onNavigateToStyle?.(area.defaultTextStyleId)}
          >
            <ExternalLink size={13} />
          </button>
        )}
      </div>

      {/* ── Usada en ── */}
      <div className="ap-usage">
        <p className="pp-section-title">Usada en ({usages.length})</p>
        {usages.length > 0 ? (
          usages.map(u => (
            <p key={u.elementId} className="ap-usage__item">
              {u.pageName || u.pageId} → {u.elementId}
            </p>
          ))
        ) : (
          <p className="ap-usage__empty">No está en uso</p>
        )}
      </div>
    </div>
  );
}

// ── Áreas tab ─────────────────────────────────────────────────────────────────

export function AreasTab({ area, caId, addArea, removeArea, updateArea, enterAreaEdit }) {
  const children = area.children ?? [];

  return (
    <div>
      <div className="ap-list-header">
        <span className="ap-list-title">Subáreas ({children.length})</span>
        <button className="ap-add-btn" onClick={() => addArea(caId, area.id)}>
          <Plus size={12} /> Añadir
        </button>
      </div>

      {children.length === 0 && (
        <p className="ap-empty">Sin subáreas. Pulsa &laquo;Añadir&raquo; para crear una.</p>
      )}

      <div className="ap-child-list">
        {children.map((child, i) => (
          <div key={child.id} className="ap-child-item">
            <span className="ap-child-item__idx">{i + 1}</span>
            <input
              className="ap-child-item__name"
              value={child.label ?? ''}
              placeholder={`Subárea ${i + 1}`}
              onChange={e => updateArea(caId, child.id, { label: e.target.value })}
            />
            <div className="ap-child-item__height">
              <UnitInput valueMm={child.height ?? 20} min={5} onChange={h => updateArea(caId, child.id, { height: h })} />
            </div>
            <button className="ap-icon-btn" title="Editar subárea" onClick={() => enterAreaEdit(caId, child.id, { miniCanvas: true })}>
              <Pencil size={12} />
            </button>
            <button className="ap-icon-btn ap-icon-btn--danger" title="Eliminar subárea" onClick={() => removeArea(caId, child.id)}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AreaPropertiesPanel({ area, caId, state, availableFields, onCollapse, onBack }) {
  const { addArea, removeArea, updateArea, exitAreaEdit, enterAreaEdit, migrateAreaToCondition, migrateAreaFromCondition, previewAreaCtx, setPreviewAreaCtx } = state;
  const flowType = area.flowType ?? 'simple';
  const tabs = ['Flujo', 'Áreas'];
  const [activeTab, setActiveTab] = useState('Flujo');
  const tab = tabs.includes(activeTab) ? activeTab : 'Flujo';

  return (
    <div className="pp">
      <div className="pp__header">
        <span className="pp__ctx-icon">{FLOW_ICONS[flowType] ?? <Layers size={13} />}</span>
        <span className="pp__type ap__area-type">Área</span>
        <span className="pp__id">{area.label || area.id}</span>
        <button className="pp__collapse-btn pp__collapse-btn--inline" onClick={onCollapse} title="Colapsar">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="pp__tabs">
        {tabs.map(t => (
          <button key={t} className={`pp__tab${tab === t ? ' pp__tab--active' : ''}`} onClick={() => setActiveTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <div className="pp__body">
        {tab === 'Flujo' && (
          <FlujoTab area={area} caId={caId} updateArea={updateArea} addArea={addArea} removeArea={removeArea} enterAreaEdit={enterAreaEdit} migrateAreaToCondition={migrateAreaToCondition} migrateAreaFromCondition={migrateAreaFromCondition} previewAreaCtx={previewAreaCtx} setPreviewAreaCtx={setPreviewAreaCtx} availableFields={availableFields} getContentAreaUsage={state.getContentAreaUsage}
            textStyles={state.template?.styles?.text ?? []} addTextStyle={state.addTextStyle} onNavigateToStyle={id => state.setPanelContext?.('textStyle:' + id)}
            allAreas={state.template?.contentAreas ?? []} />
        )}
        {tab === 'Áreas' && (
          <AreasTab area={area} caId={caId} addArea={addArea} removeArea={removeArea} updateArea={updateArea} enterAreaEdit={enterAreaEdit} />
        )}
      </div>

      <div className="ap-footer">
        <button className="ap-exit-btn" onClick={exitAreaEdit}>Salir del área</button>
      </div>
    </div>
  );
}
