// layout/LayoutEditor.jsx — Visual drag-drop layout boceto editor

import { useState } from 'react';
import { X, RotateCcw, AlignJustify, Columns2 } from 'lucide-react';
import { PANELS, ZONE_LABELS, getHiddenPanels, movePanel } from './layoutConfig.js';
import './LayoutEditor.css';

// ── Module-level drag state ───────────────────────────────────────────────────
// Using module vars (not React state) so they're always current in event handlers.

let _dragId      = null; // panel being dragged
let _dropTarget  = null; // last valid { zone, index } hovered
let _dropFired   = false; // true once onDrop event handled the drop

// ── PanelChip ────────────────────────────────────────────────────────────────

function PanelChip({ panelId, onDragEnd: onDragEndProp }) {
  const p = PANELS[panelId];
  return (
    <div
      className="le-chip"
      style={{ '--chip-color': p.color }}
      draggable
      onDragStart={e => {
        _dragId     = panelId;
        _dropFired  = false;
        _dropTarget = null;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', panelId);
      }}
      onDragEnd={() => {
        // Fallback: if onDrop never fired (Electron/VSCode webview quirk),
        // complete the drop using the last known hovered zone.
        if (!_dropFired && _dragId && _dropTarget) {
          onDragEndProp?.(_dragId, _dropTarget.zone, _dropTarget.index);
        }
        _dragId     = null;
        _dropTarget = null;
        _dropFired  = false;
      }}
      title={p.label}
    >
      <span className="le-chip__dot" />
      <span className="le-chip__label">{p.shortLabel}</span>
    </div>
  );
}

// ── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ zoneId, panels, orientation, activeDropTarget, onDragOver, onDrop, onDragLeave, onChipDragEnd }) {
  const isTarget = activeDropTarget?.zone === zoneId;
  const dropIdx  = isTarget ? activeDropTarget.index : -1;

  function isAllowed(panelId) {
    return !!PANELS[panelId]?.allowedZones.includes(zoneId);
  }

  function getInsertIndex(e, el) {
    const chips = [...el.querySelectorAll('.le-chip')];
    if (!chips.length) return 0;
    for (let i = 0; i < chips.length; i++) {
      const cr  = chips[i].getBoundingClientRect();
      const mid = orientation === 'h' ? cr.left + cr.width / 2 : cr.top + cr.height / 2;
      const pos = orientation === 'h' ? e.clientX : e.clientY;
      if (pos < mid) return i;
    }
    return chips.length;
  }

  return (
    <div
      className={`le-zone le-zone--${orientation}${isTarget ? ' le-zone--target' : ''}${panels.length === 0 ? ' le-zone--empty' : ''}`}
      onDragOver={e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!_dragId) return;
        const idx = getInsertIndex(e, e.currentTarget);
        _dropTarget = { zone: zoneId, index: idx }; // keep in sync
        onDragOver(zoneId, idx);
      }}
      onDrop={e => {
        e.preventDefault();
        const panelId = _dragId || e.dataTransfer.getData('text/plain') || null;
        if (!panelId || !isAllowed(panelId)) return;
        _dropFired = true;
        onDrop(panelId, zoneId, getInsertIndex(e, e.currentTarget));
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          onDragLeave(); // clear visual only — _dropTarget preserved for dragend fallback
        }
      }}
    >
      {panels.length === 0 && (
        <span className="le-zone__empty-hint">{ZONE_LABELS[zoneId]}</span>
      )}
      {panels.map((id, i) => (
        <div key={id} className="le-chip-wrap">
          {isTarget && dropIdx === i && <div className="le-drop-indicator" />}
          <PanelChip panelId={id} onDragEnd={onChipDragEnd} />
        </div>
      ))}
      {isTarget && dropIdx === panels.length && <div className="le-drop-indicator" />}
    </div>
  );
}

// ── HiddenPool ───────────────────────────────────────────────────────────────

function HiddenPool({ panels, activeDropTarget, onDragOver, onDrop, onDragLeave, onChipDragEnd }) {
  const isTarget = activeDropTarget?.zone === 'hidden';
  return (
    <div
      className={`le-pool${isTarget ? ' le-pool--target' : ''}`}
      onDragOver={e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!_dragId) return;
        _dropTarget = { zone: 'hidden', index: 0 };
        onDragOver('hidden', 0);
      }}
      onDrop={e => {
        e.preventDefault();
        const panelId = _dragId || e.dataTransfer.getData('text/plain') || null;
        if (!panelId) return;
        _dropFired = true;
        onDrop(panelId, 'hidden', 0);
      }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          onDragLeave(); // clear visual only — _dropTarget preserved for dragend fallback
        }
      }}
    >
      <span className="le-pool__label">Ocultos</span>
      <div className="le-pool__chips">
        {panels.length === 0
          ? <span className="le-pool__empty">Arrastra paneles aquí para ocultarlos</span>
          : panels.map(id => <PanelChip key={id} panelId={id} onDragEnd={onChipDragEnd} />)
        }
      </div>
    </div>
  );
}

// ── Zone mode toggle ──────────────────────────────────────────────────────────

