// BarcodeAdvancedTab.jsx — Tab "Avanzado" del código de barras.
// Muestra las opciones avanzadas propias del tipo (sym.advancedFields → OPTION_DEFS):
// correcciones de ancho de barra, codificación de datos, ECI, tamaño de símbolo…
// Todas con su `hint`. Solo se monta si el tipo tiene advancedFields.

import { getSymbology } from '../../../engine/barcodeSymbologies.js';
import { OptionFields } from './barcodeFields.jsx';

export default function BarcodeAdvancedTab({ element, onUpdate }) {
  const sym     = getSymbology(element.symbology);
  const options = element.options ?? {};
  const setOptions = (ch) => onUpdate({ options: { ...options, ...ch } });

  const fields = sym.advancedFields ?? [];

  return (
    <>
      <div className="pp-section-title">Opciones avanzadas</div>
      {fields.length === 0 ? (
        <p className="pp-field__hint" style={{ marginTop: 6 }}>
          Esta simbología no tiene opciones avanzadas.
        </p>
      ) : (
        <OptionFields keys={fields} options={options} onSetOptions={setOptions} />
      )}
    </>
  );
}
