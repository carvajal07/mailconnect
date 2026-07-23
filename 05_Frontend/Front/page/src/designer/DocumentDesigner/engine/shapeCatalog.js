// engine/shapeCatalog.js — Catálogo de formas (estilo galería de Word).
//
// Cada forma se dibuja en un viewBox 0..100 con preserveAspectRatio="none" y
// stroke no-escalable (vectorEffect="non-scaling-stroke"), de modo que el RELLENO
// se estira con el elemento mientras el GROSOR del borde se mantiene uniforme.
//
// geom.type:
//   'rect'    → <rect> (admite rx para esquinas redondeadas)
//   'ellipse' → <ellipse> centrada
//   'polygon' → <polygon points>
//   'path'    → <path d>  (admite subpaths para huecos/detalles, fillRule evenodd)
//
// kind:
//   'closed' → relleno + borde
//   'open'   → solo borde (líneas / conectores), sin relleno

// ── Helpers de geometría ─────────────────────────────────────────────────────
function regularPolygon(n, r = 48, cx = 50, cy = 50, rotDeg = -90) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (rotDeg + (360 / n) * i) * (Math.PI / 180);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function starPolygon(spikes, rOuter = 48, rInner = 20, cx = 50, cy = 50, rotDeg = -90) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (rotDeg + (360 / (spikes * 2)) * i) * (Math.PI / 180);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// ── Categorías (orden de la galería) ─────────────────────────────────────────
export const SHAPE_CATEGORIES = [
  { id: 'lines',     label: 'Líneas' },
  { id: 'rect',      label: 'Rectángulos' },
  { id: 'basic',     label: 'Formas básicas' },
  { id: 'arrows',    label: 'Flechas de bloque' },
  { id: 'equation',  label: 'Ecuación' },
  { id: 'flow',      label: 'Diagrama de flujo' },
  { id: 'stars',     label: 'Cintas y estrellas' },
  { id: 'callouts',  label: 'Llamadas' },
];

