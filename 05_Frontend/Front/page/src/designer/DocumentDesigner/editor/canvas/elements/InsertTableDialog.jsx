// InsertTableDialog.jsx — Dialog to configure a new embedded table before inserting
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X, PanelTop, LayoutGrid, PanelBottom,
  Ban, Square, Grid3X3, LayoutDashboard,
  Table2,
} from 'lucide-react';
import { genId, createCell } from '../../../engine/elementFactory.js';
import { makeCellBorder } from '../../../engine/tableStyleUtils.js';
import './InsertTableDialog.css';

// ── Sub-components ─────────────────────────────────────────────────────────────

function Spinner({ value, min = 0, max = 20, onChange, disabled }) {
  return (
    <div className={`itd__spinner${disabled ? ' itd__spinner--disabled' : ''}`}>
      <button type="button" className="itd__spin-btn"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={disabled || value <= min}>−</button>
      <span className="itd__spin-val">{value}</span>
      <button type="button" className="itd__spin-btn"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={disabled || value >= max}>+</button>
    </div>
  );
}

function Toggle({ label, checked, onChange, disabled }) {
  return (
    <label className={`itd__toggle-row${checked ? ' itd__toggle-row--active' : ''}${disabled ? ' itd__toggle-row--disabled' : ''}`}>
      <span className="itd__toggle">
        <input type="checkbox" checked={checked} disabled={disabled}
          onChange={e => onChange(e.target.checked)} />
        <span className="itd__toggle-track" />
        <span className="itd__toggle-thumb" />
      </span>
      <span className="itd__toggle-label">{label}</span>
    </label>
  );
}

