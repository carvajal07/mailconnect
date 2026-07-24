import { useMemo } from 'react';
import { Box } from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import { deserializeFromJson } from '../../pdfsketch/json/documentJson';

/**
 * Miniatura (vista previa) de una plantilla del Estudio PDF, renderizada como SVG
 * a partir de su `sketchJson` — sin llamar al backend. Dibuja la PRIMERA página:
 * formas reales (rect/elipse/triángulo/línea), texto como barras, e imágenes por
 * su URL. Aproximada (para el lanzador), no es el render final del motor.
 */
export default function SketchThumbnail({ sketchJson, height = 130 }: { sketchJson: string; height?: number }) {
  const doc = useMemo(() => {
    try { return deserializeFromJson(sketchJson); } catch { return null; }
  }, [sketchJson]);

  const page = doc?.pages?.[0];
  if (!page) {
    return (
      <Box sx={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: 'action.hover', color: 'text.disabled',
      }}>
        <ImageIcon fontSize="large" />
      </Box>
    );
  }

  const W = page.size?.width ?? 210;
  const H = page.size?.height ?? 297;
  const colors = doc?.assets?.colors ?? [];
  const colorOf = (v: unknown, fallback = 'none'): string => {
    if (!v || v === 'transparent') return fallback;
    if (typeof v !== 'string') return fallback;
    if (v.startsWith('#') || v.startsWith('rgb')) return v;
    const c = colors.find((c) => c.id === v) as { rgb?: string } | undefined;
    return c?.rgb ?? fallback;
  };

  return (
    <Box sx={{ height, bgcolor: '#e9edf2', overflow: 'hidden', display: 'flex', p: 0.75 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', display: 'block' }}
      >
        <rect x={0} y={0} width={W} height={H} fill={page.background || '#ffffff'} stroke="#cbd5e1" strokeWidth={0.4} />
        {page.elements.map((el) => renderEl(el, colorOf))}
      </svg>
    </Box>
  );
}

type El = Record<string, unknown> & { id: string; type: string; x: number; y: number; width: number; height: number };

function renderEl(elRaw: unknown, colorOf: (v: unknown, fb?: string) => string) {
  const el = elRaw as El;
  if (el.visible === false) return null;
  const { id, type, x = 0, y = 0, width: w = 0, height: h = 0 } = el;
  const fill = colorOf(el.fill, 'none');
  const stroke = colorOf(el.stroke, '#94a3b8');
  const sw = typeof el.strokeWidth === 'number' ? Math.max(0.15, el.strokeWidth) : 0.3;
  const rot = typeof el.rotation === 'number' && el.rotation ? `rotate(${el.rotation} ${x + w / 2} ${y + h / 2})` : undefined;

  switch (type) {
    case 'rect':
    case 'frame':
    case 'flowable': {
      const r = typeof el.cornerRadius === 'number' ? el.cornerRadius : 0;
      return <rect key={id} x={x} y={y} width={w} height={h} rx={r} ry={r} fill={fill} stroke={stroke} strokeWidth={sw} transform={rot} />;
    }
    case 'circle':
      return <ellipse key={id} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={sw} transform={rot} />;
    case 'triangle':
      return <polygon key={id} points={`${x + w / 2},${y} ${x},${y + h} ${x + w},${y + h}`} fill={fill} stroke={stroke} strokeWidth={sw} transform={rot} />;
    case 'line': {
      const pts = (el.points as number[] | undefined) ?? [x, y, x + w, y + h];
      return <line key={id} x1={pts[0]} y1={pts[1]} x2={pts[2]} y2={pts[3]} stroke={stroke === 'none' ? '#64748b' : stroke} strokeWidth={sw} />;
    }
    case 'pen': {
      const pts = (el.points as number[] | undefined) ?? [];
      if (pts.length < 4) return null;
      const d = pts.reduce((acc, n, i) => acc + (i % 2 === 0 ? `${i ? ' L' : 'M'}${n}` : ` ${n}`), '');
      return <path key={id} d={d} fill="none" stroke={stroke === 'none' ? '#64748b' : stroke} strokeWidth={sw} />;
    }
    case 'text':
    case 'dataField': {
      // Barras grises que representan líneas de texto (aprox).
      const color = colorOf(el.color, '#64748b');
      const lh = Math.max(2.6, Math.min(4.5, h / 3));
      const lines = Math.max(1, Math.min(4, Math.floor(h / (lh * 1.6))));
      return (
        <g key={id} transform={rot} opacity={0.75}>
          {Array.from({ length: lines }).map((_, i) => (
            <rect key={i} x={x} y={y + i * lh * 1.6} width={i === lines - 1 ? w * 0.6 : w} height={lh} rx={lh / 2} fill={color} />
          ))}
        </g>
      );
    }
    case 'image': {
      const src = typeof el.src === 'string' ? el.src : '';
      const isUrl = /^https?:\/\//.test(src);
      return (
        <g key={id} transform={rot}>
          <rect x={x} y={y} width={w} height={h} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={0.3} />
          {isUrl && <image href={src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" />}
        </g>
      );
    }
    case 'table':
    case 'qr':
    case 'barcode':
      return <rect key={id} x={x} y={y} width={w} height={h} fill="#e2e8f0" stroke="#cbd5e1" strokeWidth={0.3} transform={rot} />;
    default:
      return null;
  }
}
