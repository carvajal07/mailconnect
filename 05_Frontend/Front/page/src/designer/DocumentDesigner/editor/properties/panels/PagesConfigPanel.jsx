// PagesConfigPanel.jsx — PagesConfig inline en el panel contextual
import { useState, useMemo } from 'react';
import { Plus, Trash2, Maximize2, Edit2 } from 'lucide-react';
import { createConditionRule } from '../../../engine/elementFactory.js';
import { SYSTEM_FIELDS } from '../../../engine/systemFields.js';
import ExpressionBuilder   from '../../pages/ExpressionBuilder.jsx';
import ScriptEditor        from '../../../../ScriptProcessor/config/ScriptEditor.jsx';
import ScriptEditorModal   from '../../pages/ScriptEditorModal.jsx';
import '../../pages/PagesConfigModal.css';
import '../../../../ScriptProcessor/ScriptProcessor.config.css';

const TS_TYPES = [
  { v: 'simple',    label: 'Simple',     hint: 'Página fija' },
  { v: 'text',      label: 'Texto',      hint: 'Valor → página' },
  { v: 'number',    label: 'Número',     hint: 'Número → página' },
  { v: 'bool',      label: 'Bool',       hint: 'Variable bool' },
  { v: 'condition', label: 'Condición',  hint: 'Expresión' },
  { v: 'script',    label: 'Script',     hint: 'Devuelve bool' },
];

// Variables de sistema: catálogo central en engine/systemFields.js (incluye $overflow).

function flattenFields(fields, result = []) {
  for (const f of fields ?? []) {
    result.push(f);
    if (f.children?.length) flattenFields(f.children, result);
  }
  return result;
}

function ruleConditionSummary(rule) {
  if (rule.conditionType === 'script') return '{ script }';
  const clauses = rule.expression?.clauses ?? [];
  if (!clauses.length) return '...';
  const c   = clauses[0];
  const lft = c.left?.path  || c.left?.value  || '?';
  const op  = c.operator?.replace(/_/g, ' ') || '?';
  const rgt = c.right?.value || c.right?.path || '?';
  return `${lft} ${op} ${rgt}${clauses.length > 1 ? ` +${clauses.length - 1}` : ''}`;
}

