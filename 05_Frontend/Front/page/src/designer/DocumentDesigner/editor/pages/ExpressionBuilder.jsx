// ExpressionBuilder.jsx — Editor de expresiones (estilo "Simple Expression")
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, Trash2, Maximize2, Play } from 'lucide-react';
import { createConditionClause } from '../../engine/elementFactory.js';
import ScriptEditor      from '../../../ScriptProcessor/config/ScriptEditor.jsx';
import ScriptEditorModal from './ScriptEditorModal.jsx';
import { useScriptRunner } from '../../../ScriptProcessor/config/useScriptRunner.js';
import '../../../ScriptProcessor/ScriptProcessor.config.css';
import './ExpressionBuilder.css';

// Operadores agrupados — se filtran según el tipo detectado de la variable izquierda
const OPERATORS = [
  { value: 'equal_to',      label: 'igual a',         types: ['string','number','boolean','any'] },
  { value: 'not_equal_to',  label: 'no igual a',      types: ['string','number','boolean','any'] },
  { value: 'contains',      label: 'contiene',        types: ['string','any'] },
  { value: 'not_contains',  label: 'no contiene',     types: ['string','any'] },
  { value: 'starts_with',   label: 'empieza con',     types: ['string','any'] },
  { value: 'ends_with',     label: 'termina con',     types: ['string','any'] },
  { value: 'is_empty',      label: 'está vacío',      types: ['string','any'],   noRight: true },
  { value: 'greater_than',  label: 'mayor que',       types: ['number','any'] },
  { value: 'less_than',     label: 'menor que',       types: ['number','any'] },
  { value: 'gte',           label: 'mayor o igual',   types: ['number','any'] },
  { value: 'lte',           label: 'menor o igual',   types: ['number','any'] },
  { value: 'in_range',      label: 'en rango',        types: ['number','any'],   hasRangeTo: true },
  { value: 'is_true',       label: 'es verdadero',    types: ['boolean','any'],  noRight: true },
  { value: 'is_false',      label: 'es falso',        types: ['boolean','any'],  noRight: true },
];

function opMeta(opValue) {
  return OPERATORS.find(o => o.value === opValue) ?? OPERATORS[0];
}