function ZoneModeToggle({ zoneId, isSplit, onToggle }) {
  return (
    <div className="le-zone-mode">
      <button
        className={`le-zone-mode-btn${!isSplit ? ' le-zone-mode-btn--active' : ''}`}
        onClick={() => isSplit && onToggle(zoneId)}
        title="Vista compacta con tabs"
      >
        <AlignJustify size={10} /> Tabs
      </button>
      <button
        className={`le-zone-mode-btn${isSplit ? ' le-zone-mode-btn--active' : ''}`}
        onClick={() => !isSplit && onToggle(zoneId)}
        title="Vista separada, paneles siempre visibles"
      >
        <Columns2 size={10} /> Separado
      </button>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function LayoutEditor({ current, onApply, onClose, onReset }) {
  const [draft, setDraft]             = useState(() => structuredClone(current));
  const [activeDropTarget, setActiveDropTarget] = useState(null);

  const hidden     = getHiddenPanels(draft);
  const splitZones = draft.splitZones ?? [];

  function applyDrop(panelId, toZone, toIndex) {
    if (toZone !== 'hidden' && !PANELS[panelId]?.allowedZones.includes(toZone)) return;
    setDraft(prev => movePanel(prev, panelId, toZone, toIndex));
    setActiveDropTarget(null);
  }

  function toggleSplitZone(zoneId) {
    setDraft(prev => {
      const cur  = prev.splitZones ?? [];
      const next = cur.includes(zoneId) ? cur.filter(z => z !== zoneId) : [...cur, zoneId];
      return { ...prev, splitZones: next };
    });
  }

  const contentOf = zone => (draft[zone] ?? []).filter(id => id !== 'element-bar');

  // Shared props for all drop zones
  const zoneProps = {
    activeDropTarget,
    onDragOver:    (z, i) => setActiveDropTarget({ zone: z, index: i }),
    onDrop:        applyDrop,
    onDragLeave:   () => setActiveDropTarget(null),
    onChipDragEnd: (panelId, zone, index) => applyDrop(panelId, zone, index),
  };

  return (
    <div className="le-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="le-modal">

        {/* Header */}
        <div className="le-header">
          <span className="le-title">Disposición del espacio de trabajo</span>
          <div className="le-header__actions">
            <button className="le-btn le-btn--ghost" onClick={onReset} title="Restablecer">
              <RotateCcw size={14} /> Restablecer
            </button>
            <button className="le-btn le-btn--icon" onClick={onClose}><X size={16} /></button>
          </div>
        </div>

        {/* Boceto */}
        <div className="le-boceto-wrap">
          <div className="le-boceto">

            {/* Top */}
            <div className="le-row le-row--top">
              <DropZone zoneId="top" panels={draft.top ?? []} orientation="h" {...zoneProps} />
            </div>

            {/* Middle */}
            <div className="le-row le-row--middle">

              {/* Left */}
              <div className="le-col-composite">
                {(draft.left ?? []).includes('element-bar') && (
                  <div className="le-elementbar-strip le-elementbar-strip--v" title="Barra de herramientas">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="le-elementbar-dot" />)}
                  </div>
                )}
                <div className="le-col-composite__body">
                  <DropZone zoneId="left" panels={contentOf('left')} orientation="v" {...zoneProps} />
                  {contentOf('left').length > 1 && (
                    <ZoneModeToggle zoneId="left" isSplit={splitZones.includes('left')} onToggle={toggleSplitZone} />
                  )}
                </div>
              </div>

              {/* Left2 — columna extra entre izquierda y canvas */}
              <div className="le-col-composite">
                <div className="le-col-composite__body">
                  <DropZone zoneId="left2" panels={contentOf('left2')} orientation="v" {...zoneProps} />
                  {contentOf('left2').length > 1 && (
                    <ZoneModeToggle zoneId="left2" isSplit={splitZones.includes('left2')} onToggle={toggleSplitZone} />
                  )}
                </div>
              </div>

              {/* Canvas */}
              <div className="le-canvas">
                <span className="le-canvas__label">Canvas</span>
                <span className="le-canvas__hint">(fijo)</span>
              </div>

              {/* Right2 — columna extra entre canvas y derecha */}
              <div className="le-col-composite">
                <div className="le-col-composite__body">
                  <DropZone zoneId="right2" panels={contentOf('right2')} orientation="v" {...zoneProps} />
                  {contentOf('right2').length > 1 && (
                    <ZoneModeToggle zoneId="right2" isSplit={splitZones.includes('right2')} onToggle={toggleSplitZone} />
                  )}
                </div>
              </div>

              {/* Right */}
              <div className="le-col-composite">
                <div className="le-col-composite__body">
                  <DropZone zoneId="right" panels={contentOf('right')} orientation="v" {...zoneProps} />
                  {contentOf('right').length > 1 && (
                    <ZoneModeToggle zoneId="right" isSplit={splitZones.includes('right')} onToggle={toggleSplitZone} />
                  )}
                </div>
                {(draft.right ?? []).includes('element-bar') && (
                  <div className="le-elementbar-strip le-elementbar-strip--v" title="Barra de herramientas">
                    {Array.from({ length: 5 }).map((_, i) => <div key={i} className="le-elementbar-dot" />)}
                  </div>
                )}
              </div>

            </div>

            {/* Bottom */}
            <div className="le-row le-row--bottom">
              {(draft.bottom ?? []).includes('element-bar') && (
                <div className="le-elementbar-strip le-elementbar-strip--h" title="Barra de herramientas">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="le-elementbar-dot" />)}
                </div>
              )}
              <DropZone zoneId="bottom" panels={contentOf('bottom')} orientation="h" {...zoneProps} />
            </div>

          </div>
        </div>

        {/* Hidden pool */}
        <HiddenPool panels={hidden} {...zoneProps} />

        {/* Legend */}
        <div className="le-legend">
          {Object.entries(PANELS).map(([id, p]) => (
            <div key={id} className="le-legend__item">
              <span className="le-legend__dot" style={{ background: p.color }} />
              <span className="le-legend__label">{p.shortLabel}</span>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="le-footer">
          <button className="le-btn le-btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="le-btn le-btn--primary" onClick={() => { onApply(draft); onClose(); }}>
            Aplicar disposición
          </button>
        </div>

      </div>
    </div>
  );
}