export default function PagesConfigPanel({ state, availableFields }) {
  const { template, pages, updatePagesConfig } = state;
  const pc   = template?.pagesConfig ?? {};
  const ts   = pc.typeSelection ?? {};
  const isVD = pc.pageSelection === 'variable_data';
  const rules    = ts.rules    ?? [];
  const mappings = ts.mappings ?? [];

  const [exprRuleId,     setExprRuleId]     = useState(null);
  const [showScriptModal, setShowScriptModal] = useState(false);

  // ── Campo suggestions ──────────────────────────────────────────────────
  const allFields = useMemo(() => {
    const workflow = flattenFields(availableFields ?? []);
    return [...workflow, ...SYSTEM_FIELDS];
  }, [availableFields]);

  const arrayFields   = useMemo(() => allFields.filter(f => f.type === 'array'  || f.type === 'object'), [allFields]);
  const stringFields  = useMemo(() => allFields.filter(f => f.type === 'string' || f.type === 'text'),   [allFields]);
  const numberFields  = useMemo(() => allFields.filter(f => f.type === 'number' || f.type === 'integer'), [allFields]);
  const boolFields    = useMemo(() => allFields.filter(f => f.type === 'boolean'|| f.type === 'bool'),   [allFields]);

  function fieldsForType(tsType) {
    if (tsType === 'text')   return stringFields.length ? stringFields : allFields;
    if (tsType === 'number') return numberFields.length ? numberFields : allFields;
    if (tsType === 'bool')   return boolFields.length   ? boolFields   : allFields;
    return allFields;
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function updateTS(changes) {
    updatePagesConfig({ typeSelection: { ...ts, ...changes } });
  }

  function addRule()          { updateTS({ rules: [...rules, createConditionRule()] }); }
  function removeRule(id)     { updateTS({ rules: rules.filter(r => r.id !== id) }); }
  function updateRule(id, ch) { updateTS({ rules: rules.map(r => r.id === id ? { ...r, ...ch } : r) }); }

  function addMapping()          { updateTS({ mappings: [...mappings, { id: `m_${Date.now()}`, value: '', pageId: null }] }); }
  function removeMapping(id)     { updateTS({ mappings: mappings.filter(m => m.id !== id) }); }
  function updateMapping(id, ch) { updateTS({ mappings: mappings.map(m => m.id === id ? { ...m, ...ch } : m) }); }

  const openRule = exprRuleId ? rules.find(r => r.id === exprRuleId) : null;

  // ── Componentes internos ───────────────────────────────────────────────

  function PageSelect({ value, onChange, placeholder = 'Vacío' }) {
    return (
      <select className="pcm-field__select pcm-page-sel" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
  }

  // Input con sugerencias de campos via datalist
  function FieldInput({ id, value, onChange, placeholder, fields }) {
    const listId = `fl-${id}`;
    return (
      <div className="pcp-field-input-wrap">
        <input
          className="pcm-field__input"
          list={listId}
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <datalist id={listId}>
          {fields.map(f => (
            <option key={f.path ?? f.name} value={f.path ?? f.name}>
              {f.name ?? f.path}
            </option>
          ))}
        </datalist>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="pcp">

      {/* ── Modo de páginas ─────────────────────────────────────────────── */}
      <p className="pcm-section-title">Modo de páginas</p>
      <div className="pcsm__mode-row">
        {[
          { v: 'simple',        label: 'Simple',    hint: 'Secuencial' },
          { v: 'variable_data', label: 'Var. Data', hint: 'Dinámica'   },
        ].map(({ v, label, hint }) => (
          <button
            key={v}
            className={`pcsm__mode-btn${pc.pageSelection === v ? ' pcsm__mode-btn--active' : ''}`}
            onClick={() => updatePagesConfig({ pageSelection: v })}
          >
            <span className="pcsm__mode-label">{label}</span>
            <span className="pcsm__mode-hint">{hint}</span>
          </button>
        ))}
      </div>

      {/* ── Simple: startPageId ─────────────────────────────────────────── */}
      {!isVD && (
        <div className="pcm-field">
          <label className="pcm-field__label">Página de inicio</label>
          <PageSelect value={pc.startPageId} onChange={v => updatePagesConfig({ startPageId: v })} placeholder="Primera" />
        </div>
      )}

      {/* ── Variable Data ────────────────────────────────────────────────── */}
      {isVD && (
        <>
          {/* Repetición */}
          <p className="pcm-section-title">Repetición</p>
          <div className="pcm-toggle">
            <div className="pcm-toggle__info">
              <span className="pcm-toggle__label">Repeated By</span>
              <span className="pcm-toggle__hint">Itera por cada ítem del array</span>
            </div>
            <input type="checkbox"
              checked={pc.repeatedBy?.enabled ?? false}
              onChange={e => updatePagesConfig({ repeatedBy: { ...pc.repeatedBy, enabled: e.target.checked } })}
            />
          </div>

          {pc.repeatedBy?.enabled && (
            <div className="pcm-field">
              <label className="pcm-field__label">Variable array</label>
              <FieldInput
                id="rep-var"
                value={pc.repeatedBy?.variable}
                onChange={v => updatePagesConfig({ repeatedBy: { ...pc.repeatedBy, variable: v } })}
                placeholder="ej: data.items"
                fields={arrayFields.length ? arrayFields : allFields}
              />
              <span className="pcm-field__hint">Array en el WorkflowPacket</span>
            </div>
          )}

          {/* Tipo de selección */}
          <p className="pcm-section-title">Tipo de selección</p>
          <div className="pcsm__ts-grid">
            {TS_TYPES.map(({ v, label, hint }) => (
              <button key={v}
                className={`pcsm__ts-card${ts.type === v ? ' pcsm__ts-card--active' : ''}`}
                onClick={() => updateTS({ type: v, variable: '', mappings: [], rules: [], script: '', startPageId: null, truePageId: null, falsePageId: null, defaultPageId: null })}
              >
                <span className="pcsm__ts-card-label">{label}</span>
                <span className="pcsm__ts-card-hint">{hint}</span>
              </button>
            ))}
          </div>

          {/* TS: simple */}
          {ts.type === 'simple' && (
            <div className="pcm-field">
              <label className="pcm-field__label">Página de inicio</label>
              <PageSelect value={ts.startPageId} onChange={v => updateTS({ startPageId: v })} placeholder="Primera" />
            </div>
          )}

          {/* TS: text / number */}
          {(ts.type === 'text' || ts.type === 'number') && (
            <>
              <p className="pcm-section-title">Mapeo de valores</p>
              <div className="pcm-field">
                <label className="pcm-field__label">Variable a comparar</label>
                <FieldInput
                  id="ts-var"
                  value={ts.variable}
                  onChange={v => updateTS({ variable: v })}
                  placeholder={ts.type === 'number' ? 'ej: data.cantidad' : 'ej: data.tipo'}
                  fields={fieldsForType(ts.type)}
                />
              </div>
              <table className="pcsm__rules-table">
                <thead><tr><th>Valor</th><th>Página</th><th></th></tr></thead>
                <tbody>
                  {mappings.map(m => (
                    <tr key={m.id} className="pcsm__rule-row">
                      <td>
                        <input className="pcm-field__input"
                          type={ts.type === 'number' ? 'number' : 'text'}
                          value={m.value ?? ''}
                          onChange={e => updateMapping(m.id, { value: ts.type === 'number' ? +e.target.value : e.target.value })}
                        />
                      </td>
                      <td><PageSelect value={m.pageId} onChange={v => updateMapping(m.id, { pageId: v })} /></td>
                      <td><button className="pcsm__rule-del" onClick={() => removeMapping(m.id)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                  <tr className="pcsm__rule-row pcsm__rule-row--default">
                    <td><span className="pcsm__default-label">Default</span></td>
                    <td><PageSelect value={ts.defaultPageId} onChange={v => updateTS({ defaultPageId: v })} placeholder="(omitir)" /></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              <button className="pcsm__add-rule" onClick={addMapping}><Plus size={12} /> Agregar valor</button>
            </>
          )}

          {/* TS: bool */}
          {ts.type === 'bool' && (
            <>
              <p className="pcm-section-title">Variable booleana</p>
              <div className="pcm-field">
                <label className="pcm-field__label">Variable</label>
                <FieldInput
                  id="ts-bool"
                  value={ts.variable}
                  onChange={v => updateTS({ variable: v })}
                  placeholder="ej: data.activo"
                  fields={fieldsForType('bool')}
                />
              </div>
              <div className="pcm-row pcm-row--mb">
                <div className="pcm-field">
                  <label className="pcm-field__label">Si true →</label>
                  <PageSelect value={ts.truePageId}  onChange={v => updateTS({ truePageId: v })} />
                </div>
                <div className="pcm-field">
                  <label className="pcm-field__label">Si false →</label>
                  <PageSelect value={ts.falsePageId} onChange={v => updateTS({ falsePageId: v })} />
                </div>
              </div>
            </>
          )}

          {/* TS: condition */}
          {ts.type === 'condition' && (
            <>
              <p className="pcm-section-title">Reglas de condición</p>
              <table className="pcsm__rules-table">
                <thead><tr><th>Condición</th><th>Página</th><th></th></tr></thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.id} className="pcsm__rule-row">
                      <td>
                        <button className="pcsm__rule-expr-btn" onClick={() => setExprRuleId(rule.id)}>
                          <Edit2 size={10} className="pcsm__rule-expr-icon" />
                          {ruleConditionSummary(rule)}
                        </button>
                      </td>
                      <td><PageSelect value={rule.pageId} onChange={v => updateRule(rule.id, { pageId: v })} /></td>
                      <td><button className="pcsm__rule-del" onClick={() => removeRule(rule.id)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                  <tr className="pcsm__rule-row pcsm__rule-row--default">
                    <td><span className="pcsm__default-label">Default</span></td>
                    <td><PageSelect value={ts.defaultPageId} onChange={v => updateTS({ defaultPageId: v })} placeholder="(omitir)" /></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              <button className="pcsm__add-rule" onClick={addRule}><Plus size={12} /> Agregar regla</button>
            </>
          )}

          {/* TS: script */}
          {ts.type === 'script' && (
            <>
              <p className="pcm-section-title">Script</p>
              <div className="pcp-script-toolbar">
                <span className="pcp-script-label">Retorna <code>true</code> o <code>false</code></span>
                <button className="pcp-script-expand" onClick={() => setShowScriptModal(true)} title="Ampliar editor">
                  <Maximize2 size={11} /> Ampliar
                </button>
              </div>
              <div className="pcp-script-editor-wrap">
                <ScriptEditor
                  value={ts.script ?? ''}
                  onChange={v => updateTS({ script: v })}
                  placeholder={'// Retorna true o false\nreturn data.isActive;'}
                  upstreamFields={allFields}
                />
              </div>
              <div className="pcm-row pcm-row--mb" style={{ marginTop: 8 }}>
                <div className="pcm-field">
                  <label className="pcm-field__label">Si true →</label>
                  <PageSelect value={ts.truePageId}  onChange={v => updateTS({ truePageId: v })} />
                </div>
                <div className="pcm-field">
                  <label className="pcm-field__label">Si false →</label>
                  <PageSelect value={ts.falsePageId} onChange={v => updateTS({ falsePageId: v })} />
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* ExpressionBuilder para condition */}
      {openRule && (
        <ExpressionBuilder
          rule={openRule}
          availableFields={allFields}
          onSave={(expr) => {
            updateRule(openRule.id, {
              conditionType: expr.type === 'script' ? 'script' : 'expression',
              expression: expr,
              script: expr.script ?? '',
            });
            setExprRuleId(null);
          }}
          onClose={() => setExprRuleId(null)}
        />
      )}

      {/* ScriptEditorModal para TS script */}
      {showScriptModal && (
        <ScriptEditorModal
          script={ts.script ?? ''}
          onSave={v => updateTS({ script: v })}
          onClose={() => setShowScriptModal(false)}
          availableFields={allFields}
        />
      )}

    </div>
  );
}
