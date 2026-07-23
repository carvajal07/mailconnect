import { useState } from 'react';
import type { TableEl, TableCell, TableColumn } from '@/types/document';
import { nextId } from '@/utils/id';

interface Props {
  posMm: { x: number; y: number };
  zIndex: number;
  onConfirm: (el: TableEl) => void;
  onCancel: () => void;
}

function buildRows(
  cols: number,
  rows: number,
  hasHeader: boolean,
  hasFooter: boolean,
  headerLabels: string[],
): TableCell[][] {
  const result: TableCell[][] = [];

  if (hasHeader) {
    result.push(
      Array.from({ length: cols }, (_, ci) => ({
        text: headerLabels[ci] ?? `Col ${ci + 1}`,
        align: 'center' as const,
      })),
    );
  }

  const dataRows = rows - (hasHeader ? 1 : 0) - (hasFooter ? 1 : 0);
  for (let ri = 0; ri < Math.max(1, dataRows); ri++) {
    result.push(
      Array.from({ length: cols }, (_, ci) => ({
        text: `Dato ${ri + 1}-${ci + 1}`,
        align: 'left' as const,
      })),
    );
  }

  if (hasFooter) {
    result.push(
      Array.from({ length: cols }, (_, ci) => ({
        text: ci === 0 ? 'Total' : '',
        align: ci === 0 ? ('left' as const) : ('right' as const),
      })),
    );
  }

  return result;
}

export default function TableCreateDialog({ posMm, zIndex, onConfirm, onCancel }: Props) {
  const [cols, setCols] = useState(3);
  const [rows, setRows] = useState(4);
  const [hasHeader, setHasHeader] = useState(true);
  const [hasFooter, setHasFooter] = useState(false);
  const [alternateRows, setAlternateRows] = useState(true);
  const [repeatBy, setRepeatBy] = useState('');
  const [headerLabels, setHeaderLabels] = useState<string[]>(['Columna 1', 'Columna 2', 'Columna 3']);

  function syncHeaderLabels(n: number) {
    setHeaderLabels((prev) => {
      const next = [...prev];
      while (next.length < n) next.push(`Columna ${next.length + 1}`);
      return next.slice(0, n);
    });
  }

  function handleColsChange(n: number) {
    const v = Math.max(1, Math.min(20, n));
    setCols(v);
    syncHeaderLabels(v);
  }

  function handleConfirm() {
    const columns: TableColumn[] = Array.from({ length: cols }, () => ({
      widthPercent: 100 / cols,
      minWidth: 10,
    }));

    const builtRows = buildRows(cols, rows, hasHeader, hasFooter, headerLabels);

    const el: TableEl = {
      id: nextId('el'),
      name: 'tabla1',
      type: 'table',
      x: posMm.x,
      y: posMm.y,
      width: Math.max(cols * 20, 60),
      height: Math.max(builtRows.length * 8, 30),
      rotation: 0,
      visible: true,
      locked: false,
      zIndex,
      columns,
      rows: builtRows,
      borderWidth: 0.25,
      borderColor: '#444444',
      cellSpacing: 1,
      hasHeader,
      hasFooter,
      headerBackground: '#1e3a5f',
      footerBackground: '#2d4a6e',
      alternateRows,
      alternateBackground: '#f0f4f8',
      repeatBy: repeatBy.trim() || undefined,
      rowFontSize: 9,
    };

    onConfirm(el);
  }

  const totalRows = rows;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="rounded-lg shadow-xl flex flex-col gap-4 p-5 w-[420px] max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line-1)' }}
      >
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-1)' }}>
          Insertar tabla
        </h2>

        {/* Dimensiones */}
        <section className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider pb-1 border-b" style={{ color: 'var(--ink-2)', borderColor: 'var(--line-2)' }}>
            Dimensiones
          </div>
          <div className="flex gap-3">
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px]" style={{ color: 'var(--ink-2)' }}>Columnas</label>
              <input
                type="number"
                min={1}
                max={20}
                value={cols}
                onChange={(e) => handleColsChange(Number(e.target.value))}
                className="h-[28px] rounded-md px-2.5 text-[12px] font-mono outline-none text-center"
                style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-1)' }}
              />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-[10px]" style={{ color: 'var(--ink-2)' }}>Filas totales</label>
              <input
                type="number"
                min={1}
                max={200}
                value={rows}
                onChange={(e) => setRows(Math.max(1, Number(e.target.value)))}
                className="h-[28px] rounded-md px-2.5 text-[12px] font-mono outline-none text-center"
                style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-1)' }}
              />
            </div>
          </div>
        </section>

        {/* Estructura */}
        <section className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider pb-1 border-b" style={{ color: 'var(--ink-2)', borderColor: 'var(--line-2)' }}>
            Estructura
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            <span className="text-[12px]" style={{ color: 'var(--ink-1)' }}>Fila de encabezado</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hasFooter}
              onChange={(e) => setHasFooter(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            <span className="text-[12px]" style={{ color: 'var(--ink-1)' }}>Fila de pie de tabla</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alternateRows}
              onChange={(e) => setAlternateRows(e.target.checked)}
              className="accent-[color:var(--accent)]"
            />
            <span className="text-[12px]" style={{ color: 'var(--ink-1)' }}>Filas alternas (zebra)</span>
          </label>
        </section>

        {/* Etiquetas de encabezado */}
        {hasHeader && (
          <section className="flex flex-col gap-2">
            <div className="text-[10px] uppercase tracking-wider pb-1 border-b" style={{ color: 'var(--ink-2)', borderColor: 'var(--line-2)' }}>
              Etiquetas de encabezado
            </div>
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: cols }, (_, ci) => (
                <div key={ci} className="flex items-center gap-2">
                  <span className="text-[10px] w-12 text-right shrink-0" style={{ color: 'var(--ink-2)' }}>
                    Col {ci + 1}
                  </span>
                  <input
                    type="text"
                    value={headerLabels[ci] ?? ''}
                    onChange={(e) => {
                      const next = [...headerLabels];
                      next[ci] = e.target.value;
                      setHeaderLabels(next);
                    }}
                    className="h-[24px] flex-1 rounded-md px-2 text-[11px] font-mono outline-none"
                    style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-1)' }}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Repetición por variable */}
        <section className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wider pb-1 border-b" style={{ color: 'var(--ink-2)', borderColor: 'var(--line-2)' }}>
            Repetir filas por array / variable
          </div>
          <input
            type="text"
            value={repeatBy}
            onChange={(e) => setRepeatBy(e.target.value)}
            placeholder="p.ej. pedido.lineas (dejar vacío si no aplica)"
            className="h-[28px] rounded-md px-2.5 text-[11px] font-mono outline-none"
            style={{ background: 'var(--bg-3)', border: '1px solid var(--line-2)', color: 'var(--ink-1)' }}
          />
          <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
            Ruta JSON del array que generará una fila por elemento en el PDF final.
          </span>
        </section>

        {/* Resumen */}
        <div
          className="rounded-md px-3 py-2 text-[11px]"
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', color: 'var(--ink-2)' }}
        >
          Resultado: <strong style={{ color: 'var(--ink-1)' }}>{cols} columnas × {totalRows} filas</strong>
          {hasHeader && ' · encabezado'}
          {hasFooter && ' · pie'}
          {alternateRows && ' · zebra'}
          {repeatBy.trim() && ` · repite por "${repeatBy.trim()}"`}
        </div>

        {/* Acciones */}
        <div className="flex justify-end gap-2">
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
            Insertar tabla
          </button>
        </div>
      </div>
    </div>
  );
}
