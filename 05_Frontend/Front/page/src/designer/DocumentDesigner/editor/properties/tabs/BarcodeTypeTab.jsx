// BarcodeTypeTab.jsx — Tab DINÁMICO por simbología.
// Renderiza moduleWidth/height/quietZone (comunes) + las opciones PRINCIPALES del
// tipo (sym.optionFields → OPTION_DEFS). Las opciones avanzadas viven en el tab
// "Avanzado"; los anchos explícitos en el tab "Métrica directa".

import { getSymbology, is2D } from '../../../engine/barcodeSymbologies.js';
import { NumberField, OptionFields } from './barcodeFields.jsx';

export default function BarcodeTypeTab({ element, onUpdate }) {
  const sym     = getSymbology(element.symbology);
  const metrics = element.metrics ?? {};
  const options = element.options ?? {};
  const twoD    = is2D(element.symbology);

  const setMetrics = (ch) => onUpdate({ metrics: { ...metrics, ...ch } });
  const setOptions = (ch) => onUpdate({ options: { ...options, ...ch } });

  const mainFields = sym.optionFields ?? [];

  return (
    <>
      <div className="pp-section-title">{sym.label}</div>

      <NumberField label="Ancho de módulo" unit="mm" value={metrics.moduleWidth} min={0.1} step={0.01}
        hint={twoD ? 'Tamaño del lado de cada celda del código.' : 'Ancho de la barra más angosta.'}
        onChange={v => setMetrics({ moduleWidth: v })} />
      {!twoD && (
        <NumberField label="Alto" unit="mm" value={metrics.height} min={1} step={0.5}
          hint="Altura de las barras." onChange={v => setMetrics({ height: v })} />
      )}
      <NumberField label="Quiet zone" unit="módulos" value={metrics.quietZone} min={0} step={1}
        hint="Margen en blanco alrededor del código (en módulos), necesario para que los lectores lo detecten."
        onChange={v => setMetrics({ quietZone: v })} />

      <OptionFields keys={mainFields} options={options} onSetOptions={setOptions} />

      {mainFields.length === 0 && (
        <p className="pp-field__hint" style={{ marginTop: 6 }}>
          Esta simbología no tiene opciones específicas.
        </p>
      )}
    </>
  );
}
