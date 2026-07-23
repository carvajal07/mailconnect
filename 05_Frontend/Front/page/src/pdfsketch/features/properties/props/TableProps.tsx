import { useDocumentStore } from '@/store/documentStore';
import type { TableEl } from '@/types/document';
import { SectionTitle, Row, ColorInput, NumberInput } from '../shared';

interface Props {
  el: TableEl;
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-2 shrink-0 w-[52px] text-right text-[10px]">{label}</span>
      <label className="flex items-center gap-1.5 cursor-pointer select-none flex-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="accent-[color:var(--accent)]"
        />
        <span className="text-[11px]" style={{ color: 'var(--ink-2)' }}>{checked ? 'Sí' : 'No'}</span>
      </label>
    </div>
  );
}

export default function TableProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<TableEl>) => updateElement(el.id, patch);

  function updateColWidth(ci: number, pct: number) {
    const cols = el.columns.map((c, i) => i === ci ? { ...c, widthPercent: Math.max(1, pct) } : c);
    up({ columns: cols });
  }

  function addColumn() {
    const pctEach = 100 / (el.columns.length + 1);
    const cols = [...el.columns.map((c) => ({ ...c, widthPercent: pctEach })), { widthPercent: pctEach, minWidth: 10 }];
    const rows = el.rows.map((row) => [...row, { text: '', align: 'left' as const }]);
    up({ columns: cols, rows });
  }

  function removeColumn(ci: number) {
    if (el.columns.length <= 1) return;
    const cols = el.columns.filter((_, i) => i !== ci);
    const sum = cols.reduce((a, c) => a + c.widthPercent, 0) || 1;
    const normalized = cols.map((c) => ({ ...c, widthPercent: (c.widthPercent / sum) * 100 }));
    const rows = el.rows.map((row) => row.filter((_, i) => i !== ci));
    up({ columns: normalized, rows });
  }

  function addRow() {
    const newRow = el.columns.map(() => ({ text: '', align: 'left' as const }));
    up({ rows: [...el.rows, newRow] });
  }

  function removeRow(ri: number) {
    if (el.rows.length <= 1) return;
    up({ rows: el.rows.filter((_, i) => i !== ri) });
  }

  function updateCell(ri: number, ci: number, text: string) {
    const rows = el.rows.map((row, i) =>
      i === ri ? row.map((cell, j) => j === ci ? { ...cell, text } : cell) : row,
    );
    up({ rows });
  }

  return (
    <>
      <SectionTitle>Tabla</SectionTitle>

      {/* Bordes */}
      <Row label="Borde">
        <NumberInput value={el.borderWidth} onChange={(v) => up({ borderWidth: v })} min={0} step={0.1} unit="mm" />
      </Row>
      <Row label="Color borde">
        <ColorInput value={el.borderColor} onChange={(v) => up({ borderColor: v })} />
      </Row>
      <Row label="Espaciado">
        <NumberInput value={el.cellSpacing} onChange={(v) => up({ cellSpacing: v })} min={0} step={0.1} unit="mm" />
      </Row>
      <Row label="Tamaño">
        <NumberInput value={el.rowFontSize ?? 9} onChange={(v) => up({ rowFontSize: v })} min={5} max={72} step={1} unit="pt" />
      </Row>

      {/* Estructura */}
      <SectionTitle>Estructura</SectionTitle>
      <CheckRow label="Encabezado" checked={el.hasHeader} onChange={(v) => up({ hasHeader: v })} />
      {el.hasHeader && (
        <Row label="Color enc.">
          <ColorInput value={el.headerBackground} onChange={(v) => up({ headerBackground: v })} />
        </Row>
      )}
      <CheckRow label="Pie tabla" checked={el.hasFooter} onChange={(v) => up({ hasFooter: v })} />
      {el.hasFooter && (
        <Row label="Color pie">
          <ColorInput value={el.footerBackground} onChange={(v) => up({ footerBackground: v })} />
        </Row>
      )}
      <CheckRow label="Filas alt." checked={el.alternateRows} onChange={(v) => up({ alternateRows: v })} />
      {el.alternateRows && (
        <Row label="Color alt.">
          <ColorInput value={el.alternateBackground} onChange={(v) => up({ alternateBackground: v })} />
        </Row>
      )}

      {/* Repetición */}
      <SectionTitle>Repetición por array</SectionTitle>
      <Row label="Variable">
        <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1">
          <input
            type="text"
            value={el.repeatBy ?? ''}
            onChange={(e) => up({ repeatBy: e.target.value.trim() || undefined })}
            placeholder="p.ej. pedido.lineas"
            className="bg-transparent w-full font-mono text-11 outline-none"
          />
        </div>
      </Row>
      <div className="text-[10px] ml-[60px]" style={{ color: 'var(--ink-3)' }}>
        Ruta JSON del array que repite las filas de datos.
      </div>

      {/* Columnas */}
      <SectionTitle>Columnas ({el.columns.length})</SectionTitle>
      {el.columns.map((col, ci) => (
        <div key={ci} className="flex items-center gap-1">
          <span className="text-ink-2 shrink-0 w-[52px] text-right text-[10px]">Col {ci + 1}</span>
          <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1">
            <input
              type="number"
              min={1}
              step={1}
              value={Math.round(col.widthPercent)}
              onChange={(e) => updateColWidth(ci, Number(e.target.value))}
              className="bg-transparent w-full text-right font-mono text-11 outline-none"
            />
            <span className="text-muted text-[10px] ml-1 shrink-0">%</span>
          </div>
          <button
            type="button"
            onClick={() => removeColumn(ci)}
            disabled={el.columns.length <= 1}
            title="Eliminar columna"
            className="h-[22px] w-[22px] rounded-3 flex items-center justify-center text-[10px] shrink-0"
            style={{ color: 'var(--ink-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', opacity: el.columns.length <= 1 ? 0.3 : 1 }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addColumn}
        className="mt-1 h-[22px] rounded-3 text-[10px] w-full"
        style={{ color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-dim)' }}
      >
        + Añadir columna
      </button>

      {/* Filas */}
      <SectionTitle>Filas ({el.rows.length})</SectionTitle>
      <div className="flex flex-col gap-0.5 max-h-[180px] overflow-y-auto pr-1">
        {el.rows.map((row, ri) => {
          const isHeader = el.hasHeader && ri === 0;
          const isFooter = el.hasFooter && ri === el.rows.length - 1;
          const label = isHeader ? '↑ Enc.' : isFooter ? '↓ Pie' : `F${ri + 1}`;
          return (
            <div key={ri} className="flex items-center gap-1">
              <span
                className="text-[9px] shrink-0 w-[52px] text-right"
                style={{ color: isHeader || isFooter ? 'var(--accent)' : 'var(--ink-3)' }}
              >
                {label}
              </span>
              <div className="flex gap-0.5 flex-1 overflow-hidden">
                {row.map((cell, ci) => (
                  <div key={ci} className="h-[20px] flex items-center bg-bg-3 border border-line-2 rounded-2 px-1 min-w-0 flex-1">
                    <input
                      type="text"
                      value={cell.text}
                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                      className="bg-transparent w-full font-mono text-[9px] outline-none min-w-0"
                      placeholder={`c${ci + 1}`}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => removeRow(ri)}
                disabled={el.rows.length <= 1}
                title="Eliminar fila"
                className="h-[20px] w-[20px] rounded-2 flex items-center justify-center text-[9px] shrink-0"
                style={{ color: 'var(--ink-3)', background: 'var(--bg-3)', border: '1px solid var(--line-2)', opacity: el.rows.length <= 1 ? 0.3 : 1 }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-1 h-[22px] rounded-3 text-[10px] w-full"
        style={{ color: 'var(--accent)', background: 'var(--accent-soft)', border: '1px solid var(--accent-dim)' }}
      >
        + Añadir fila
      </button>
    </>
  );
}
