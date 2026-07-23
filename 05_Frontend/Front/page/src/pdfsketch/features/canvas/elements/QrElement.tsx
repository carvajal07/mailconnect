import { useEffect, useState } from 'react';
import { Group, Image as KImage, Rect, Text } from 'react-konva';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type Konva from 'konva';
import type { QrEl } from '@/types/document';
import { MM_TO_PX } from '@/utils/units';
import { useHtmlImage } from './useHtmlImage';

interface Props {
  el: QrEl;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onChange: (patch: Partial<QrEl>) => void;
  draggable: boolean;
}

async function generateDataUrl(el: QrEl): Promise<string | null> {
  const content = el.data?.trim() || (el.variable ? `{{${el.variable}}}` : '');
  if (!content) return null;

  if (el.barcodeType === 'QR') {
    return QRCode.toDataURL(content, {
      errorCorrectionLevel: el.errorLevel,
      margin: 0,
      width: 512,
    });
  }

  // Linear barcodes via JsBarcode → SVG → data URL
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, content, {
      format: el.barcodeType,
      displayValue: el.showText,
      margin: 4,
      width: 2,
      height: 80,
      fontOptions: '',
      font: 'monospace',
      fontSize: 14,
      background: '#ffffff',
      lineColor: '#000000',
      textMargin: 2,
    });
  } catch {
    return null;
  }
  const svgStr = new XMLSerializer().serializeToString(svg);
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
}

export default function QrElement({ el, zoom, onSelect, onChange, draggable }: Props) {
  const s = MM_TO_PX * zoom;
  const isQr = el.barcodeType === 'QR';
  const wPx = el.width * s;
  const hPx = el.height * s;
  // QR stays square; linear barcodes use full rectangle
  const side = isQr ? Math.min(wPx, hPx) : wPx;
  const sideH = isQr ? side : hPx;

  const rawContent = el.data?.trim() || (el.variable ? `{{${el.variable}}}` : '');
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    generateDataUrl(el)
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawContent, el.barcodeType, el.errorLevel, el.showText]);

  const { image } = useHtmlImage(dataUrl);

  const placeholderLabel = isQr ? 'QR' : el.barcodeType;

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
        if (isQr) {
          const scale = Math.min(scaleX, scaleY);
          const size = Math.max(1, Math.min(el.width, el.height) * scale);
          onChange({ x: node.x() / s, y: node.y() / s, width: size, height: size, rotation: node.rotation() });
        } else {
          onChange({
            x: node.x() / s,
            y: node.y() / s,
            width: Math.max(5, el.width * scaleX),
            height: Math.max(3, el.height * scaleY),
            rotation: node.rotation(),
          });
        }
      }}
    >
      {image ? (
        <KImage image={image} width={side} height={sideH} />
      ) : (
        <>
          <Rect width={side} height={sideH} fill="#fff" stroke="#bbb" strokeWidth={1} dash={[3, 3]} />
          <Text
            width={side}
            height={sideH}
            text={rawContent ? placeholderLabel : 'Sin datos'}
            fontSize={Math.min(12, sideH / 4)}
            fill="#666"
            align="center"
            verticalAlign="middle"
          />
        </>
      )}
    </Group>
  );
}
