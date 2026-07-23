// editor/resources/tableStyle/TableStylePanel.jsx
// ContextPanel wrapper for editing a Table Style (panelContext = 'tableStyle:ID').

import TableStyleEditor from './TableStyleEditor.jsx';
import '../border/BorderStylePanel.css';   // reuse .bsp name-row styles

export default function TableStylePanel({ state }) {
  const {
    panelContext, template,
    updateTableStyle, updateTableStyleRegion,
    addBorderStyle, setPanelContext,
  } = state;
  const styleId = panelContext?.slice('tableStyle:'.length);
  const style = (template?.styles?.table ?? []).find(s => s.id === styleId) ?? null;

  if (!style) return <p className="bsp__empty" style={{ padding: 12 }}>Table style no encontrado.</p>;

  // Slot "create new border style": make a blank border style, assign it to the
  // slot (or the outer table border), then open it in the resources editor.
  function handleCreateBorderStyleForSlot(regionKey, slotKey) {
    const id = addBorderStyle?.();
    if (!id) return;
    if (regionKey === '__tableBorder') {
      updateTableStyle?.(styleId, { tableBorderStyleRef: id });
    } else {
      updateTableStyleRegion?.(styleId, regionKey, { [slotKey]: id });
    }
    setPanelContext?.(`borderStyle:${id}`);
  }

  return (
    <div className="bsp">
      <div className="bsp__name-row">
        <label className="bsp__name-label">Nombre</label>
        <input
          className="bsp__name-input"
          value={style.name ?? ''}
          onChange={e => updateTableStyle?.(styleId, { name: e.target.value })}
          placeholder="Nombre del table style"
        />
      </div>
      <TableStyleEditor
        style={style}
        borderStyles={template?.styles?.border ?? []}
        fillStyles={template?.styles?.fill ?? []}
        colors={template?.colors ?? []}
        onChange={changes => updateTableStyle?.(styleId, changes)}
        onChangeRegion={(regionKey, slotChanges) => updateTableStyleRegion?.(styleId, regionKey, slotChanges)}
        onCreateBorderStyleForSlot={handleCreateBorderStyleForSlot}
      />
    </div>
  );
}
