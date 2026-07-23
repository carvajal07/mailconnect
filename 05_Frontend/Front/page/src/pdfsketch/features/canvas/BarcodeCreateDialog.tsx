import { useState } from 'react';
import type { BarcodeType, QrEl } from '@/types/document';
import { nextId } from '@/utils/id';

interface Props {
  posMm: { x: number; y: number };
  zIndex: number;
  onConfirm: (el: QrEl) => void;
  onCancel: () => void;
}

interface BarcodeOption {
  type: BarcodeType;
  label: string;
  description: string;
  example: string;
  defaultW: number;
  defaultH: number;
}

const OPTIONS: BarcodeOption[] = [
  { type: 'QR',      label: 'QR Code',          description: 'Matriz 2D, escaneable desde cualquier ángulo',          example: 'https://ejemplo.com',  defaultW: 30, defaultH: 30 },
  { type: 'EAN13',   label: 'EAN-13',            description: 'Estándar europeo de 13 dígitos (productos)',            example: '5901234123457',        defaultW: 50, defaultH: 20 },
  { type: 'EAN8',    label: 'EAN-8',             description: 'Versión compacta de 8 dígitos para artículos pequeños', example: '96385074',             defaultW: 35, defaultH: 20 },
  { type: 'CODE128', label: 'EAN-128 / Code 128', description: 'Alfanumérico de alta densidad, logística y comercio',  example: '1234567890',           defaultW: 60, defaultH: 20 },
  { type: 'CODE39',  label: 'Code 39',           description: 'Alfanumérico simple, industria y automoción',           example: 'CODE39',               defaultW: 60, defaultH: 20 },
  { type: 'ITF14',   label: 'ITF-14',            description: '14 dígitos para cajas y embalaje (GTIN-14)',            example: '12345678901231',       defaultW: 60, defaultH: 20 },
  { type: 'UPC',     label: 'UPC-A',             description: '12 dígitos, estándar norteamericano de productos',      example: '012345678905',         defaultW: 50, defaultH: 20 },
];

export default function BarcodeCreateDialog({ posMm, zIndex, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<BarcodeType>('QR');
  const [data, setData] = useState('');

  const opt = OPTIONS.find((o) => o.type === selected)!;

  function handleConfirm() {
    const el: QrEl = {
      id: nextId('el'),
      name: `${selected.toLowerCase()}1`,
      type: 'qr',
      barcodeType: selected,
      x: posMm.x,
      y: posMm.y,
      width: opt.defaultW,
      height: opt.defaultH,
      rotation: 0,
      visible: true,
      locked: false,
      zIndex,
      data: data.trim(),
      variable: undefined,
      errorLevel: 'M',
      moduleSize: 1,
      showText: selected !== 'QR',
    };
    onConfirm(el);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="rounded-lg shadow-xl flex flex-col gap-3 p-5 w-[480px] max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-1)' }}>
          Insertar código de barras / QR
        </h2>

        {/* Selector de tipo */}
        <div className="flex flex-col gap-1.5">
          {OPTIONS.map((o) => (
            <button
              key={o.type}
              type="button"
              onClick={() => setSelected(o.type)}
              className="text-left rounded-md px-3 py-2 flex items-start gap-3 transition-colors"
              style={
                selected === o.type
                  ? { background: 'var(--accent-soft)', border: '1px solid var(--accent-dim)', color: 'var(--ink-1)' }
                  : { background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }
              }
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-semibold leading-tight" style={{ color: selected === o.type ? 'var(--accent)' : 'var(--ink-1)' }}>
                  {o.label}
                </span>
                <span className="text-[10px] leading-snug mt-0.5" style={{ color: 'var(--ink-2)' }}>
                  {o.description}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* Dato inicial */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-2)' }}>
            Datos iniciales
          </label>
          <input
            type="text"
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder={opt.example}
            className="h-[28px] rounded-md px-2.5 text-[12px] font-mono outline-none"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-1)' }}
          />
          <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
            Ejemplo: {opt.example} — también puedes asignarlo desde el panel de propiedades.
          </span>
        </div>

        {/* Acciones */}
        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onCancel}
            className="h-[28px] px-4 rounded-md text-[12px]"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="h-[28px] px-4 rounded-md text-[12px] font-medium"
            style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }}
          >
            Insertar
          </button>
        </div>
      </div>
    </div>
  );
}
