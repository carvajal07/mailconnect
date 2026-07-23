// BarcodeTextAlignTab.jsx — Tab "Texto y alineación" del código de barras.
// Alineación del código + posición/estilo del texto de datos (equivalente al
// "Text and Align").

const TEXT_POSITIONS = [
  ['none', 'Ninguno'],
  ['top-left', 'Arriba izquierda'],
  ['top-center', 'Arriba centro'],
  ['top-right', 'Arriba derecha'],
  ['bottom-left', 'Abajo izquierda'],
  ['bottom-center', 'Abajo centro'],
  ['bottom-right', 'Abajo derecha'],
];
const H_ALIGN = [['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']];
const V_ALIGN = [['top', 'Arriba'], ['center', 'Centro'], ['bottom', 'Abajo']];

export default function BarcodeTextAlignTab({ element, onUpdate, state }) {
  const align = element.align ?? {};
  const text  = element.text ?? {};
  const textStyles = state?.template?.styles?.text ?? [];

  const setAlign = (ch) => onUpdate({ align: { ...align, ...ch } });
  const setText  = (ch) => onUpdate({ text: { ...text, ...ch } });

  const showText = (text.position ?? 'none') !== 'none';

  return (
    <>
      <div className="pp-section-title">Alineación del código</div>
      <div className="pp-field">
        <label className="pp-field__label">Horizontal</label>
        <select className="pp-field__select" value={align.horizontal ?? 'left'} onChange={e => setAlign({ horizontal: e.target.value })}>
          {H_ALIGN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="pp-field">
        <label className="pp-field__label">Vertical</label>
        <select className="pp-field__select" value={align.vertical ?? 'top'} onChange={e => setAlign({ vertical: e.target.value })}>
          {V_ALIGN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="pp-section-title">Texto de datos</div>
      <div className="pp-field">
        <label className="pp-field__label">Posición</label>
        <select className="pp-field__select" value={text.position ?? 'none'} onChange={e => setText({ position: e.target.value })}>
          {TEXT_POSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {showText && (
        <>
          <div className="pp-row">
            <div className="pp-field">
              <label className="pp-field__label">Delta X (mm)</label>
              <input type="number" className="pp-field__input" step={0.1} value={text.deltaX ?? 0}
                onChange={e => setText({ deltaX: parseFloat(e.target.value) || 0 })} />
            </div>
            <div className="pp-field">
              <label className="pp-field__label">Delta Y (mm)</label>
              <input type="number" className="pp-field__input" step={0.1} value={text.deltaY ?? 0}
                onChange={e => setText({ deltaY: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>

          <div className="pp-field">
            <label className="pp-field__label">Estilo de texto</label>
            <select
              className="pp-field__select"
              value={text.textStyleId ?? ''}
              onChange={e => {
                const v = e.target.value;
                if (v === '__new__') {
                  const id = state?.addTextStyle?.();
                  if (id) { setText({ textStyleId: id }); state?.setPanelContext?.('textStyle:' + id); }
                  return;
                }
                setText({ textStyleId: v || null });
              }}
            >
              <option value="">— Por defecto —</option>
              {textStyles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option disabled>──────────────</option>
              <option value="__new__">+ Crear nuevo estilo de texto…</option>
            </select>
          </div>

          <div className="pp-field">
            <label className="pp-toggle-row">
              <input type="checkbox" checked={!!text.showProcessedData}
                onChange={e => setText({ showProcessedData: e.target.checked })} />
              <span>Mostrar dato procesado</span>
            </label>
            <p className="pp-field__hint">
              Muestra el dato tal como queda codificado (con dígito de control, prefijos, etc.) en vez del valor que escribiste.
            </p>
          </div>
          <div className="pp-field">
            <label className="pp-toggle-row">
              <input type="checkbox" checked={!!text.includeInBoundingBox}
                onChange={e => setText({ includeInBoundingBox: e.target.checked })} />
              <span>Incluir texto en el bounding box</span>
            </label>
            <p className="pp-field__hint">
              Cuenta el texto dentro del área del objeto (afecta el cálculo de runaround / ajuste de contorno). Si está desactivado, el texto puede sobresalir del recuadro.
            </p>
          </div>
        </>
      )}
    </>
  );
}
