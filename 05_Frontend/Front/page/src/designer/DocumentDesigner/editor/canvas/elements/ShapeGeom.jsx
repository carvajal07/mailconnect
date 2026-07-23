// editor/canvas/elements/ShapeGeom.jsx — Dibuja una forma del catálogo.
//
// viewBox 0..100 + preserveAspectRatio="none" → el relleno se estira con el
// elemento; vectorEffect="non-scaling-stroke" mantiene el grosor del borde
// uniforme. Soporta relleno sólido y degradado (vía <defs>), o solo trazo
// (formas 'open' como líneas/flechas).

let gradSeq = 0;

export default function ShapeGeom({
  geom,
  kind = 'closed',
  fillPaint = 'none',       // color sólido, o un objeto gradient { type, angle, stops }
  fillOpacity = 1,
  stroke = 'none',
  strokeWidth = 0,
  dash,
}) {
  if (!geom) return null;

  // Degradado → def SVG con id único.
  let paint = kind === 'open' ? 'none' : 'none';
  let gradientDef = null;
  if (kind !== 'open' && fillPaint && typeof fillPaint === 'object') {
    const gid = `shp-grad-${++gradSeq}`;
    gradientDef = buildGradientDef(gid, fillPaint);
    paint = gradientDef ? `url(#${gid})` : 'none';
  } else if (kind !== 'open' && typeof fillPaint === 'string') {
    paint = fillPaint || 'none';
  }

  const common = {
    fill: paint,
    fillOpacity: kind === 'open' ? undefined : fillOpacity,
    fillRule: 'evenodd',
    stroke: strokeWidth > 0 ? stroke : 'none',
    strokeWidth: strokeWidth > 0 ? strokeWidth : undefined,
    vectorEffect: 'non-scaling-stroke',
    strokeDasharray: dash || undefined,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
  };

  let inner;
  if (geom.type === 'rect') {
    inner = <rect x="0" y="0" width="100" height="100" rx={geom.rx || 0} ry={geom.rx || 0} {...common} />;
  } else if (geom.type === 'ellipse') {
    inner = <ellipse cx="50" cy="50" rx="50" ry="50" {...common} />;
  } else if (geom.type === 'polygon') {
    inner = <polygon points={geom.points} {...common} />;
  } else {
    inner = <path d={geom.d} {...common} />;
  }

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ display: 'block', overflow: 'visible' }}
    >
      {gradientDef}
      {inner}
    </svg>
  );
}

function buildGradientDef(id, g) {
  const stops = (g.stops ?? []).length
    ? g.stops
    : [{ color: '#ffffff', offset: 0 }, { color: '#000000', offset: 100 }];
  const stopEls = stops.map((s, i) => (
    <stop key={i} offset={`${s.offset ?? 0}%`} stopColor={s.color ?? '#000000'} stopOpacity={s.opacity ?? 1} />
  ));
  if (g.type === 'radial' || g.type === 'rectangle') {
    return <defs><radialGradient id={id} cx="50%" cy="50%" r="65%">{stopEls}</radialGradient></defs>;
  }
  // linear: ángulo en grados → vector (gradientUnits objectBoundingBox, rotamos).
  const angle = ((g.angle ?? 0) % 360) * (Math.PI / 180);
  const x1 = 50 - Math.cos(angle) * 50;
  const y1 = 50 - Math.sin(angle) * 50;
  const x2 = 50 + Math.cos(angle) * 50;
  const y2 = 50 + Math.sin(angle) * 50;
  return (
    <defs>
      <linearGradient id={id} x1={`${x1}%`} y1={`${y1}%`} x2={`${x2}%`} y2={`${y2}%`}>
        {stopEls}
      </linearGradient>
    </defs>
  );
}
