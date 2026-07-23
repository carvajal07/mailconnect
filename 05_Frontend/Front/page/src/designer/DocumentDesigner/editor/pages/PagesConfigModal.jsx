// PagesConfigModal.jsx — Configuración del PagesConfig (Pages Family)
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2 } from 'lucide-react';
import { createConditionRule } from '../../engine/elementFactory.js';
import ExpressionBuilder from './ExpressionBuilder.jsx';
import './PagesConfigModal.css';

const TABS = ['Flujo'];

const TS_TYPES = [
  { v: 'simple',    label: 'Simple',     hint: 'Página fija de inicio' },
  { v: 'text',      label: 'Por texto',  hint: 'Valor de texto → página' },
  { v: 'number',    label: 'Por número', hint: 'Valor numérico → página' },
  { v: 'bool',      label: 'Bool',       hint: 'Variable booleana' },
  { v: 'condition', label: 'Condición',  hint: 'Expresión / script' },
  { v: 'script',    label: 'Script',     hint: 'Monaco, devuelve bool' },
];

export default function PagesConfigModal({ pc, pages = [], onSave, onClose }) {
  const [draft,       setDraft]       = useState(() => JSON.parse(JSON.stringify(pc)));
  const [activeTab,   setActiveTab]   = useState('Flujo');
  const [exprRuleId,  setExprRuleId]  = useState(null);

  function updateTS(changes) {
    setDraft(d => ({ ...d, typeSelection: { ...d.typeSelection, ...changes } }));
  }

  const ts      = draft.typeSelection ?? {};
  const isVD    = draft.pageSelection === 'variable_data';
  const rules   = ts.rules    ?? [];
  const mappings = ts.mappings ?? [];

  // ── Helpers reglas (condition) ─────────────────────────────────────────
  function addRule()           { updateTS({ rules: [...rules, createConditionRule()] }); }
  function removeRule(id)      { updateTS({ rules: rules.filter(r => r.id !== id) }); }
  function updateRule(id, ch)  { updateTS({ rules: rules.map(r => r.id === id ? { ...r, ...ch } : r) }); }

  // ── Helpers mappings (text/number) ─────────────────────────────────────
  function addMapping()          { updateTS({ mappings: [...mappings, { id: `m_${Date.now()}`, value: '', pageId: null }] }); }
  function removeMapping(id)     { updateTS({ mappings: mappings.filter(m => m.id !== id) }); }
  function updateMapping(id, ch) { updateTS({ mappings: mappings.map(m => m.id === id ? { ...m, ...ch } : m) }); }

  const openRule = exprRuleId ? rules.find(r => r.id === exprRuleId) : null;

  // ── Page selector ──────────────────────────────────────────────────────
  function PageSelect({ value, onChange, placeholder = 'Vacío' }) {
    return (
      <select className="pcm-field__select pcm-page-sel" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
  }

  const modal = (
    <div className="pcm-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pcm">

        {/* Header */}
        <div className="pcm__header">
          <span className="pcm__title">Pages Config</span>
          <button className="pcm__close" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="pcm__tabs">
          {TABS.map(t => (
            <button key={t} className={`pcm__tab${activeTab === t ? ' pcm__tab--active' : ''}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>

        <div className="pcm__body">

          {/* ── Page Selection ── */}
          <p className="pcm-section-title">Modo de páginas</p>
          <div className="pcsm__mode-row">
            {[
              { v: 'simple',        label: 'Simple',        hint: 'Secuencia lineal' },
              { v: 'variable_data', label: 'Variable Data', hint: 'Dinámica por datos' },
            ].map(({ v, label, hint }) => (
              <button
                key={v}
                className={`pcsm__mode-btn${draft.pageSelection === v ? ' pcsm__mode-btn--active' : ''}`}
                onClick={() => setDraft(d => ({ ...d, pageSelection: v }))}
              >
                <span className="pcsm__mode-label">{label}</span>
                <span className="pcsm__mode-hint">{hint}</span>
              </button>
            ))}
          </div>

          {/* Simple: startPageId */}
          {!isVD && (
            <div className="pcm-field">
              <label className="pcm-field__label">Página de inicio</label>
              <PageSelect value={draft.startPageId} onChange={v => setDraft(d => ({ ...d, startPageId: v }))} placeholder="Primera página" />
            </div>
          )}

          {/* Variable Data */}
          {isVD && (
            <>
              {/* Repeated By */}
              <p className="pcm-section-title">Repetición</p>
              <div className="pcm-toggle">
                <div className="pcm-toggle__info">
                  <span className="pcm-toggle__label">Repeated By</span>
                  <span className="pcm-toggle__hint">Itera por cada registro del array</span>
                </div>
                <input type="checkbox"
                  checked={draft.repeatedBy?.enabled ?? false}
                  onChange={e => setDraft(d => ({ ...d, repeatedBy: { ...d.repeatedBy, enabled: e.target.checked } }))}
                />
              </div>
              {draft.repeatedBy?.enabled && (
                <div className="pcm-field">
                  <label className="pcm-field__label">Variable array</label>
                  <input className="pcm-field__input" placeholder="ej: data.items"
                    value={draft.repeatedBy?.variable ?? ''}
                    onChange={e => setDraft(d => ({ ...d, repeatedBy: { ...d.repeatedBy, variable: e.target.value } }))}
                  />
                  <span className="pcm-field__hint">Debe ser un array en el WorkflowPacket</span>
                </div>
              )}

              {/* Type Selection */}
              <p className="pcm-section-title">Tipo de selección</p>
              <div className="pcsm__ts-grid">
                {TS_TYPES.map(({ v, label, hint }) => (
                  <button key={v}
                    className={`pcsm__ts-card${ts.type === v ? ' pcsm__ts-card--active' : ''}`}
                    onClick={() => updateTS({ type: v })}
                  >
                    <span className="pcsm__ts-card-label">{label}</span>
                    <span className="pcsm__ts-card-hint">{hint}</span>
                  </button>
                ))}
              </div>

              {/* TS: Simple */}
              {ts.type === 'simple' && (
                <div className="pcm-field">
                  <label className="pcm-field__label">Página de inicio</label>
                  <PageSelect value={ts.startPageId} onChange={v => updateTS({ startPageId: v })} placeholder="Primera" />
                </div>
              )}

              {/* TS: text / number — tabla Valor | Página */}
              {(ts.type === 'text' || ts.type === 'number') && (
                <>
                  <div className="pcm-field">
                    <label className="pcm-field__label">Variable a comparar</label>
                    <input className="pcm-field__input" placeholder="ej: data.tipo"
                      value={ts.variable ?? ''}
                      onChange={e => updateTS({ variable: e.target.value })}
                    />
                  </div>
                  <table className="pcsm__rules-table">
                    <thead><tr><th>Valor</th><th>Página</th><th></th></tr></thead>
                    <tbody>
                      {mappings.map(m => (
                        <tr key={m.id} className="pcsm__rule-row">
                          <td>
                            <input
                              className="pcm-field__input"
                              type={ts.type === 'number' ? 'number' : 'text'}
                              value={m.value ?? ''}
                              onChange={e => updateMapping(m.id, { value: ts.type === 'number' ? +e.target.value : e.target.value })}
                              placeholder={ts.type === 'number' ? '42' : 'Hola'}
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
                  <div className="pcm-field">
                    <label className="pcm-field__label">Variable booleana</label>
                    <input className="pcm-field__input" placeholder="ej: data.activo"
                      value={ts.variable ?? ''} onChange={e => updateTS({ variable: e.target.value })} />
                  </div>
                  <div className="pcm-row pcm-row--mb">
                    <div className="pcm-field">
                      <label className="pcm-field__label">Si true →</label>
                      <PageSelect value={ts.truePageId}  onChange={v => updateTS({ truePageId:  v })} />
                    </div>
                    <div className="pcm-field">
                      <label className="pcm-field__label">Si false →</label>
                      <PageSelect value={ts.falsePageId} onChange={v => updateTS({ falsePageId: v })} />
                    </div>
                  </div>
                </>
              )}

              {/* TS: condition — tabla expresión | página */}
              {ts.type === 'condition' && (
                <>
                  <table className="pcsm__rules-table">
                    <thead><tr><th>Condición</th><th>Página</th><th></th></tr></thead>
                    <tbody>
                      {rules.map(rule => (
                        <tr key={rule.id} className="pcsm__rule-row">
                          <td>
                            <button className="pcsm__rule-expr-btn" onClick={() => setExprRuleId(rule.id)}>
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
                  <div className="pcm-field">
                    <label className="pcm-field__label">Script (devuelve boolean)</label>
                    <textarea className="pcm-field__input pcsm__script-area" rows={5}
                      placeholder="// Retorna true o false&#10;return data.isActive;"
                      value={ts.script ?? ''} onChange={e => updateTS({ script: e.target.value })} />
                  </div>
                  <div className="pcm-row pcm-row--mb">
                    <div className="pcm-field">
                      <label className="pcm-field__label">Si true →</label>
                      <PageSelect value={ts.truePageId}  onChange={v => updateTS({ truePageId:  v })} />
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
        </div>

        {/* Footer */}
        <div className="pcm__footer">
          <button className="pcm__btn pcm__btn--cancel" onClick={onClose}>Cancelar</button>
          <button className="pcm__btn pcm__btn--save" onClick={() => onSave(draft)}>Guardar</button>
        </div>
      </div>

      {openRule && (
        <ExpressionBuilder
          rule={openRule}
          onSave={(expr) => { updateRule(openRule.id, { conditionType: expr.type === 'script' ? 'script' : 'expression', expression: expr, script: expr.script ?? '' }); setExprRuleId(null); }}
          onClose={() => setExprRuleId(null)}
        />
      )}
    </div>
  );

  return createPortal(modal, document.body);
}

function ruleConditionSummary(rule) {
  if (rule.conditionType === 'script') return '{ script }';
  const clauses = rule.expression?.clauses ?? [];
  if (!clauses.length) return '...';
  const c   = clauses[0];
  const lft = c.left?.path  || c.left?.value  || '?';
  const op  = c.operator?.replace(/_/g, ' ') || '?';
  const rgt = c.right?.value || c.right?.path || '?';
  const neg = c.negated ? 'NOT ' : '';
  return `${lft} ${neg}${op} ${rgt}${clauses.length > 1 ? ` +${clauses.length - 1}` : ''}`;
}
