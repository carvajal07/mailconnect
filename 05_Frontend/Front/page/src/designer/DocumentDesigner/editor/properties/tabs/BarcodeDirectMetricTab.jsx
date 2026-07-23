// BarcodeDirectMetricTab.jsx — Tab "Métrica directa".
// Permite definir el ancho EXACTO (mm) de cada tipo de barra y de cada tipo de
// espacio, en vez de derivarlos de moduleWidth + ratio. Equivale al "Direct Metric".
// El preview con bwip-js NO refleja estos anchos (bwip deriva todo de
// scale); pero los valores viajan en el JSON y el motor del back los aplica.

import { getSymbology, directMetricBars } from '../../../engine/barcodeSymbologies.js';
import { NumberField, BoolField } from './barcodeFields.jsx';

// Asegura que el array tenga `n` elementos (rellena con `fill` por defecto).
function ensureLen(arr, n, fill = 0.19) {
  const out = Array.isArray(arr) ? arr.slice(0, n) : [];
  while (out.length < n) out.push(fill);
  return out;
}

export default function BarcodeDirectMetricTab({ element, onUpdate }) {
  const sym = getSymbology(element.symbology);
  const n   = directMetricBars(element.symbology);
  const dm  = element.directMetric ?? { enabled: false, barWidths: [], barSpaces: [] };

  const setDM = (ch) => onUpdate({ directMetric: { ...dm, ...ch } });

  const barWidths = ensureLen(dm.barWidths, n);
  const barSpaces = ensureLen(dm.barSpaces, n);

  const setBarWidth = (i, v) => {
    const next = barWidths.slice(); next[i] = v; setDM({ barWidths: next });
  };
  const setBarSpace = (i, v) => {
    const next = barSpaces.slice(); next[i] = v; setDM({ barSpaces: next });
  };

  if (!n) {
    return (
      <p className="pp-field__hint" style={{ marginTop: 6 }}>
        {sym.label} no admite métrica directa.
      </p>
    );
  }

  return (
    <>
      <div className="pp-section-title">Métrica directa</div>
      <BoolField
        label="Usar anchos explícitos"
        checked={!!dm.enabled}
        hint="Define el ancho exacto de cada barra y espacio en mm. Anula el ancho de módulo. (No se refleja en la previsualización; se aplica al generar el código.)"
        onChange={c => setDM({ enabled: c })}
      />

      {dm.enabled && (
        <>
          <div className="pp-section-title" style={{ marginTop: 8 }}>Anchos de barra (mm)</div>
          {barWidths.map((w, i) => (
            <NumberField key={`bw${i}`} label={`Barra ${i + 1}`} unit="mm" value={w} min={0} step={0.01}
              onChange={v => setBarWidth(i, v)} />
          ))}

          <div className="pp-section-title" style={{ marginTop: 8 }}>Anchos de espacio (mm)</div>
          {barSpaces.map((w, i) => (
            <NumberField key={`bs${i}`} label={`Espacio ${i + 1}`} unit="mm" value={w} min={0} step={0.01}
              onChange={v => setBarSpace(i, v)} />
          ))}
        </>
      )}
    </>
  );
}
