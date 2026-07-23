// CanvasStatusBar.jsx — Barra de estado inferior del canvas
import { Grid3x3, ChevronRight } from 'lucide-react';
import './CanvasStatusBar.css';

const UNITS = ['mm', 'cm', 'pt', 'px', 'in'];

const UNIT_FMT = {
  mm: { fromMm: 1,        decimals: 1 },
  cm: { fromMm: 0.1,      decimals: 2 },
  pt: { fromMm: 2.835,    decimals: 0 },
  px: { fromMm: 3.7795,   decimals: 0 },
  in: { fromMm: 1/25.4,   decimals: 3 },
};

function formatCoord(mm, unit) {
  if (mm == null) return '--';
  const cfg = UNIT_FMT[unit] ?? UNIT_FMT.mm;
  const val = mm * cfg.fromMm;
  return val.toFixed(cfg.decimals);
}

export default function CanvasStatusBar({ cursorMm, unit, setUnit, showGrid, setShowGrid, zoom, setZoomLevel, onZoomFit, onZoomFitWidth, pageSizeMm, cursorPath }) {
  const x = cursorMm ? formatCoord(cursorMm.x, unit) : '--';
  const y = cursorMm ? formatCoord(cursorMm.y, unit) : '--';

  const pageW = pageSizeMm ? formatCoord(pageSizeMm.w, unit) : null;
  const pageH = pageSizeMm ? formatCoord(pageSizeMm.h, unit) : null;

  return (
    <div className="csb">
      {/* Editor cursor breadcrumb — shown when a content area editor is active */}
      {cursorPath && cursorPath.length > 0 && (
        <>
          <span className="csb-cursor-path">
            {cursorPath.map((segment, i) => (
              <span key={i} className="csb-cursor-path__segment">
                {i > 0 && <ChevronRight size={9} className="csb-cursor-path__sep" />}
                {segment}
              </span>
            ))}
          </span>
          <div className="csb-sep" />
        </>
      )}

      {/* Cursor position */}
      <span className="csb-coords">
        X: <strong>{x}</strong>&nbsp; Y: <strong>{y}</strong>&nbsp;{unit}
      </span>

      {/* Page dimensions */}
      {pageW && (
        <>
          <div className="csb-sep" />
          <span className="csb-page-size" title="Dimensiones de la hoja">
            {pageW} × {pageH} {unit}
          </span>
        </>
      )}

      <div className="csb-sep" />

      {/* Unit selector */}
      <span className="csb-label">Unidad:</span>
      <div className="csb-units">
        {UNITS.map(u => (
          <button key={u}
            className={`csb-unit-btn${unit === u ? ' csb-unit-btn--active' : ''}`}
            onClick={() => setUnit(u)}>
            {u}
          </button>
        ))}
      </div>

      <div className="csb-sep" />

      {/* Grid toggle */}
      <button
        className={`csb-icon-btn${showGrid ? ' csb-icon-btn--active' : ''}`}
        onClick={() => setShowGrid(!showGrid)}
        title={showGrid ? 'Ocultar grilla' : 'Mostrar grilla'}>
        <Grid3x3 size={13} />
        Grilla
      </button>

      <div className="csb-sep" />

      {/* Zoom */}
      <button className="csb-zoom-btn" onClick={() => setZoomLevel(z => Math.max(0.1, z - 0.1))}>−</button>
      <span className="csb-zoom-val">{Math.round(zoom * 100)}%</span>
      <button className="csb-zoom-btn" onClick={() => setZoomLevel(z => Math.min(5, z + 0.1))}>+</button>
      <button className="csb-zoom-fit" onClick={() => setZoomLevel(1)} title="Zoom real (100%)">1:1</button>
      <button className="csb-zoom-fit" onClick={onZoomFit} title="Ajustar hoja al área visible">Ajustar</button>
      <button className="csb-zoom-fit" onClick={onZoomFitWidth} title="Ajustar ancho de hoja al área visible">Ancho</button>
    </div>
  );
}
