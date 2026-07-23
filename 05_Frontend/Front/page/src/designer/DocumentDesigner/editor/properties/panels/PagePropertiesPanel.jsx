// PagePropertiesPanel.jsx — Propiedades de una página individual
import { useState, useMemo } from 'react';
import { Plus, Trash2, Edit2, Maximize2 } from 'lucide-react';
import { createConditionRule } from '../../../engine/elementFactory.js';
import { UnitInput } from '../UnitInput.jsx';
import ExpressionBuilder from '../../pages/ExpressionBuilder.jsx';
import ScriptEditor      from '../../../../ScriptProcessor/config/ScriptEditor.jsx';
import ScriptEditorModal from '../../pages/ScriptEditorModal.jsx';
import '../../pages/PagesConfigModal.css';
import '../PropertiesPanel.css';
import '../../../../ScriptProcessor/ScriptProcessor.config.css';

// ── Constantes ──────────────────────────────────────────────────────────────

const PAGE_PRESETS = [
  { id: 'A4',      label: 'A4',      w: 210,   h: 297   },
  { id: 'A3',      label: 'A3',      w: 297,   h: 420   },
  { id: 'A5',      label: 'A5',      w: 148,   h: 210   },
  { id: 'Letter',  label: 'Letter',  w: 215.9, h: 279.4 },
  { id: 'Legal',   label: 'Legal',   w: 215.9, h: 355.6 },
  { id: 'custom',  label: 'Personalizado', w: null, h: null },
];

const NEXT_PAGE_TYPES = [
  { v: 'none',      label: 'Sin flujo',      hint: 'No define siguiente' },
  { v: 'simple',    label: 'Simple',          hint: 'Página fija' },
  { v: 'text',      label: 'Por texto',       hint: 'Variable texto → página' },
  { v: 'integer',   label: 'Por número',      hint: 'Variable numérica → página' },
  { v: 'condition', label: 'Por condición',   hint: 'Reglas/expresión' },
  { v: 'script',    label: 'Script',          hint: 'Devuelve ID de página' },
];

const SYSTEM_FIELDS = [
  { path: '$pageNumber',   type: 'number'  },
  { path: '$totalPages',   type: 'number'  },
  { path: '$date',         type: 'string'  },
  { path: '$datetime',     type: 'string'  },
  { path: '$documentName', type: 'string'  },
  { path: '$overflow',     type: 'boolean' },
  { path: '$index',        type: 'number'  },
  { path: '$item',         type: 'object'  },
];

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
  const c = clauses[0];
  return `${c.left?.path || c.left?.value || '?'} ${c.operator?.replace(/_/g, ' ') || '?'} ${c.right?.value || c.right?.path || '?'}${clauses.length > 1 ? ` +${clauses.length - 1}` : ''}`;
}

// ── Tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'general',  label: 'General'    },
  { id: 'nextpage', label: 'Next Page'  },
];

// ── Component ────────────────────────────────────────────────────────────────