// ── Catálogo ─────────────────────────────────────────────────────────────────
export const SHAPES = [
  // ── Líneas (open) ──
  { id: 'line',          label: 'Línea',            cat: 'lines', kind: 'open', geom: { type: 'path', d: 'M3,50 L97,50' } },
  { id: 'line-arrow',    label: 'Flecha',           cat: 'lines', kind: 'open', geom: { type: 'path', d: 'M3,50 L90,50 M78,38 L97,50 L78,62' } },
  { id: 'line-darrow',   label: 'Flecha doble',     cat: 'lines', kind: 'open', geom: { type: 'path', d: 'M10,50 L90,50 M22,38 L3,50 L22,62 M78,38 L97,50 L78,62' } },
  { id: 'line-elbow',    label: 'Conector codo',    cat: 'lines', kind: 'open', geom: { type: 'path', d: 'M3,12 L3,88 L97,88' } },

  // ── Rectángulos (closed) ──
  { id: 'rectangle',     label: 'Rectángulo',           cat: 'rect', kind: 'closed', geom: { type: 'rect', rx: 0 } },
  { id: 'round-rect',    label: 'Rectángulo redondeado',cat: 'rect', kind: 'closed', geom: { type: 'rect', rx: 14 } },
  { id: 'snip-rect',     label: 'Esquina recortada',    cat: 'rect', kind: 'closed', geom: { type: 'polygon', points: '0,0 80,0 100,20 100,100 0,100' } },
  { id: 'round-rect-1',  label: 'Una esquina redonda',  cat: 'rect', kind: 'closed', geom: { type: 'path', d: 'M0,0 H78 A22,22 0 0 1 100,22 V100 H0 Z' } },

  // ── Formas básicas (closed) ──
  { id: 'ellipse',       label: 'Elipse',          cat: 'basic', kind: 'closed', geom: { type: 'ellipse' } },
  { id: 'triangle',      label: 'Triángulo',       cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '50,2 98,98 2,98' } },
  { id: 'right-triangle',label: 'Triángulo recto', cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '2,2 2,98 98,98' } },
  { id: 'diamond',       label: 'Rombo',           cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '50,2 98,50 50,98 2,50' } },
  { id: 'parallelogram', label: 'Paralelogramo',   cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '24,2 98,2 76,98 2,98' } },
  { id: 'trapezoid',     label: 'Trapecio',        cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '22,2 78,2 98,98 2,98' } },
  { id: 'pentagon',      label: 'Pentágono',       cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: regularPolygon(5) } },
  { id: 'hexagon',       label: 'Hexágono',        cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: regularPolygon(6, 48, 50, 50, 0) } },
  { id: 'heptagon',      label: 'Heptágono',       cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: regularPolygon(7) } },
  { id: 'octagon',       label: 'Octágono',        cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: regularPolygon(8, 48, 50, 50, 22.5) } },
  { id: 'cross',         label: 'Cruz',            cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '35,2 65,2 65,35 98,35 98,65 65,65 65,98 35,98 35,65 2,65 2,35 35,35' } },
  { id: 'chevron',       label: 'Galón',           cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '2,2 62,2 98,50 62,98 2,98 38,50' } },
  { id: 'home-plate',    label: 'Flecha pentágono',cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '2,2 68,2 98,50 68,98 2,98' } },
  { id: 'heart',         label: 'Corazón',         cat: 'basic', kind: 'closed', geom: { type: 'path', d: 'M50,90 C 10,60 2,30 25,15 C 40,5 50,20 50,28 C 50,20 60,5 75,15 C 98,30 90,60 50,90 Z' } },
  { id: 'lightning',     label: 'Rayo',            cat: 'basic', kind: 'closed', geom: { type: 'polygon', points: '58,2 22,54 44,54 36,98 80,40 56,40 72,2' } },
  { id: 'moon',          label: 'Luna',            cat: 'basic', kind: 'closed', geom: { type: 'path', d: 'M70,4 A48,48 0 1 0 70,96 A38,38 0 1 1 70,4 Z' } },
  { id: 'cloud',         label: 'Nube',            cat: 'basic', kind: 'closed', geom: { type: 'path', d: 'M28,80 A20,20 0 0 1 24,42 A22,22 0 0 1 64,30 A18,18 0 0 1 86,58 A16,16 0 0 1 74,80 Z' } },
  { id: 'pie',           label: 'Sector',          cat: 'basic', kind: 'closed', geom: { type: 'path', d: 'M50,50 L50,2 A48,48 0 0 1 98,50 Z' } },
  { id: 'teardrop',      label: 'Gota',            cat: 'basic', kind: 'closed', geom: { type: 'path', d: 'M50,4 C 80,4 96,20 96,50 A46,46 0 1 1 50,4 Z' } },

  // ── Flechas de bloque (closed) ──
  { id: 'arrow-right',   label: 'Flecha derecha',  cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '2,32 58,32 58,12 98,50 58,88 58,68 2,68' } },
  { id: 'arrow-left',    label: 'Flecha izquierda',cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '98,32 42,32 42,12 2,50 42,88 42,68 98,68' } },
  { id: 'arrow-up',      label: 'Flecha arriba',   cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '32,98 32,42 12,42 50,2 88,42 68,42 68,98' } },
  { id: 'arrow-down',    label: 'Flecha abajo',    cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '32,2 32,58 12,58 50,98 88,58 68,58 68,2' } },
  { id: 'arrow-lr',      label: 'Flecha doble H',  cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '2,50 24,26 24,40 76,40 76,26 98,50 76,74 76,60 24,60 24,74' } },
  { id: 'arrow-ud',      label: 'Flecha doble V',  cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '50,2 74,24 60,24 60,76 74,76 50,98 26,76 40,76 40,24 26,24' } },
  { id: 'arrow-bent',    label: 'Flecha curva',    cat: 'arrows', kind: 'closed', geom: { type: 'polygon', points: '2,60 2,40 60,40 60,20 98,50 60,80 60,60' } },

  // ── Ecuación (closed) ──
  { id: 'math-plus',     label: 'Más',            cat: 'equation', kind: 'closed', geom: { type: 'polygon', points: '40,8 60,8 60,40 92,40 92,60 60,60 60,92 40,92 40,60 8,60 8,40 40,40' } },
  { id: 'math-minus',    label: 'Menos',          cat: 'equation', kind: 'closed', geom: { type: 'polygon', points: '8,42 92,42 92,58 8,58' } },
  { id: 'math-multiply', label: 'Por',            cat: 'equation', kind: 'closed', geom: { type: 'polygon', points: '36,22 50,36 64,22 78,36 64,50 78,64 64,78 50,64 36,78 22,64 36,50 22,36' } },
  { id: 'math-divide',   label: 'Dividir',        cat: 'equation', kind: 'closed', geom: { type: 'path', d: 'M8,44 H92 V56 H8 Z M44,20 h12 v12 h-12 Z M44,68 h12 v12 h-12 Z' } },
  { id: 'math-equal',    label: 'Igual',          cat: 'equation', kind: 'closed', geom: { type: 'path', d: 'M8,32 H92 V44 H8 Z M8,56 H92 V68 H8 Z' } },
  { id: 'math-nequal',   label: 'Distinto',       cat: 'equation', kind: 'closed', geom: { type: 'path', d: 'M8,32 H92 V44 H8 Z M8,56 H92 V68 H8 Z M58,16 h12 v68 h-12 Z' } },

  // ── Diagrama de flujo (closed) ──
  { id: 'flow-process',   label: 'Proceso',       cat: 'flow', kind: 'closed', geom: { type: 'rect', rx: 0 } },
  { id: 'flow-decision',  label: 'Decisión',      cat: 'flow', kind: 'closed', geom: { type: 'polygon', points: '50,2 98,50 50,98 2,50' } },
  { id: 'flow-terminator',label: 'Terminador',    cat: 'flow', kind: 'closed', geom: { type: 'rect', rx: 50 } },
  { id: 'flow-data',      label: 'Datos',         cat: 'flow', kind: 'closed', geom: { type: 'polygon', points: '24,2 98,2 76,98 2,98' } },
  { id: 'flow-connector', label: 'Conector',      cat: 'flow', kind: 'closed', geom: { type: 'ellipse' } },
  { id: 'flow-manual',    label: 'Entrada manual',cat: 'flow', kind: 'closed', geom: { type: 'polygon', points: '2,22 98,2 98,98 2,98' } },
  { id: 'flow-prep',      label: 'Preparación',   cat: 'flow', kind: 'closed', geom: { type: 'polygon', points: '22,2 78,2 98,50 78,98 22,98 2,50' } },

  // ── Cintas y estrellas (closed) ──
  { id: 'star4',   label: 'Estrella 4 puntas',  cat: 'stars', kind: 'closed', geom: { type: 'polygon', points: starPolygon(4, 48, 16) } },
  { id: 'star5',   label: 'Estrella 5 puntas',  cat: 'stars', kind: 'closed', geom: { type: 'polygon', points: starPolygon(5, 48, 20) } },
  { id: 'star6',   label: 'Estrella 6 puntas',  cat: 'stars', kind: 'closed', geom: { type: 'polygon', points: starPolygon(6, 48, 24) } },
  { id: 'star8',   label: 'Estrella 8 puntas',  cat: 'stars', kind: 'closed', geom: { type: 'polygon', points: starPolygon(8, 48, 28) } },
  { id: 'starburst', label: 'Explosión',        cat: 'stars', kind: 'closed', geom: { type: 'polygon', points: starPolygon(12, 48, 30) } },
  { id: 'ribbon',  label: 'Cinta',              cat: 'stars', kind: 'closed', geom: { type: 'polygon', points: '8,28 92,28 80,50 92,72 8,72 20,50' } },

  // ── Llamadas (closed) ──
  { id: 'callout-rect',  label: 'Llamada rectangular', cat: 'callouts', kind: 'closed', geom: { type: 'path', d: 'M4,4 H96 V64 H46 L28,94 L34,64 H4 Z' } },
  { id: 'callout-round', label: 'Llamada redondeada',  cat: 'callouts', kind: 'closed', geom: { type: 'path', d: 'M18,6 H82 A14,14 0 0 1 96,20 V50 A14,14 0 0 1 82,64 H46 L26,94 L34,64 H18 A14,14 0 0 1 4,50 V20 A14,14 0 0 1 18,6 Z' } },
];

// ── Lookups ──────────────────────────────────────────────────────────────────
const SHAPE_MAP = Object.fromEntries(SHAPES.map(s => [s.id, s]));

export function getShape(id) {
  return SHAPE_MAP[id] ?? SHAPE_MAP.rectangle;
}

export function shapesByCategory() {
  return SHAPE_CATEGORIES.map(cat => ({
    ...cat,
    shapes: SHAPES.filter(s => s.cat === cat.id),
  }));
}

// Default canvas size (mm) al insertar según la forma.
export function defaultShapeSize(id) {
  const s = getShape(id);
  if (s.kind === 'open') return { width: 60, height: id === 'line-elbow' ? 30 : 0.5 };
  return { width: 40, height: 40 };
}
