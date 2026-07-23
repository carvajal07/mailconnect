// CellPropertiesPanel.jsx — Properties form for one cell (or bulk for many).
// Used both inline in ElementPanel (when navigating from the tree) and inside
// CellPropertiesModal (when right-clicking on a cell in the canvas).

import BorderTab from '../tabs/BorderTab.jsx';
import CellAlignmentGrid from '../../toolbar/CellAlignmentGrid.jsx';

const DEFAULT_CELL = {
  flow: { content: '' }, vAlign: 'top', hAlign: null, spanLeft: false, spanUp: false,
  heightType: 'custom', minHeight: 0, maxHeight: 300000,
  htmlWidth: 'auto', flowToNextPage: false, alwaysProcess: false, fillRelativeToCell: false,
};

export { DEFAULT_CELL };

export default function CellPropertiesPanel({
  cell,             // current values (a single cell object)
  colLabel,         // header label shown above (optional)
  onUpdate,         // (changes) => void — applied to the underlying cell(s)
  state,
  onBack,           // optional back arrow
  showHeader = true,
}) {
  const c = { ...DEFAULT_CELL, ...(cell ?? {}) };
  const borderStyles = state?.template?.styles?.border ?? [];

  function upd(changes) { onUpdate?.(changes); }

  return (
    <div className="ep__rowset-panel">
      {showHeader && (
        <div className="ep__rowset-header">
          {onBack && (
            <button className="ep__rowset-back" onClick={onBack}>← Volver</button>
          )}
          <span className="ep__rowset-name" style={{ fontWeight: 700 }}>
            {colLabel ?? 'Cell'} — Propiedades
          </span>
        </div>
      )}

      <div className="pp__body">
        {/* Cell alignment (Word-style 3×3 grid: vertical × horizontal) */}
        <div className="pp-field">
          <label className="pp-field__label">Alineación</label>
          <CellAlignmentGrid
            value={{ vAlign: c.vAlign ?? 'top', hAlign: c.hAlign ?? null }}
            mixed={false}
            size="md"
            onChange={({ vAlign, hAlign }) => upd({ vAlign, hAlign })}
          />
        </div>

        {/* Height type */}
        <div className="pp-field">
          <label className="pp-field__label">Type</label>
          <select className="pp-field__select" value={c.heightType ?? 'custom'} onChange={e => upd({ heightType: e.target.value })}>
            <option value="custom">Custom</option>
            <option value="fixed">Fixed</option>
            <option value="auto">Auto</option>
          </select>
        </div>

        {/* Min / Max height */}
        <div className="pp-row pp-row--mb">
          <div className="pp-field">
            <label className="pp-field__label">Min height (mm)</label>
            <input type="number" className="pp-field__input" value={c.minHeight ?? 0} onChange={e => upd({ minHeight: +e.target.value })} />
          </div>
          <div className="pp-field">
            <label className="pp-field__label">Max height (mm)</label>
            <input type="number" className="pp-field__input" value={c.maxHeight ?? 300000} onChange={e => upd({ maxHeight: +e.target.value })} />
          </div>
        </div>

        {/* HTML width */}
        <div className="pp-field">
          <label className="pp-field__label">HTML width</label>
          <select className="pp-field__select" value={c.htmlWidth ?? 'auto'} onChange={e => upd({ htmlWidth: e.target.value })}>
            <option value="auto">Auto</option>
            <option value="fixed">Fixed</option>
          </select>
        </div>

        <div className="pp-section-title">Propiedades</div>

        <div className="pp-toggle-row">
          <label className="pp-toggle-row__label">Span left</label>
          <input type="checkbox" checked={!!c.spanLeft} onChange={e => upd({ spanLeft: e.target.checked })} />
        </div>
        <div className="pp-toggle-row">
          <label className="pp-toggle-row__label">Span up</label>
          <input type="checkbox" checked={!!c.spanUp} onChange={e => upd({ spanUp: e.target.checked })} />
        </div>
        <div className="pp-toggle-row">
          <label className="pp-toggle-row__label">Flow to next page</label>
          <input type="checkbox" checked={!!c.flowToNextPage} onChange={e => upd({ flowToNextPage: e.target.checked })} />
        </div>
        <div className="pp-toggle-row">
          <label className="pp-toggle-row__label">Always process</label>
          <input type="checkbox" checked={!!c.alwaysProcess} onChange={e => upd({ alwaysProcess: e.target.checked })} />
        </div>
        <div className="pp-toggle-row">
          <label className="pp-toggle-row__label">Fill relative to cell</label>
          <input type="checkbox" checked={!!c.fillRelativeToCell} onChange={e => upd({ fillRelativeToCell: e.target.checked })} />
        </div>

        <div className="pp-section-title">Border</div>
        <BorderTab
          element={c}
          onUpdate={upd}
          borderStyles={borderStyles}
          addBorderStyle={state?.addBorderStyle}
          onNavigateToStyle={id => state?.setPanelContext?.('borderStyle:' + id)}
          alwaysShowPadding
        />
      </div>
    </div>
  );
}