export default function PagePropertiesPanel({ state, availableFields }) {
  const { pages, updatePageById, setPanelContext, panelContext } = state;

  const pageId = panelContext?.startsWith('page:') ? panelContext.slice(5) : null;
  const page   = pages.find(p => p.id === pageId);

  const [activeTab,      setActiveTab]      = useState('general');
  const [exprRuleId,     setExprRuleId]     = useState(null);
  const [showScriptModal,setShowScriptModal] = useState(false);

  const allFields = useMemo(() => {
    const workflow = flattenFields(availableFields ?? []);
    return [...workflow, ...SYSTEM_FIELDS];
  }, [availableFields]);

  if (!page) return <p style={{ padding: 12, fontSize: 11, color: 'var(--color-text-tertiary)' }}>Página no encontrada.</p>;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function upd(changes) { updatePageById(pageId, changes); }
  function updSize(changes) { upd({ size: { ...page.size, ...changes } }); }
  function updMargins(changes) { upd({ margins: { ...page.margins, ...changes } }); }
  function updFlow(changes) { upd({ pageFlow: { ...(page.pageFlow ?? {}), ...changes } }); }

  const pf     = page.pageFlow ?? {};
  const pfType = pf.type ?? 'none';

  const rules    = pf.rules    ?? [];
  const mappings = pf.mappings ?? [];

  function addRule()          { updFlow({ rules: [...rules, createConditionRule()] }); }
  function removeRule(id)     { updFlow({ rules: rules.filter(r => r.id !== id) }); }
  function updateRule(id, ch) { updFlow({ rules: rules.map(r => r.id === id ? { ...r, ...ch } : r) }); }

  function addMapping()          { updFlow({ mappings: [...mappings, { id: `m_${Date.now()}`, value: '', pageId: null }] }); }
  function removeMapping(id)     { updFlow({ mappings: mappings.filter(m => m.id !== id) }); }
  function updateMapping(id, ch) { updFlow({ mappings: mappings.map(m => m.id === id ? { ...m, ...ch } : m) }); }

  const openRule = exprRuleId ? rules.find(r => r.id === exprRuleId) : null;

  // ── Inner selects ──────────────────────────────────────────────────────────

  function PageSelect({ value, onChange, placeholder = 'Vacío' }) {
    return (
      <select className="pcm-field__select pcm-page-sel" value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">{placeholder}</option>
        {pages.filter(p => p.id !== pageId).map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    );
  }

  function FieldInput({ id, value, onChange, placeholder, fields }) {
    const listId = `ppp-fl-${id}`;
    return (
      <div className="pcp-field-input-wrap">
        <input className="pcm-field__input" list={listId} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
        <datalist id={listId}>
          {(fields ?? allFields).map(f => <option key={f.path ?? f.name} value={f.path ?? f.name}>{f.name ?? f.path}</option>)}
        </datalist>
      </div>
    );
  }

  // ── Preset logic ───────────────────────────────────────────────────────────

  function handlePresetChange(presetId) {
    const preset = PAGE_PRESETS.find(p => p.id === presetId);
    if (!preset || preset.id === 'custom') {
      updSize({ preset: 'custom' });
    } else {
      const isLandscape = page.orientation === 'landscape';
      updSize({ preset: presetId, width: isLandscape ? preset.h : preset.w, height: isLandscape ? preset.w : preset.h });
    }
  }

  function handleOrientationChange(newOrient) {
    if (newOrient === page.orientation) return;
    // Swap width/height
    upd({ orientation: newOrient, size: { ...page.size, width: page.size.height, height: page.size.width } });
  }

  function handleFlowTypeChange(v) {
    updFlow({ type: v, variable: '', mappings: [], rules: [], script: '', pageId: null, truePageId: null, falsePageId: null, defaultPageId: null });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="pcp">
      {/* Tabs */}
      <div className="ppp-tabs">
        {TABS.map(t => (
          <button key={t.id} className={`ppp-tab${activeTab === t.id ? ' ppp-tab--active' : ''}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── GENERAL ─────────────────────────────────────────────────────── */}
      {activeTab === 'general' && (
        <>
          {/* Nombre */}
          <p className="pcm-section-title">Identificación</p>
          <div className="pcm-field">
            <label className="pcm-field__label">Nombre</label>
            <input className="pcm-field__input" value={page.name} onChange={e => upd({ name: e.target.value })} />
          </div>

          {/* Tamaño */}
          <p className="pcm-section-title">Tamaño</p>
          <div className="pcm-field" style={{ marginTop: 6 }}>
            <label className="pcm-field__label">Preset</label>
            <select className="pcm-field__select" value={page.size?.preset ?? 'custom'} onChange={e => handlePresetChange(e.target.value)}>
              {PAGE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          <div className="pcm-row pcm-row--mb">
            <div className="pcm-field">
              <label className="pcm-field__label">Ancho</label>
              <UnitInput valueMm={page.size?.width ?? 210} min={1}
                onChange={v => updSize({ width: v, preset: 'custom' })} />
            </div>
            <div className="pcm-field">
              <label className="pcm-field__label">Alto</label>
              <UnitInput valueMm={page.size?.height ?? 297} min={1}
                onChange={v => updSize({ height: v, preset: 'custom' })} />
            </div>
          </div>

          {/* Orientación */}
          <div className="pcsm__mode-row" style={{ marginBottom: 10 }}>
            {[
              { v: 'portrait',  label: 'Vertical',     hint: '↕' },
              { v: 'landscape', label: 'Horizontal',   hint: '↔' },
            ].map(({ v, label, hint }) => (
              <button key={v}
                className={`pcsm__mode-btn${page.orientation === v ? ' pcsm__mode-btn--active' : ''}`}
                onClick={() => handleOrientationChange(v)}
              >
                <span className="pcsm__mode-label">{hint} {label}</span>
              </button>
            ))}
          </div>

          {/* Márgenes */}
          <p className="pcm-section-title">Márgenes</p>
          <div className="pcm-row pcm-row--mb">
            <div className="pcm-field">
              <label className="pcm-field__label">Superior</label>
              <UnitInput valueMm={page.margins?.top ?? 20}    min={0} onChange={v => updMargins({ top: v })} />
            </div>
            <div className="pcm-field">
              <label className="pcm-field__label">Inferior</label>
              <UnitInput valueMm={page.margins?.bottom ?? 20} min={0} onChange={v => updMargins({ bottom: v })} />
            </div>
          </div>
          <div className="pcm-row pcm-row--mb">
            <div className="pcm-field">
              <label className="pcm-field__label">Izquierdo</label>
              <UnitInput valueMm={page.margins?.left ?? 20}   min={0} onChange={v => updMargins({ left: v })} />
            </div>
            <div className="pcm-field">
              <label className="pcm-field__label">Derecho</label>
              <UnitInput valueMm={page.margins?.right ?? 20}  min={0} onChange={v => updMargins({ right: v })} />
            </div>
          </div>

          {/* Fondo */}
          <p className="pcm-section-title">Fondo</p>
          <div className="pcm-row pcm-row--mb">
            <div className="pcm-field">
              <label className="pcm-field__label">Color</label>
              <div className="ppp-color-row">
                <input type="color" className="ppp-color-input"
                  value={page.background?.color ?? '#ffffff'}
                  onChange={e => upd({ background: { ...page.background, color: e.target.value } })} />
                <input className="pcm-field__input"
                  value={page.background?.color ?? '#ffffff'}
                  onChange={e => upd({ background: { ...page.background, color: e.target.value } })} />
              </div>
            </div>
          </div>

          {/* Peso / dinámica */}
          <p className="pcm-section-title">Avanzado</p>
          <div className="pcm-field">
            <label className="pcm-field__label">Peso (weight)</label>
            <input className="pcm-field__input" type="number" min={0} step={1} value={page.weight ?? 0} onChange={e => upd({ weight: +e.target.value })} />
          </div>
          <div className="pcm-toggle">
            <div className="pcm-toggle__info">
              <span className="pcm-toggle__label">Altura dinámica</span>
              <span className="pcm-toggle__hint">El alto se ajusta al contenido</span>
            </div>
            <input type="checkbox" checked={page.dynamicHeight ?? false} onChange={e => upd({ dynamicHeight: e.target.checked })} />
          </div>
          {page.dynamicHeight && (
            <div className="pcm-field">
              <label className="pcm-field__label">Agregar al alto</label>
              <UnitInput valueMm={page.addHeightToPage ?? 0} min={0}
                onChange={v => upd({ addHeightToPage: v })} />
            </div>
          )}
        </>
      )}

      {/* ── NEXT PAGE ────────────────────────────────────────────────────── */}
      {activeTab === 'nextpage' && (
        <>
          <p className="pcm-section-title">Tipo de siguiente página</p>
          <div className="pcsm__ts-grid">
            {NEXT_PAGE_TYPES.map(({ v, label, hint }) => (
              <button key={v}
                className={`pcsm__ts-card${pfType === v ? ' pcsm__ts-card--active' : ''}`}
                onClick={() => handleFlowTypeChange(v)}
              >
                <span className="pcsm__ts-card-label">{label}</span>
                <span className="pcsm__ts-card-hint">{hint}</span>
              </button>
            ))}
          </div>

          {/* none */}
          {pfType === 'none' && (
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8, textAlign: 'center' }}>
              Sin flujo de siguiente página definido.
            </p>
          )}

          {/* simple */}
          {pfType === 'simple' && (
            <div className="pcm-field" style={{ marginTop: 10 }}>
              <label className="pcm-field__label">Ir a página</label>
              <PageSelect value={pf.pageId} onChange={v => updFlow({ pageId: v })} placeholder="(ninguna)" />
            </div>
          )}

          {/* text / integer */}
          {(pfType === 'text' || pfType === 'integer') && (
            <>
              <p className="pcm-section-title">Mapeo de valores</p>
              <div className="pcm-field">
                <label className="pcm-field__label">Variable a comparar</label>
                <FieldInput id="ppp-var" value={pf.variable} onChange={v => updFlow({ variable: v })}
                  placeholder={pfType === 'integer' ? 'ej: data.cantidad' : 'ej: data.tipo'}
                  fields={pfType === 'integer'
                    ? allFields.filter(f => ['number', 'integer', 'int'].includes(f.type))
                    : allFields.filter(f => ['string', 'text'].includes(f.type))
                  } />
              </div>
              <table className="pcsm__rules-table">
                <thead><tr><th>Valor</th><th>Página</th><th></th></tr></thead>
                <tbody>
                  {mappings.map(m => (
                    <tr key={m.id} className="pcsm__rule-row">
                      <td>
                        <input className="pcm-field__input" type={pfType === 'integer' ? 'number' : 'text'}
                          value={m.value ?? ''} onChange={e => updateMapping(m.id, { value: pfType === 'integer' ? +e.target.value : e.target.value })} />
                      </td>
                      <td><PageSelect value={m.pageId} onChange={v => updateMapping(m.id, { pageId: v })} /></td>
                      <td><button className="pcsm__rule-del" onClick={() => removeMapping(m.id)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                  <tr className="pcsm__rule-row pcsm__rule-row--default">
                    <td><span className="pcsm__default-label">Default</span></td>
                    <td><PageSelect value={pf.defaultPageId} onChange={v => updFlow({ defaultPageId: v })} placeholder="(omitir)" /></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              <button className="pcsm__add-rule" onClick={addMapping}><Plus size={12} /> Agregar valor</button>
            </>
          )}

          {/* condition */}
          {pfType === 'condition' && (
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
                    <td><PageSelect value={pf.defaultPageId} onChange={v => updFlow({ defaultPageId: v })} placeholder="(omitir)" /></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
              <button className="pcsm__add-rule" onClick={addRule}><Plus size={12} /> Agregar regla</button>
            </>
          )}

          {/* script */}
          {pfType === 'script' && (
            <>
              <p className="pcm-section-title">Script (devuelve ID de página)</p>
              <div className="pcp-script-toolbar">
                <span className="pcp-script-label">Retorna el <code>id</code> de la página destino</span>
                <button className="pcp-script-expand" onClick={() => setShowScriptModal(true)} title="Ampliar editor">
                  <Maximize2 size={11} /> Ampliar
                </button>
              </div>
              <div className="pcp-script-editor-wrap">
                <ScriptEditor value={pf.script ?? ''} onChange={v => updFlow({ script: v })}
                  placeholder={'// Ejemplo:\nreturn packet.data.type === "A" ? "pg_001" : "pg_002";'}
                  upstreamFields={allFields} />
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

      {/* ScriptEditorModal */}
      {showScriptModal && (
        <ScriptEditorModal
          script={pf.script ?? ''}
          onSave={v => updFlow({ script: v })}
          onClose={() => setShowScriptModal(false)}
          availableFields={allFields}
        />
      )}
    </div>
  );
}
