// EditorToolbar.jsx — View controls: undo/redo, grid, guides, zoom, alignment
import {
  ZoomIn, ZoomOut, Maximize2, Eye, Grid3X3,
  Undo2, Redo2, Braces, LayoutDashboard,
  AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
  AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter,
} from 'lucide-react';
import './EditorToolbar.css';

export default function EditorToolbar({ state, showVarPreview, onToggleVarPreview, onOpenLayoutEditor }) {
  const {
    zoom, zoomIn, zoomOut, zoomFit,
    showGrid, setShowGrid,
    showGuides, setShowGuides,
    undo, redo, canUndo, canRedo,
    selectedIds, alignElements,
  } = state;

  const multiSelected = (selectedIds?.length ?? 0) >= 2;

  return (
    <div className="ddt">
      {/* ── Undo / Redo ── */}
      <button
        className="ddt__btn"
        onClick={undo}
        disabled={!canUndo()}
        title="Deshacer (Ctrl+Z)"
      >
        <Undo2 size={15} />
      </button>
      <button
        className="ddt__btn"
        onClick={redo}
        disabled={!canRedo()}
        title="Rehacer (Ctrl+Y)"
      >
        <Redo2 size={15} />
      </button>

      <div className="ddt__sep" />

      {/* ── Alineación (solo con 2+ elementos seleccionados) ── */}
      {multiSelected && (<>
        <button className="ddt__btn" onClick={() => alignElements('left')}    title="Alinear izquierda"><AlignStartHorizontal    size={15} /></button>
        <button className="ddt__btn" onClick={() => alignElements('centerH')} title="Centrar horizontalmente"><AlignCenterHorizontal size={15} /></button>
        <button className="ddt__btn" onClick={() => alignElements('right')}   title="Alinear derecha"><AlignEndHorizontal      size={15} /></button>
        <div className="ddt__sep" />
        <button className="ddt__btn" onClick={() => alignElements('top')}     title="Alinear arriba"><AlignStartVertical       size={15} /></button>
        <button className="ddt__btn" onClick={() => alignElements('middleV')} title="Centrar verticalmente"><AlignCenterVertical   size={15} /></button>
        <button className="ddt__btn" onClick={() => alignElements('bottom')}  title="Alinear abajo"><AlignEndVertical          size={15} /></button>
        {(selectedIds?.length ?? 0) >= 3 && (<>
          <div className="ddt__sep" />
          <button className="ddt__btn" onClick={() => alignElements('distributeH')} title="Distribuir horizontalmente"><AlignHorizontalDistributeCenter size={15} /></button>
          <button className="ddt__btn" onClick={() => alignElements('distributeV')} title="Distribuir verticalmente"><AlignVerticalDistributeCenter   size={15} /></button>
        </>)}
        <div className="ddt__sep" />
      </>)}

      {/* ── Vista ── */}
      <button
        className={`ddt__btn${showGrid ? ' ddt__btn--active' : ''}`}
        onClick={() => setShowGrid(v => !v)}
        title="Mostrar/ocultar cuadrícula"
      >
        <Grid3X3 size={15} />
      </button>
      <button
        className={`ddt__btn${showGuides ? ' ddt__btn--active' : ''}`}
        onClick={() => setShowGuides(v => !v)}
        title="Mostrar/ocultar guías"
      >
        <Eye size={15} />
      </button>

      <button
        className={`ddt__btn${showVarPreview ? ' ddt__btn--active' : ''}`}
        onClick={onToggleVarPreview}
        title="Vista previa de variables"
      >
        <Braces size={15} />
      </button>

      <div className="ddt__sep" />

      {/* ── Zoom ── */}
      <button className="ddt__btn" onClick={zoomOut} title="Alejar (-)">
        <ZoomOut size={15} />
      </button>
      <button className="ddt__zoom-label" onClick={zoomFit} title="Zoom 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="ddt__btn" onClick={zoomIn} title="Acercar (+)">
        <ZoomIn size={15} />
      </button>
      <button className="ddt__btn" onClick={zoomFit} title="Ajustar a pantalla">
        <Maximize2 size={15} />
      </button>

      <div className="ddt__sep" />

      {/* ── Layout ── */}
      <button
        className="ddt__btn"
        onClick={onOpenLayoutEditor}
        title="Disposición del espacio de trabajo"
      >
        <LayoutDashboard size={15} />
      </button>
    </div>
  );
}
