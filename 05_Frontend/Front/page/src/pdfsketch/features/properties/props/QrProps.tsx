import { useDocumentStore } from '@/store/documentStore';
import type { BarcodeType, QrEl } from '@/types/document';
import { SectionTitle, Row, TextInput, SelectInput, NumberInput } from '../shared';

interface Props {
  el: QrEl;
}

interface TypeOption {
  value: BarcodeType;
  label: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  { value: 'QR',      label: 'QR Code' },
  { value: 'EAN13',   label: 'EAN-13' },
  { value: 'EAN8',    label: 'EAN-8' },
  { value: 'CODE128', label: 'EAN-128 / Code 128' },
  { value: 'CODE39',  label: 'Code 39' },
  { value: 'ITF14',   label: 'ITF-14' },
  { value: 'UPC',     label: 'UPC-A' },
];

const ERROR_LEVELS: { value: QrEl['errorLevel']; label: string }[] = [
  { value: 'L', label: 'L — Bajo (7%)' },
  { value: 'M', label: 'M — Medio (15%)' },
  { value: 'Q', label: 'Q — Cuartil (25%)' },
  { value: 'H', label: 'H — Alto (30%)' },
];

export default function QrProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<QrEl>) => updateElement(el.id, patch);
  const isQr = el.barcodeType === 'QR';

  return (
    <>
      <SectionTitle>Código de barras / QR</SectionTitle>

      <Row label="Tipo">
        <SelectInput<BarcodeType>
          value={el.barcodeType}
          onChange={(v) => up({ barcodeType: v })}
          options={TYPE_OPTIONS}
        />
      </Row>

      <Row label="Datos">
        <TextInput
          value={el.data}
          onChange={(v) => up({ data: v })}
          placeholder="Valor estático…"
        />
      </Row>

      <Row label="Variable">
        <TextInput
          value={el.variable ?? ''}
          onChange={(v) => up({ variable: v || undefined })}
          placeholder="(ninguna)"
        />
      </Row>

      {isQr && (
        <Row label="Corrección">
          <SelectInput
            value={el.errorLevel}
            onChange={(v) => up({ errorLevel: v })}
            options={ERROR_LEVELS}
          />
        </Row>
      )}

      {!isQr && (
        <Row label="Texto">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={el.showText}
              onChange={(e) => up({ showText: e.target.checked })}
              className="accent-[color:var(--accent)]"
            />
            <span className="text-[11px]" style={{ color: 'var(--ink-2)' }}>Mostrar dígitos</span>
          </label>
        </Row>
      )}

      {isQr && (
        <Row label="Módulo">
          <NumberInput
            value={el.moduleSize}
            onChange={(v) => up({ moduleSize: v })}
            min={0.1}
            step={0.1}
            unit="mm"
          />
        </Row>
      )}

      <div className="mt-1 text-[10px]" style={{ color: 'var(--ink-3)' }}>
        {isQr ? 'Cuadrado — el tamaño se ajusta al lado más corto.' : 'Rectángulo — ajusta ancho y alto libremente.'}
      </div>
    </>
  );
}
