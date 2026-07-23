// editor/resources/tableStyle/TableStyleEditor.jsx
// Table Style editor: tabs General / Header / Body / Footer.
// Each "slot" picks a border style (which carries lines + fill — Model B), so
// the whole chain stays atado: tableStyle → borderStyle → fill → color.

import { useState } from 'react';
import BorderStyleSelect from '../border/BorderStyleSelect.jsx';
import './TableStyleEditor.css';

const TABS = ['General', 'Header', 'Body', 'Footer'];

// One labeled fieldset: a region's column slots, revealed by the General flags.
function RegionBlock({ title, regionKey, region, flags, borderStyles, fillStyles, colors, onSlot, onCreateBorderStyle }) {
  const slot = (key, label) => (
    <div className="tse-slot" key={key}>
      <label className="tse-slot__label">{label}</label>
      <BorderStyleSelect
        value={region?.[key] ?? null}
        borderStyles={borderStyles}
        fillStyles={fillStyles}
        colors={colors}
        onChange={id => onSlot(regionKey, { [key]: id })}
        onCreateNew={() => onCreateBorderStyle(regionKey, key)}
      />
    </div>
  );
  return (
    <fieldset className="tse-region">
      <legend className="tse-region__title">{title}</legend>
      {slot('columns', 'Columnas')}
      {flags.useDifferentFirstColumns && slot('firstColumn', 'Primera columna')}
      {flags.useDifferentOddEvenColumns && slot('oddColumn', 'Columna impar')}
      {flags.useDifferentOddEvenColumns && slot('evenColumn', 'Columna par')}
      {flags.useDifferentLastColumns && !flags.useDifferentOddEvenColumns && slot('lastColumn', 'Última columna')}
      {flags.useDifferentLastColumns && flags.useDifferentOddEvenColumns && slot('lastOddColumn', 'Última col. impar')}
      {flags.useDifferentLastColumns && flags.useDifferentOddEvenColumns && slot('lastEvenColumn', 'Última col. par')}
    </fieldset>
  );
}

export default function TableStyleEditor({
  style, borderStyles = [], fillStyles = [], colors = [],
  onChange, onChangeRegion, onCreateBorderStyleForSlot,
}) {
  const [tab, setTab] = useState('General');
  if (!style) return null;
  const flags = {
    useDifferentFirstColumns: !!style.useDifferentFirstColumns,
    useDifferentLastColumns: !!style.useDifferentLastColumns,
    useDifferentOddEvenColumns: !!style.useDifferentOddEvenColumns,
  };
  const regionProps = { flags, borderStyles, fillStyles, colors, onSlot: onChangeRegion, onCreateBorderStyle: onCreateBorderStyleForSlot };

  return (
    <div className="tse">
      <div className="tse-tabs">
        {TABS.map(t => (
          <button key={t} className={`tse-tab${tab === t ? ' tse-tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <div className="tse-body">
        {tab === 'General' && (
          <>
            <div className="tse-slot">
              <label className="tse-slot__label">Borde de tabla (exterior)</label>
              <BorderStyleSelect
                value={style.tableBorderStyleRef ?? null}
                borderStyles={borderStyles} fillStyles={fillStyles} colors={colors}
                onChange={id => onChange({ tableBorderStyleRef: id })}
                onCreateNew={() => onCreateBorderStyleForSlot('__tableBorder', null)}
              />
            </div>
            <div className="tse-flags">
              <label className="tse-flag">
                <input type="checkbox" checked={flags.useDifferentFirstColumns}
                  onChange={e => onChange({ useDifferentFirstColumns: e.target.checked })} />
                <span>Usar primera columna distinta</span>
              </label>
              <label className="tse-flag">
                <input type="checkbox" checked={flags.useDifferentLastColumns}
                  onChange={e => onChange({ useDifferentLastColumns: e.target.checked })} />
                <span>Usar última columna distinta</span>
              </label>
              <label className="tse-flag">
                <input type="checkbox" checked={flags.useDifferentOddEvenColumns}
                  onChange={e => onChange({ useDifferentOddEvenColumns: e.target.checked })} />
                <span>Usar columnas impar/par distintas</span>
              </label>
            </div>
          </>
        )}

        {tab === 'Header' && (
          <>
            <RegionBlock title="Primera fila de encabezado" regionKey="firstHeader" region={style.regions?.firstHeader} {...regionProps} />
            <RegionBlock title="Fila de encabezado" regionKey="header" region={style.regions?.header} {...regionProps} />
          </>
        )}

        {tab === 'Body' && (
          <>
            <RegionBlock title="Fila impar del cuerpo" regionKey="oddBody" region={style.regions?.oddBody} {...regionProps} />
            <RegionBlock title="Fila par del cuerpo" regionKey="evenBody" region={style.regions?.evenBody} {...regionProps} />
          </>
        )}

        {tab === 'Footer' && (
          <>
            <RegionBlock title="Fila de pie" regionKey="footer" region={style.regions?.footer} {...regionProps} />
            <RegionBlock title="Última fila de pie" regionKey="lastFooter" region={style.regions?.lastFooter} {...regionProps} />
          </>
        )}
      </div>
    </div>
  );
}
