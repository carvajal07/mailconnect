// editor/properties/tabs/ContentAreaTab.jsx — Gestión de sub-áreas y overflow

import { useState } from 'react';
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { collectAllAreaNums } from '../../canvas/elements/contentAreaUtils.js';
import './ContentAreaTab.css';

const FLOW_TYPE_LABELS = {
  simple:             'Simple',
  repeated:           'Repetido',
  'inline-condition': 'Variable',
  section:            'Sección',
};

function InfoBadge({ text }) {
  return (
    <span className="cat__info-badge" title={text}>
      <Info size={11} />
    </span>
  );
}

export default function ContentAreaTab({ element, state, availableFields }) {
  const {
    addArea, removeArea, updateArea,
    enterAreaEdit, focusedAreaCtx, setFocusedAreaCtx, clearSelection,
    template, updateCurrentPage, currentPageIndex,
  } = state;

  const [showFitting, setShowFitting] = useState(false);

  const rootArea  = state.resolveAreas?.(element)?.[0] ?? null;
  const subAreas  = rootArea?.children ?? [];
  const flowType  = rootArea?.flowType ?? 'simple';

  const currentPage  = template?.pages?.[currentPageIndex] ?? null;
  const pageElements = currentPage?.elements ?? [];
  const caElements   = pageElements.filter(el => el.type === 'contentarea' && el.id !== element.id);

  function handleUpdateElement(changes) {
    const updated = pageElements.map(el =>
      el.id === element.id ? { ...el, ...changes, updatedAt: new Date().toISOString() } : el
    );
    updateCurrentPage?.({ elements: updated });
  }

  function handleAddSubArea() {
    const usedNums = collectAllAreaNums(template);
    const nextLabel = `Área ${usedNums.length > 0 ? Math.max(...usedNums) + 1 : 1}`;
    const newId = addArea?.(element.id, rootArea.id);
    if (newId) {
      const tagHtml = `<span class="area-tag" data-area="${newId}" contenteditable="false">⎇ ${nextLabel}</span>​`;
      updateArea?.(null, rootArea.id, { content: (rootArea.content ?? '') + tagHtml });
    }
  }

  if (!rootArea) {
    return (
      <p style={{ padding: 12, color: '#9ca3af', fontSize: 11, fontStyle: 'italic' }}>
        Área no encontrada. Intenta eliminar y recrear el elemento.
      </p>
    );
  }

  return (
    <div className="cat">

      {/* ── Área raíz ── */}
      <div className="cat__root-info">
        <div className="pp-field">
          <label className="pp-field__label">Nombre del área</label>
          <input
            className="pp-field__input"
            value={rootArea.label ?? ''}
            onChange={e => updateArea?.(null, rootArea.id, { label: e.target.value })}
            placeholder="Área principal"
          />
        </div>
        <div className="cat__flow-type-row">
          <span className="pp-field__label">Tipo de flujo</span>
          <span className={`cat__flow-badge cat__flow-badge--${flowType}`}>
            {FLOW_TYPE_LABELS[flowType] ?? flowType}
          </span>
          <button
            className="cat__icon-btn cat__icon-btn--edit"
            title="Configurar flujo"
            onClick={() => {
              clearSelection?.();
              setFocusedAreaCtx?.({ caId: element.id, areaId: rootArea.id });
            }}
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>

      {/* ── Alineación y dirección ── */}
      <div className="cat__section">
        <p className="cat__section-title">Alineación y dirección</p>

        <div className="pp-field">
          <label className="pp-field__label">Alineación vertical</label>
          <select
            className="pp-field__select"
            value={element.verticalAlign ?? rootArea?.paragraphStyle?.verticalAlign ?? 'top'}
            onChange={e => handleUpdateElement({ verticalAlign: e.target.value })}
          >
            <option value="top">Arriba</option>
            <option value="middle">Centro</option>
            <option value="bottom">Abajo</option>
            <option value="justify">Justificado</option>
          </select>
        </div>

        <div className="pp-field">
          <label className="pp-field__label">Dirección de escritura</label>
          <select
            className="pp-field__select"
            value={element.writingDirection ?? 'horizontal'}
            onChange={e => handleUpdateElement({ writingDirection: e.target.value })}
          >
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
        </div>

        <div className="pp-toggle-row">
          <span className="pp-toggle-row__label">Soporte RTL (árabe, hebreo…)</span>
          <input
            type="checkbox"
            checked={element.worldwideSupport ?? false}
            onChange={e => handleUpdateElement({ worldwideSupport: e.target.checked })}
          />
        </div>

        <div className="pp-toggle-row">
          <span className="pp-toggle-row__label">Altura dinámica</span>
          <input
            type="checkbox"
            checked={element.dynamicHeight ?? false}
            onChange={e => handleUpdateElement({ dynamicHeight: e.target.checked })}
          />
        </div>
      </div>

      {/* ── Sub-áreas inline ── */}
      <div className="cat__header">
        <span className="cat__title">Sub-áreas ({subAreas.length})</span>
        <button className="cat__add-btn" onClick={handleAddSubArea} title="Crear nueva sub-área">
          <Plus size={13} />
          Añadir
        </button>
      </div>

      <div className="cat__list">
        {subAreas.map((area, i) => {
          const isActive = focusedAreaCtx?.caId === element.id && focusedAreaCtx?.areaId === area.id;
          return (
            <div
              key={area.id}
              className={`cat__item${isActive ? ' cat__item--active' : ''}`}
              onClick={() => {
                clearSelection?.();
                setFocusedAreaCtx?.({ caId: element.id, areaId: area.id });
              }}
            >
              <div className="cat__item-top">
                <input
                  className="cat__item-name"
                  value={area.label ?? ''}
                  onChange={e => updateArea?.(null, area.id, { label: e.target.value })}
                  onClick={e => e.stopPropagation()}
                  placeholder={`Sub-área ${i + 1}`}
                />
                <div className="cat__item-actions">
                  <button
                    className="cat__icon-btn cat__icon-btn--edit"
                    title="Editar sub-área"
                    onClick={e => {
                      e.stopPropagation();
                      enterAreaEdit?.(element.id, area.id, { miniCanvas: true });
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="cat__icon-btn cat__icon-btn--danger"
                    title="Eliminar sub-área"
                    onClick={e => { e.stopPropagation(); removeArea?.(null, area.id); }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {subAreas.length === 0 && (
          <p className="cat__empty">Sin sub-áreas.</p>
        )}
      </div>

      {/* ── Overflow chaining ── */}
      <div className="cat__section">
        <p className="cat__section-title">Overflow de texto</p>

        <div className="pp-field">
          <label className="pp-field__label">Viene de</label>
          <select
            className="pp-field__select"
            value={element.previousAreaRef ?? ''}
            onChange={e => handleUpdateElement({ previousAreaRef: e.target.value || null })}
          >
            <option value="">(Ninguno — inicio de cadena)</option>
            {caElements.map(ca => {
              const refArea = (template?.contentAreas ?? []).find(a => a.id === ca.areaRef);
              return (
                <option key={ca.id} value={ca.id}>
                  {refArea?.label ?? ca.id}
                </option>
              );
            })}
          </select>
        </div>

        <div className="pp-field">
          <label className="pp-field__label">Continúa en</label>
          <select
            className="pp-field__select"
            value={element.nextAreaRef ?? ''}
            onChange={e => handleUpdateElement({ nextAreaRef: e.target.value || null })}
          >
            <option value="">(Sin encadenar)</option>
            {caElements.map(ca => {
              const refArea = (template?.contentAreas ?? []).find(a => a.id === ca.areaRef);
              return (
                <option key={ca.id} value={ca.id}>
                  {refArea?.label ?? ca.id}
                </option>
              );
            })}
          </select>
        </div>

        <div className="pp-toggle-row">
          <span className="pp-toggle-row__label">
            Fluir a página siguiente
            <span style={{ display: 'block', fontSize: 10, color: 'var(--color-text-tertiary, #94a3b8)', fontWeight: 400 }}>
              Activo: el overflow continúa en una página nueva. Desactivo: continúa en la misma hoja.
            </span>
          </span>
          <input
            type="checkbox"
            checked={element.flowToNextPage ?? false}
            onChange={e => handleUpdateElement({ flowToNextPage: e.target.checked })}
          />
        </div>

        {element.flowToNextPage && (
          <div className="pp-toggle-row">
            <span className="pp-toggle-row__label">Permitir área vacía</span>
            <input
              type="checkbox"
              checked={element.allowEmptyFlowArea ?? false}
              onChange={e => handleUpdateElement({ allowEmptyFlowArea: e.target.checked })}
            />
          </div>
        )}
      </div>

      {/* ── Ajuste de contenido (producción) ── */}
      <div className="cat__section">
        <button
          className="cat__collapsible-header"
          onClick={() => setShowFitting(v => !v)}
        >
          {showFitting ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="cat__section-title" style={{ marginBottom: 0 }}>Ajuste avanzado</span>
          <InfoBadge text="Estas opciones solo tienen efecto al generar el documento en producción" />
        </button>

        {showFitting && (
          <div className="cat__collapsible-body">
            <div className="pp-field">
              <label className="pp-field__label">Ajuste (Fitting)</label>
              <select
                className="pp-field__select"
                value={element.fitting ?? 'none'}
                onChange={e => handleUpdateElement({ fitting: e.target.value })}
              >
                <option value="none">Ninguno</option>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
                <option value="both">Ambos</option>
              </select>
            </div>

            <div className="pp-toggle-row">
              <span className="pp-toggle-row__label">Equilibrar (Balancing)</span>
              <input
                type="checkbox"
                checked={element.useBalancing ?? false}
                onChange={e => handleUpdateElement({ useBalancing: e.target.checked })}
              />
            </div>

            <div className="pp-field">
              <label className="pp-field__label">Runaround interior</label>
              <select
                className="pp-field__select"
                value={element.runaroundMode ?? 'none'}
                onChange={e => handleUpdateElement({ runaroundMode: e.target.value })}
              >
                <option value="none">Ninguno</option>
                <option value="standard">Estándar</option>
                <option value="shapes-only">Solo formas</option>
              </select>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
