import { Group, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import type { TableEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';

interface Props {
  el: TableEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<TableEl>) => void;
  draggable: boolean;
}

/**
 * Tabla con encabezado opcional, pie opcional, filas alternas y variable de repetición.
 * Los anchos de columna vienen en porcentaje y se normalizan al `el.width`.
 */
export default function TableElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const totalWPx = el.width * s;
  const totalHPx = el.height * s;
  const rows = el.rows;
  const rowCount = Math.max(1, rows.length);
  const rowHPx = totalHPx / rowCount;
  const fontSize = Math.min(el.rowFontSize ?? 10, rowHPx * 0.6);

  // Normalizar porcentajes para que sumen 100
  const sumPct = el.columns.reduce((acc, c) => acc + (c.widthPercent || 0), 0) || 1;
  const colWidthsPx = el.columns.map((c) => (c.widthPercent / sumPct) * totalWPx);

  const colXPx: number[] = [];
  colWidthsPx.reduce((acc, w) => { colXPx.push(acc); return acc + w; }, 0);

  const border = el.borderColor || '#444';
  const borderW = Math.max(0.5, el.borderWidth * s);
  const pad = Math.max(2, el.cellSpacing * s);

  function getRowBackground(ri: number): string | undefined {
    const lastRow = rowCount - 1;
    if (el.hasHeader && ri === 0) return el.headerBackground || '#1e3a5f';
    if (el.hasFooter && ri === lastRow) return el.footerBackground || '#2d4a6e';
    if (el.alternateRows && ri % 2 === 1) return el.alternateBackground || '#f0f4f8';
    return undefined;
  }

  function getCellFill(_ri: number, bg?: string): string {
    return bg ?? 'transparent';
  }

  function getCellTextColor(ri: number): string {
    const lastRow = rowCount - 1;
    if (el.hasHeader && ri === 0) return '#ffffff';
    if (el.hasFooter && ri === lastRow) return '#ffffff';
    return '#111111';
  }

  function isBoldRow(ri: number): boolean {
    const lastRow = rowCount - 1;
    return (el.hasHeader && ri === 0) || (el.hasFooter && ri === lastRow);
  }

  return (
    <Group
      id={el.id}
      name="pdfsketch-element"
      x={el.x * s}
      y={el.y * s}
      rotation={el.rotation}
      visible={el.visible}
      draggable={draggable && !el.locked}
      onMouseDown={(e) => onSelect(el.id, e.evt.shiftKey || e.evt.ctrlKey || e.evt.metaKey)}
      onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.target;
        onChange({ x: node.x() / s, y: node.y() / s });
      }}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Group;
        const scaleX = node.scaleX();
        const scaleY = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: node.x() / s,
          y: node.y() / s,
          width: Math.max(5, el.width * scaleX),
          height: Math.max(5, el.height * scaleY),
          rotation: node.rotation(),
        });
      }}
    >
      {/* Fondo del conjunto */}
      <Rect x={0} y={0} width={totalWPx} height={totalHPx} fill="white" />

      {rows.map((row, ri) => {
        const rowBg = getRowBackground(ri);
        const textColor = getCellTextColor(ri);
        const bold = isBoldRow(ri);
        return row.map((cell, ci) => {
          const cx = colXPx[ci] ?? 0;
          const cw = colWidthsPx[ci] ?? 0;
          const cy = ri * rowHPx;
          const cellBg = cell.background ?? getCellFill(ri, rowBg);
          return (
            <Group key={`${ri}-${ci}`} x={cx} y={cy}>
              <Rect
                width={cw}
                height={rowHPx}
                fill={cellBg}
                stroke={border}
                strokeWidth={borderW}
              />
              <Text
                x={pad}
                y={pad}
                width={Math.max(0, cw - pad * 2)}
                height={Math.max(0, rowHPx - pad * 2)}
                text={cell.text ?? ''}
                fontSize={fontSize}
                fontFamily="Inter, system-ui, sans-serif"
                fontStyle={bold ? 'bold' : 'normal'}
                fill={cell.color ?? textColor}
                align={cell.align ?? 'left'}
                verticalAlign="middle"
                wrap="word"
              />
            </Group>
          );
        });
      })}

      {/* Borde exterior encima de todo */}
      <Rect
        x={0}
        y={0}
        width={totalWPx}
        height={totalHPx}
        fill="transparent"
        stroke={border}
        strokeWidth={borderW}
        listening={false}
      />

      {/* Etiqueta "Repite por…" si tiene variable de repetición */}
      {el.repeatBy && (
        <Text
          x={4}
          y={totalHPx - 14}
          text={`↺ ${el.repeatBy}`}
          fontSize={9}
          fill="#2563eb"
          opacity={0.7}
          listening={false}
        />
      )}
    </Group>
  );
}