// 3 icon-buttons for border presets: none / exterior / all
function BorderPresetButtons({ value, onChange, disabled }) {
  const options = [
    { id: 'none',     icon: Ban,      title: 'Sin bordes' },
    { id: 'exterior', icon: Square,   title: 'Solo exterior' },
    { id: 'all',      icon: Grid3X3,  title: 'Con líneas internas' },
  ];
  return (
    <div className="itd__preset-group" role="radiogroup">
      {options.map(opt => {
        const Icon = opt.icon;
        return (
          <button key={opt.id} type="button"
            className={`itd__preset-btn${value === opt.id ? ' itd__preset-btn--active' : ''}`}
            onClick={() => !disabled && onChange(opt.id)}
            disabled={disabled}
            title={opt.title}
            aria-checked={value === opt.id}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}

function BorderRow({ config, onChange, disabled, label = 'Bordes' }) {
  const isNone = config.preset === 'none';
  return (
    <div className={`itd__border-row${disabled ? ' itd__border-row--disabled' : ''}`}>
      <span className="itd__border-row-label">{label}</span>
      <BorderPresetButtons
        value={config.preset}
        onChange={p => onChange({ ...config, preset: p })}
        disabled={disabled}
      />
      <input
        type="color"
        className="itd__border-color"
        value={config.color}
        disabled={disabled || isNone}
        onChange={e => onChange({ ...config, color: e.target.value })}
        title="Color de borde"
      />
      <input
        type="number"
        className="itd__border-width"
        value={config.width}
        min={0.1} max={5} step={0.05}
        disabled={disabled || isNone}
        onChange={e => onChange({ ...config, width: parseFloat(e.target.value) || 0.25 })}
        title="Grosor (mm)"
      />
      <span className="itd__border-unit">mm</span>
    </div>
  );
}

function Section({ icon: Icon, title, color, disabled, children }) {
  return (
    <div
      className={`itd__section${disabled ? ' itd__section--disabled' : ''}`}
      style={{ '--section-color': color }}
    >
      <div className="itd__section-header">
        {Icon && <Icon size={13} className="itd__section-icon" />}
        <span className="itd__section-title">{title}</span>
      </div>
      <div className="itd__section-body">{children}</div>
    </div>
  );
}

// ── Live preview (mini-table) ──────────────────────────────────────────────────

function Preview({
  cols, headerRows, bodyRows, footerRows,
  firstHeaderSep, lastFooterSep, repeatBody,
  headerBorder, firstHeaderBorder, bodyBorder, footerBorder, lastFooterBorder,
  generalBorder,
  tableRadius = 0, tableCorners, cellCornersAll = false,
}) {
  const corners = tableCorners ?? { tl: true, tr: true, br: true, bl: true };
  const radiusPx = tableRadius * 1.5;
  const radiusCss = tableRadius > 0
    ? `${corners.tl ? radiusPx : 0}px ${corners.tr ? radiusPx : 0}px ${corners.br ? radiusPx : 0}px ${corners.bl ? radiusPx : 0}px`
    : null;
  // Build rows with their kind + border config
  // When firstHeaderSep is on, the FIRST header is an extra row added BEFORE the
  // regular header rows (matches buildTableStructure: 1 + headerRows).
  // Same for lastFooterSep: extra row added AFTER the regular footer rows.
  const rows = [];
  if (firstHeaderSep && headerRows > 0) {
    rows.push({ kind: 'fh', cfg: firstHeaderBorder });
  }
  for (let i = 0; i < headerRows; i++) rows.push({ kind: 'h', cfg: headerBorder });
  for (let i = 0; i < bodyRows; i++) rows.push({ kind: 'b', cfg: bodyBorder });
  for (let i = 0; i < footerRows; i++) rows.push({ kind: 'f', cfg: footerBorder });
  if (lastFooterSep && footerRows > 0) {
    rows.push({ kind: 'lf', cfg: lastFooterBorder });
  }

  // Group key for section-divider detection (header / body / footer).
  function group(kind) {
    if (kind === 'fh' || kind === 'h') return 'header';
    if (kind === 'lf' || kind === 'f') return 'footer';
    return 'body';
  }
  function sectionColor(g) {
    if (g === 'header') return '#3b82f6';
    if (g === 'footer') return '#f59e0b';
    return '#9ca3af';
  }

  function bw(cfg) { return Math.max(1, (cfg?.width ?? 0.25) * 3); }
  function bc(cfg) { return cfg?.color ?? '#000'; }

  return (
    <div className="itd-preview">
      <div className="itd-preview__title">Vista previa</div>
      <div className="itd-preview__canvas">
        {rows.length === 0 ? (
          <div className="itd-preview__empty">Sin filas</div>
        ) : (() => {
          const roundedActive = !!radiusCss;
          // Mode A: every cell rounded ('cells' preset)
          //   - <table> uses border-collapse: separate so individual cell radius works
          //   - each cell gets borderRadius + overflow:hidden
          //   - cells keep all 4 borders (since they're not collapsed, no double lines if
          //     we draw only one side per junction — but for simplicity we draw all sides
          //     and accept slight visual double on adjacent borders)
          //   - wrapper has NO border-radius (the cells handle the curves)
          // Mode B: outer perimeter only ('exterior' / 'custom')
          //   - <table> uses border-collapse: collapse (default behavior)
          //   - wrapper has border + borderRadius + overflow:hidden
          //   - cells skip their outer-edge borders so they don't conflict with wrapper
          const mode = cellCornersAll ? 'cells' : (roundedActive ? 'outer' : 'flat');
          const outerCfg = generalBorder ?? bodyBorder;
          const outerCss = roundedActive && outerCfg && outerCfg.preset !== 'none'
            ? `${bw(outerCfg)}px solid ${bc(outerCfg)}`
            : null;
          const wrapStyle = mode === 'outer'
            ? {
                borderRadius: radiusCss,
                overflow: 'hidden',
                ...(outerCss ? { border: outerCss, boxSizing: 'border-box' } : {}),
              }
            : undefined;
          const tableStyle = mode === 'cells'
            ? { borderCollapse: 'separate', borderSpacing: '2px' }
            : undefined;
          const cellRadiusPx = mode === 'cells' ? radiusPx : 0;
          return (
            <div className="itd-preview__round-wrap" style={wrapStyle}>
              <table className="itd-preview__table" style={tableStyle}>
                <tbody>
                  {rows.map((row, ri) => {
                    const all = row.cfg?.preset === 'all';
                    const ext = row.cfg?.preset === 'exterior' || all;
                    const isFirstRow = ri === 0;
                    const isLastRow  = ri === rows.length - 1;
                    const g = group(row.kind);
                    return (
                      <tr key={ri}>
                        {/* Section indicator bar (vertical color tag outside the table cells) */}
                        <td className="itd-preview__section-tag" style={{ background: sectionColor(g) }} />
                        {Array.from({ length: cols }).map((_, ci) => {
                          const isFirstCol = ci === 0;
                          const isLastCol  = ci === cols - 1;
                          // In 'outer' mode the wrapper draws the outer perimeter — cells
                          // skip those edges to avoid stacking with the wrapper border.
                          const skipOuterTop    = mode === 'outer' && isFirstRow;
                          const skipOuterBottom = mode === 'outer' && isLastRow;
                          const skipOuterLeft   = mode === 'outer' && isFirstCol;
                          const skipOuterRight  = mode === 'outer' && isLastCol;
                          // In 'cells' mode every cell draws all 4 borders so its
                          // border-radius is respected on every corner.
                          const cellsMode = mode === 'cells';
                          const style = {
                            borderTop:    cellsMode
                              ? (ext ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none')
                              : (isFirstRow && ext && !skipOuterTop ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none'),
                            borderBottom: cellsMode
                              ? (ext ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none')
                              : ((all || isLastRow) && ext && !skipOuterBottom ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none'),
                            borderLeft:   cellsMode
                              ? (ext ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none')
                              : (isFirstCol && ext && !skipOuterLeft ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none'),
                            borderRight:  cellsMode
                              ? (ext ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none')
                              : ((all || isLastCol) && ext && !skipOuterRight ? `${bw(row.cfg)}px solid ${bc(row.cfg)}` : 'none'),
                            ...(cellRadiusPx > 0 ? { borderRadius: `${cellRadiusPx}px`, overflow: 'hidden' } : {}),
                          };
                          return <td key={ci} style={style}> </td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
      <div className="itd-preview__caption">
        {cols} col × {rows.length} fila{rows.length !== 1 ? 's' : ''}
        {repeatBody && <span className="itd-preview__badge">↻ repetido</span>}
      </div>
    </div>
  );
}

// ── Structure builder (exported so callers can inject global counters) ─────────
// `makeCellBorder` (positional cell-border builder) is shared with
// tableApplyStyle via engine/tableStyleUtils.js — single source of truth.

export function buildTableStructure({
  cols, headerRows, bodyRows, footerRows,
  firstHeaderSeparate, lastFooterSeparate,
  repeatBody, repeatVar,
  startTableNum = 1, startRowNum = 1, startCellNum = 1,
  headerBorder = null, firstHeaderBorder = null,
  bodyBorder = null,
  footerBorder = null, lastFooterBorder = null,
  tableRadius = 0,
  tableCorners = { tl: true, tr: true, br: true, bl: true },
  outerBorder = null,
  cellCornersAll = false,
}) {
  const colCount = Math.max(1, cols);
  const ratio    = 1 / colCount;

  const columns = Array.from({ length: colCount }, (_, i) => ({
    id: genId('col'),
    label: `Col. ${i + 1}`,
    widthRatio: ratio,
    minWidth: 5,
    headerTag: false,
    enabledBy: null,
  }));

  let rowCursor  = startRowNum;
  let cellCursor = startCellNum;

  function makeSingleRow(borderCfg, isFirst, isLast) {
    const name  = `Fila ${rowCursor++}`;
    const cells = columns.map((col, i) => {
      const cell = createCell(col.id, '', {
        label:     `Columna ${cellCursor + i}`,
        areaLabel: `Área Columna ${cellCursor + i}`,
      });
      const b = makeCellBorder(borderCfg, i, colCount, isFirst, isLast);
      if (b) cell.border = b;
      return cell;
    });
    cellCursor += colCount;
    return { id: genId('rs'), name, type: 'single-row', cells };
  }

  function makeMultipleRows(childCount, borderCfg) {
    const name = `Fila ${rowCursor++}`;
    const children = Array.from({ length: childCount }, (_, idx) =>
      makeSingleRow(borderCfg, idx === 0, idx === childCount - 1)
    );
    const container = { id: genId('rs'), name, type: 'multiple-rows', childIds: children.map(r => r.id) };
    return { container, children };
  }

  const rowSets = [];

  if (headerRows === 0 && footerRows === 0) {
    if (repeatBody && repeatVar) {
      const bodyRow = makeSingleRow(bodyBorder, true, true);
      const root = { id: genId('rs'), name: `Fila ${rowCursor++}`, type: 'repeated', repeatVar, childIds: [bodyRow.id] };
      rowSets.push(bodyRow, root);
      return { columns, rowSets, rootRowSetId: root.id, tableRadius, tableCorners, outerBorder, cellCornersAll };
    }
    const count = Math.max(1, bodyRows);
    if (count === 1) {
      const root = makeSingleRow(bodyBorder, true, true);
      rowSets.push(root);
      return { columns, rowSets, rootRowSetId: root.id, tableRadius, tableCorners, outerBorder, cellCornersAll };
    }
    const { container, children } = makeMultipleRows(count, bodyBorder);
    rowSets.push(...children, container);
    return { columns, rowSets, rootRowSetId: container.id, tableRadius, tableCorners, outerBorder, cellCornersAll };
  }

  const root = {
    id: genId('rs'), name: `Fila ${rowCursor++}`, type: 'header-footer',
    displayAllRows: false,
    firstHeaderId: null, headerId: null,
    bodyId: null,
    footerId: null, lastFooterId: null,
  };
  rowSets.push(root);

  if (headerRows > 0) {
    if (firstHeaderSeparate) {
      const fhRow = makeSingleRow(firstHeaderBorder ?? headerBorder, true, true);
      rowSets.push(fhRow);
      root.firstHeaderId = fhRow.id;
    }
    if (headerRows === 1) {
      const hRow = makeSingleRow(headerBorder, true, true);
      rowSets.push(hRow);
      root.headerId = hRow.id;
      if (!firstHeaderSeparate) root.firstHeaderId = hRow.id;
    } else {
      const { container, children } = makeMultipleRows(headerRows, headerBorder);
      rowSets.push(...children, container);
      root.headerId = container.id;
      if (!firstHeaderSeparate) root.firstHeaderId = container.id;
    }
  }

  if (repeatBody && repeatVar) {
    const bodyRow = makeSingleRow(bodyBorder, true, true);
    const bodyRS  = { id: genId('rs'), name: `Fila ${rowCursor++}`, type: 'repeated', repeatVar, childIds: [bodyRow.id] };
    rowSets.push(bodyRow, bodyRS);
    root.bodyId = bodyRS.id;
  } else {
    const count = Math.max(1, bodyRows);
    if (count === 1) {
      const bodyRow = makeSingleRow(bodyBorder, true, true);
      rowSets.push(bodyRow);
      root.bodyId = bodyRow.id;
    } else {
      const { container, children } = makeMultipleRows(count, bodyBorder);
      rowSets.push(...children, container);
      root.bodyId = container.id;
    }
  }

  if (footerRows > 0) {
    if (footerRows === 1) {
      const fRow = makeSingleRow(footerBorder, true, true);
      rowSets.push(fRow);
      root.footerId = fRow.id;
      if (!lastFooterSeparate) root.lastFooterId = fRow.id;
    } else {
      const { container, children } = makeMultipleRows(footerRows, footerBorder);
      rowSets.push(...children, container);
      root.footerId = container.id;
      if (!lastFooterSeparate) root.lastFooterId = container.id;
    }
    if (lastFooterSeparate) {
      const lfRow = makeSingleRow(lastFooterBorder ?? footerBorder, true, true);
      rowSets.push(lfRow);
      root.lastFooterId = lfRow.id;
    }
  }

  return { columns, rowSets, rootRowSetId: root.id, tableRadius, tableCorners, outerBorder, cellCornersAll };
}

// ── Dialog ─────────────────────────────────────────────────────────────────────

const DEFAULT_BORDER       = { preset: 'all',  color: '#000000', width: 0.25 };
const DEFAULT_BORDER_NONE  = { preset: 'none', color: '#000000', width: 0.25 };

export default function InsertTableDialog({ availableFields = [], onConfirm, onCancel }) {
  const [cols, setCols]           = useState(3);
  const [headerRows, setHeader]   = useState(1);
  const [bodyRows, setBody]       = useState(1);
  const [footerRows, setFooter]   = useState(1);
  const [firstHeaderSep, setFH]   = useState(false);
  const [lastFooterSep, setLF]    = useState(false);
  const [repeatBody, setRepeat]   = useState(false);
  const [repeatVar, setRepeatVar] = useState('');

  // General table styles (apply to all sections by default)
  const [generalBorder, setGeneralBorder] = useState(DEFAULT_BORDER);
  const [tableRadius,   setTableRadius]   = useState(0);
  // 'none' | 'exterior' (4 outer corners only) | 'cells' (every cell rounded)
  // | 'custom' (per-corner outer toggle)
  const [cornerPreset,  setCornerPreset]  = useState('none');
  const [activeCorners, setActiveCorners] = useState({ tl: true, tr: true, br: true, bl: true });
  // When false (default), all sections inherit `generalBorder`. When true, the
  // user can configure each section independently.
  const [customizePerSection, setCustomizePerSection] = useState(false);
  function toggleCorner(c) {
    setActiveCorners(prev => ({ ...prev, [c]: !prev[c] }));
  }
  // Effective outer corners depend on the preset
  const effectiveCorners = cornerPreset === 'none'
    ? { tl: false, tr: false, br: false, bl: false }
    : cornerPreset === 'exterior' || cornerPreset === 'cells'
      ? { tl: true, tr: true, br: true, bl: true }
      : activeCorners;
  // Effective radius is 0 if preset is 'none' to make the input visually irrelevant
  const effectiveRadius = cornerPreset === 'none' ? 0 : tableRadius;
  // True when EVERY cell should be rounded (not just the table's outer corners)
  const cellCornersAll = cornerPreset === 'cells';

  const [headerBorder,      setHeaderBorder]      = useState(DEFAULT_BORDER);
  const [firstHeaderBorder, setFirstHeaderBorder] = useState(DEFAULT_BORDER);
  const [bodyBorder,        setBodyBorder]         = useState(DEFAULT_BORDER);
  const [footerBorder,      setFooterBorder]       = useState(DEFAULT_BORDER);
  const [lastFooterBorder,  setLastFooterBorder]   = useState(DEFAULT_BORDER);

  // While "personalizar" is OFF, sync all section borders with the general one
  useEffect(() => {
    if (customizePerSection) return;
    setHeaderBorder(generalBorder);
    setFirstHeaderBorder(generalBorder);
    setBodyBorder(generalBorder);
    setFooterBorder(generalBorder);
    setLastFooterBorder(generalBorder);
  }, [generalBorder, customizePerSection]);

  // When footer rows go from 0 → 1+, default border preset to 'all' for consistency
  const prevFooterRowsRef = useRef(footerRows);
  useEffect(() => {
    if (prevFooterRowsRef.current === 0 && footerRows > 0 && footerBorder.preset === 'none') {
      setFooterBorder({ ...DEFAULT_BORDER });
    }
    prevFooterRowsRef.current = footerRows;
  }, [footerRows, footerBorder.preset]);

  // When "last footer separate" turns on, default its border to 'all' too
  const prevLFRef = useRef(lastFooterSep);
  useEffect(() => {
    if (!prevLFRef.current && lastFooterSep && lastFooterBorder.preset === 'none') {
      setLastFooterBorder({ ...DEFAULT_BORDER });
    }
    prevLFRef.current = lastFooterSep;
  }, [lastFooterSep, lastFooterBorder.preset]);

  function handleOk() {
    onConfirm({
      cols, headerRows, bodyRows, footerRows,
      firstHeaderSeparate: firstHeaderSep,
      lastFooterSeparate:  lastFooterSep,
      repeatBody,
      repeatVar: repeatBody ? repeatVar : null,
      headerBorder,
      firstHeaderBorder: firstHeaderSep ? firstHeaderBorder : null,
      bodyBorder,
      footerBorder,
      lastFooterBorder:  lastFooterSep  ? lastFooterBorder  : null,
      tableRadius: effectiveRadius,
      tableCorners: effectiveCorners,
      cellCornersAll,
      // When rounded corners are active (and not in cells mode), the table root
      // needs a border to draw the curved outer perimeter (cells have straight
      // borders that get clipped at the curves). We use the general border
      // config for that outer ring.
      outerBorder: effectiveRadius > 0 && !cellCornersAll && generalBorder.preset !== 'none'
        ? generalBorder
        : null,
    });
  }

  const fieldPaths = availableFields.flatMap(f =>
    f.children?.length ? f.children.map(c => `${f.name}.${c.name}`) : [f.name]
  );

  const headerActive = headerRows > 0;
  const footerActive = footerRows > 0;

  // Portal to document.body. Must use z-index > 9999 because the
  // DocumentDesignerEditor overlay (.dde-overlay) sits at z-index 9999 — a
  // lower z-index would render the dialog behind the editor.
  return createPortal(
    <div className="itd__backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="itd__dialog">
        {/* ── Header ── */}
        <div className="itd__header">
          <span className="itd__header-icon"><Table2 size={16} /></span>
          <span className="itd__header-title">Insertar tabla</span>
          <button className="itd__header-close" onClick={onCancel} title="Cerrar">
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        <div className="itd__body">

          {/* Top: columns */}
          <div className="itd__top-row">
            <span className="itd__top-label">Columnas</span>
            <Spinner value={cols} min={1} max={20} onChange={setCols} />
          </div>

          {/* Two-column layout: config | preview */}
          <div className="itd__cols">
            <div className="itd__col-config">

              {/* ── ESTILOS GENERALES ── */}
              <Section icon={Table2} title="Estilos generales" color="#0ea5e9">
                <BorderRow label="Bordes"
                  config={generalBorder} onChange={setGeneralBorder} />
                <div className="itd__border-row">
                  <span className="itd__border-row-label">Esquinas</span>
                  <div className="itd__preset-group" role="radiogroup">
                    <button type="button"
                      className={`itd__preset-btn${cornerPreset === 'none' ? ' itd__preset-btn--active' : ''}`}
                      onClick={() => setCornerPreset('none')}
                      title="Sin esquinas redondeadas">
                      <Ban size={14} />
                    </button>
                    <button type="button"
                      className={`itd__preset-btn${cornerPreset === 'exterior' ? ' itd__preset-btn--active' : ''}`}
                      onClick={() => setCornerPreset('exterior')}
                      title="Esquinas externas (perímetro de la tabla)">
                      <Square size={14} style={{ borderRadius: 4 }} />
                    </button>
                    <button type="button"
                      className={`itd__preset-btn${cornerPreset === 'cells' ? ' itd__preset-btn--active' : ''}`}
                      onClick={() => setCornerPreset('cells')}
                      title="Todas las esquinas (cada celda redondeada)">
                      <LayoutDashboard size={14} />
                    </button>
                    <button type="button"
                      className={`itd__preset-btn${cornerPreset === 'custom' ? ' itd__preset-btn--active' : ''}`}
                      onClick={() => setCornerPreset('custom')}
                      title="Personalizar por esquina externa">
                      <Grid3X3 size={14} />
                    </button>
                  </div>
                  <input
                    type="number"
                    className="itd__border-width"
                    value={tableRadius}
                    min={0} max={30} step={0.5}
                    disabled={cornerPreset === 'none'}
                    onChange={e => setTableRadius(parseFloat(e.target.value) || 0)}
                    title="Radio (mm)"
                  />
                  <span className="itd__border-unit">mm</span>
                </div>
                {cornerPreset === 'custom' && (
                  <div className="itd__field-row">
                    <span className="itd__field-label">Esquinas activas</span>
                    <div className="itd__corners-grid">
                      <button type="button" className={`itd__corner-btn itd__corner-btn--tl${activeCorners.tl ? ' itd__corner-btn--active' : ''}`}
                        onClick={() => toggleCorner('tl')} title="Esquina superior izquierda" />
                      <button type="button" className={`itd__corner-btn itd__corner-btn--tr${activeCorners.tr ? ' itd__corner-btn--active' : ''}`}
                        onClick={() => toggleCorner('tr')} title="Esquina superior derecha" />
                      <button type="button" className={`itd__corner-btn itd__corner-btn--bl${activeCorners.bl ? ' itd__corner-btn--active' : ''}`}
                        onClick={() => toggleCorner('bl')} title="Esquina inferior izquierda" />
                      <button type="button" className={`itd__corner-btn itd__corner-btn--br${activeCorners.br ? ' itd__corner-btn--active' : ''}`}
                        onClick={() => toggleCorner('br')} title="Esquina inferior derecha" />
                    </div>
                  </div>
                )}
                <Toggle label="Personalizar bordes por sección"
                  checked={customizePerSection} onChange={setCustomizePerSection} />
              </Section>

              {/* ── CABECERA ── */}
              <Section icon={PanelTop} title="Cabecera" color="#3b82f6">
                <div className="itd__field-row">
                  <span className="itd__field-label">Filas</span>
                  <Spinner value={headerRows} min={0} max={10} onChange={setHeader} />
                </div>
                <Toggle label="Primera cabecera independiente"
                  checked={firstHeaderSep} onChange={setFH}
                  disabled={!headerActive} />
                {customizePerSection && firstHeaderSep && headerActive && (
                  <BorderRow label="1ª cabecera"
                    config={firstHeaderBorder} onChange={setFirstHeaderBorder} />
                )}
                {customizePerSection && (
                  <BorderRow label={firstHeaderSep ? 'Cabecera' : 'Bordes'}
                    config={headerBorder} onChange={setHeaderBorder}
                    disabled={!headerActive} />
                )}
              </Section>

              {/* ── CUERPO ── */}
              <Section
                icon={LayoutGrid}
                title="Cuerpo"
                color="#6b7280"
              >
                <div className="itd__field-row">
                  <span className="itd__field-label">Filas</span>
                  <Spinner value={bodyRows} min={1} max={50} onChange={setBody} />
                </div>
                <Toggle label="Repetir filas por variable"
                  checked={repeatBody} onChange={setRepeat} />
                {repeatBody && (
                  <div className="itd__field-row">
                    <span className="itd__field-label">
                      <span className="itd__var-badge">&#123;&#123;&#125;&#125;</span>
                      Variable
                    </span>
                    <select className="itd__select" value={repeatVar}
                      onChange={e => setRepeatVar(e.target.value)}>
                      <option value="">— seleccionar —</option>
                      {fieldPaths.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}
                {customizePerSection && (
                  <BorderRow config={bodyBorder} onChange={setBodyBorder} />
                )}
              </Section>

              {/* ── PIE DE PÁGINA ── */}
              <Section icon={PanelBottom} title="Pie de página" color="#f59e0b">
                <div className="itd__field-row">
                  <span className="itd__field-label">Filas</span>
                  <Spinner value={footerRows} min={0} max={10} onChange={setFooter} />
                </div>
                <Toggle label="Último pie independiente"
                  checked={lastFooterSep} onChange={setLF}
                  disabled={!footerActive} />
                {customizePerSection && (
                  <BorderRow label={lastFooterSep ? 'Pie' : 'Bordes'}
                    config={footerBorder} onChange={setFooterBorder}
                    disabled={!footerActive} />
                )}
                {customizePerSection && lastFooterSep && footerActive && (
                  <BorderRow label="Último pie"
                    config={lastFooterBorder} onChange={setLastFooterBorder} />
                )}
              </Section>
            </div>

            {/* ── PREVIEW ── */}
            <div className="itd__col-preview">
              <Preview
                cols={cols}
                headerRows={headerRows}
                bodyRows={bodyRows}
                footerRows={footerRows}
                firstHeaderSep={firstHeaderSep}
                lastFooterSep={lastFooterSep}
                repeatBody={repeatBody}
                headerBorder={headerBorder}
                firstHeaderBorder={firstHeaderBorder}
                bodyBorder={bodyBorder}
                footerBorder={footerBorder}
                lastFooterBorder={lastFooterBorder}
                generalBorder={generalBorder}
                tableRadius={effectiveRadius}
                tableCorners={effectiveCorners}
                cellCornersAll={cellCornersAll}
              />
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="itd__footer">
          <button className="itd__btn itd__btn--cancel" onClick={onCancel}>Cancelar</button>
          <button className="itd__btn itd__btn--ok" onClick={handleOk}>
            <Table2 size={14} /> Insertar tabla
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
