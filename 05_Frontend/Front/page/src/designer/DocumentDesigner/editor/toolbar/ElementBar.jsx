// ElementBar.jsx — Vertical element insertion toolbar (left edge)
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2, Image, Table2, Workflow, FileText,
  Barcode, BarChart3, LayoutDashboard,
} from 'lucide-react';
import './ElementBar.css';
import ShapesButton from './ShapesGallery.jsx';

// ── Table Grid Picker (rendered via portal at fixed position) ─────────────

const GRID_COLS = 8;
const GRID_ROWS = 8;

function TableGridPicker({ anchorRect, onPick, onAdvanced, onClose }) {
  const [hovered, setHovered] = useState({ col: 0, row: 0 });

  // Position: to the right of the toolbar button, vertically centred on it
  const top  = anchorRect ? Math.round(anchorRect.top) : 0;
  const left = anchorRect ? Math.round(anchorRect.right + 6) : 0;

  const label = hovered.col > 0 && hovered.row > 0
    ? `${hovered.col} × ${hovered.row}`
    : 'Selecciona tamaño';

  return createPortal(
    <div
      className="tgp"
      style={{ top, left }}
      onMouseLeave={onClose}
    >
      <p className="tgp__title">Insertar tabla</p>
      <div
        className="tgp__grid"
        onMouseLeave={() => setHovered({ col: 0, row: 0 })}
      >
        {Array.from({ length: GRID_ROWS }, (_, rowIdx) => (
          <div key={rowIdx} className="tgp__grid-row">
            {Array.from({ length: GRID_COLS }, (_, colIdx) => {
              const col = colIdx + 1;
              const row = rowIdx + 1;
              const active = col <= hovered.col && row <= hovered.row;
              return (
                <div
                  key={colIdx}
                  className={`tgp__cell${active ? ' tgp__cell--active' : ''}`}
                  onMouseEnter={() => setHovered({ col, row })}
                  onClick={() => {
                    if (hovered.col > 0 && hovered.row > 0) onPick(hovered.col, hovered.row);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="tgp__label">{label}</p>
      <button className="tgp__advanced" onClick={onAdvanced}>
        <LayoutDashboard size={13} />
        <span>Tabla avanzada…</span>
      </button>
    </div>,
    document.body,
  );
}

// ── Tools list ────────────────────────────────────────────────────────────

const TOOLS = [
  { id: 'select',      icon: MousePointer2, label: 'Seleccionar (V)' },
  { separator: true },
  { id: 'contentarea', icon: FileText,      label: 'Content Area (A)' },
  { id: 'image',       icon: Image,         label: 'Imagen (I)' },
  { id: 'table',       icon: Table2,        label: 'Tabla',  gridPicker: true },
  { id: 'floworder',   icon: Workflow,      label: 'Orden de desbordamiento' },
  { id: 'barcode',     icon: Barcode,       label: 'Código de Barras' },
  { id: 'chart',       icon: BarChart3,     label: 'Gráfico' },
  { separator: true },
];

// ── Main component ────────────────────────────────────────────────────────

export default function ElementBar({ state }) {
  const { activeTool, activeShape, setActiveTool, setActiveShape, setTableGridDims, setAdvancedTableMode, setFloworderSource } = state;
  const [pickerOpen, setPickerOpen]     = useState(false);
  const [anchorRect, setAnchorRect]     = useState(null);
  const btnRef    = useRef(null);
  const closeTimer = useRef(null);

  function handleTool(toolId, subShape) {
    if (toolId === 'floworder') setFloworderSource?.(null); // re-armar limpio al entrar
    setActiveTool(toolId);
    if (subShape) setActiveShape(subShape);
  }

  function isActive(tool) {
    if (!tool.subShape) return activeTool === tool.id && tool.id !== 'shape';
    return activeTool === 'shape' && activeShape === tool.subShape;
  }

  const openPicker = useCallback(() => {
    clearTimeout(closeTimer.current);
    if (btnRef.current) setAnchorRect(btnRef.current.getBoundingClientRect());
    setPickerOpen(true);
  }, []);

  const closePicker = useCallback(() => {
    closeTimer.current = setTimeout(() => setPickerOpen(false), 120);
  }, []);

  // Close on scroll / resize so the fixed position doesn't go stale
  useEffect(() => {
    if (!pickerOpen) return;
    const close = () => setPickerOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pickerOpen]);

  function handleGridPick(cols, rows) {
    setAdvancedTableMode?.(false);
    setTableGridDims?.({ cols, rows });
    setActiveTool('table');
    setPickerOpen(false);
  }

  // "Tabla avanzada…": enter table-draw mode; drawing the zone opens the
  // InsertTableDialog (handled in DesignCanvas) to configure the full table.
  function handleAdvanced() {
    setAdvancedTableMode?.(true);
    setActiveTool('table');
    setPickerOpen(false);
  }

  return (
    <div className="ebar">
      {TOOLS.map((tool, i) => {
        if (tool.separator) return <div key={`sep-${i}`} className="ebar__sep" />;
        const Icon = tool.icon;

        if (tool.gridPicker) {
          return (
            <div
              key="table-wrap"
              className="ebar__table-wrap"
              onMouseEnter={openPicker}
              onMouseLeave={closePicker}
            >
              <button
                ref={btnRef}
                className={`ebar__btn${isActive(tool) ? ' ebar__btn--active' : ''}`}
                onClick={() => {
                  setTableGridDims?.({ cols: 3, rows: 2 });
                  handleTool(tool.id);
                  setPickerOpen(false);
                }}
                title={tool.label}
              >
                <Icon size={16} />
              </button>

              {pickerOpen && anchorRect && (
                <TableGridPicker
                  anchorRect={anchorRect}
                  onPick={handleGridPick}
                  onAdvanced={handleAdvanced}
                  onClose={closePicker}
                />
              )}
            </div>
          );
        }

        return (
          <button
            key={`${tool.id}-${tool.subShape ?? i}`}
            className={`ebar__btn${isActive(tool) ? ' ebar__btn--active' : ''}`}
            onClick={() => handleTool(tool.id, tool.subShape)}
            title={tool.label}
          >
            <Icon size={16} />
          </button>
        );
      })}

      {/* Formas: un solo botón que abre la galería (popover a la derecha) */}
      <ShapesButton
        variant="bar"
        activeShape={activeShape}
        isShapeTool={activeTool === 'shape'}
        onPick={(id) => { setActiveTool('shape'); setActiveShape(id); }}
        hint="Formas"
      />
    </div>
  );
}