export default function ExpressionBuilder({ rule, availableFields, onSave, onClose }) {
  const [expr,     setExpr]     = useState(() =>
    JSON.parse(JSON.stringify(rule.expression ?? { logic: 'all', clauses: [] }))
  );
  const [condType, setCondType] = useState(rule.conditionType ?? 'expression');
  const [script,   setScript]   = useState(rule.script ?? '');
  const [showScriptModal, setShowScriptModal] = useState(false);
  const runner = useScriptRunner(script, availableFields ?? []);

  const clauses = expr.clauses ?? [];

  function updateClause(id, changes) {
    setExpr(e => ({
      ...e,
      clauses: e.clauses.map(c => c.id === id ? { ...c, ...changes } : c),
    }));
  }

  function addClause() {
    setExpr(e => ({ ...e, clauses: [...e.clauses, createConditionClause()] }));
  }

  function removeClause(id) {
    setExpr(e => ({ ...e, clauses: e.clauses.filter(c => c.id !== id) }));
  }

  function handleSave() {
    if (condType === 'script') {
      onSave({ type: 'script', script, logic: expr.logic, clauses: [] });
    } else {
      onSave({ type: 'expression', ...expr });
    }
  }

  const modal = (
    <div className="eb-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="eb">
        {/* Header */}
        <div className="eb__header">
          <span className="eb__title">Editor de Expresión</span>
          <button className="eb__close" onClick={onClose}><X size={15} /></button>
        </div>

        {/* condType toggle */}
        <div className="eb__type-row">
          <label className="eb__type-label">Modo:</label>
          {['expression', 'script'].map(t => (
            <button
              key={t}
              className={`eb__type-btn${condType === t ? ' eb__type-btn--active' : ''}`}
              onClick={() => setCondType(t)}
            >
              {t === 'expression' ? 'Expresión' : 'Script'}
            </button>
          ))}
        </div>

        {condType === 'expression' && (
          <>
            {/* Logic toggle */}
            <div className="eb__logic-row">
              {[
                { v: 'all', label: 'Match all (AND)' },
                { v: 'any', label: 'Match any (OR)' },
              ].map(({ v, label }) => (
                <label key={v} className="eb__radio">
                  <input
                    type="radio"
                    name="logic"
                    checked={expr.logic === v}
                    onChange={() => setExpr(e => ({ ...e, logic: v }))}
                  />
                  {label}
                </label>
              ))}
            </div>

            {/* Clauses table */}
            <div className="eb__clauses">
              {clauses.length === 0 && (
                <p className="eb__empty">Sin cláusulas. Agrega una con el botón +.</p>
              )}
              {clauses.map((clause) => {
                const meta = opMeta(clause.operator);
                return (
                  <div key={clause.id} className="eb__clause">
                    <ValueSelector val={clause.left}
                      onChange={v => updateClause(clause.id, { left: v })}
                      availableFields={availableFields} />
                    <button
                      className={`eb__neg-btn${clause.negated ? ' eb__neg-btn--active' : ''}`}
                      onClick={() => updateClause(clause.id, { negated: !clause.negated })}>
                      {clause.negated ? 'Is Not' : 'Is'}
                    </button>
                    <select className="eb__op-select" value={clause.operator}
                      onChange={e => updateClause(clause.id, { operator: e.target.value })}>
                      {OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                    </select>
                    {!meta.noRight && (
                      <ValueSelector val={clause.right}
                        onChange={v => updateClause(clause.id, { right: v })}
                        availableFields={availableFields} />
                    )}
                    {meta.hasRangeTo && (
                      <>
                        <span className="eb__range-sep">a</span>
                        <ValueSelector
                          val={clause.rightTo ?? { type: 'constant', path: '', value: '' }}
                          onChange={v => updateClause(clause.id, { rightTo: v })}
                          availableFields={availableFields} />
                      </>
                    )}
                    <button className="eb__clause-add" onClick={addClause} title="Agregar cláusula"><Plus size={12} /></button>
                    <button className="eb__clause-del" onClick={() => removeClause(clause.id)} title="Eliminar"><Trash2 size={12} /></button>
                  </div>
                );
              })}

              {clauses.length === 0 && (
                <button className="eb__add-first" onClick={addClause}>
                  <Plus size={12} /> Agregar cláusula
                </button>
              )}
            </div>
          </>
        )}

        {condType === 'script' && (
          <div className="eb__script">
            <div className="eb__script-toolbar">
              <label className="eb__script-label">Script — retorna <code>true</code> o <code>false</code></label>
              <button className="eb__script-expand" onClick={() => setShowScriptModal(true)} title="Ampliar editor">
                <Maximize2 size={12} /> Ampliar
              </button>
            </div>
            <div className="eb__script-editor-wrap">
              <ScriptEditor
                value={script}
                onChange={setScript}
                placeholder={'// Ejemplo:\nreturn packet.data.isActive === true;'}
                upstreamFields={availableFields ?? []}
              />
            </div>
          </div>
        )}

        {/* Test result — solo en modo script */}
        {condType === 'script' && runner.status !== 'idle' && (
          <div className={`eb__test-result eb__test-result--${runner.status}`}>
            {runner.status === 'ok' && (
              <span className="eb__test-value">
                → <strong>{String(runner.result)}</strong>
                {typeof runner.result !== 'boolean' && (
                  <span className="eb__test-warn"> ⚠ no es boolean</span>
                )}
              </span>
            )}
            {runner.status === 'error' && (
              <span className="eb__test-error">{runner.error}</span>
            )}
            {runner.logs.length > 0 && (
              <span className="eb__test-logs">
                {runner.logs.slice(0, 2).map((l, i) => (
                  <span key={i} className={`eb__test-log eb__test-log--${l.level}`}>{l.msg}</span>
                ))}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="eb__footer">
          {condType === 'script' && (
            <button className="eb__btn eb__btn--test" onClick={runner.run} title="Ejecutar script con datos de prueba">
              <Play size={11} /> Probar
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="eb__btn eb__btn--cancel" onClick={onClose}>Cancelar</button>
          <button className="eb__btn eb__btn--ok" onClick={handleSave}>OK</button>
        </div>
      </div>

      {showScriptModal && (
        <ScriptEditorModal
          script={script}
          onSave={setScript}
          onClose={() => setShowScriptModal(false)}
          availableFields={availableFields}
        />
      )}
    </div>
  );

  return createPortal(modal, document.body);
}

// ── ValueSelector ─────────────────────────────────────────────────────────────
let _vsSeq = 0;
function ValueSelector({ val = { type: 'constant', path: '', value: '' }, onChange, availableFields }) {
  const isVar  = val.type === 'variable';
  const listId = `eb-vs-${++_vsSeq}`;
  return (
    <div className="eb__val">
      <button
        className={`eb__val-type${isVar ? ' eb__val-type--var' : ''}`}
        onClick={() => onChange({ ...val, type: isVar ? 'constant' : 'variable' })}
        title={isVar ? 'Variable → click para constante' : 'Constante → click para variable'}
      >
        {isVar ? 'Var' : 'Cte'}
      </button>
      <input
        className="eb__val-input"
        type="text"
        list={isVar && availableFields?.length ? listId : undefined}
        placeholder={isVar ? 'data.campo' : 'valor'}
        value={isVar ? (val.path ?? '') : (val.value ?? '')}
        onChange={e => onChange({ ...val, ...(isVar ? { path: e.target.value } : { value: e.target.value }) })}
      />
      {isVar && availableFields?.length > 0 && (
        <datalist id={listId}>
          {availableFields.map(f => <option key={f.path ?? f.name} value={f.path ?? f.name} />)}
        </datalist>
      )}
    </div>
  );
}
