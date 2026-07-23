// Default structure for a border style object

export function createDefaultBorderStyle(name = 'Nuevo estilo') {
  return {
    name,
    // Global line defaults (applied to all sides unless overridden)
    lineWidth:    0.20,
    lineCap:      'Butt',
    lineStyle:    'Solid',
    lineColor:    '#000000',
    // Per-side overrides — null means "inherit from global"
    sides: {
      top:    { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
      right:  { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
      bottom: { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
      left:   { enabled: true, lineWidth: null, lineStyle: null, lineColor: null },
    },
    // Global corner defaults
    corner:   'Standard',
    radiusX:  5,
    radiusY:  5,
    // Per-corner overrides — null means "inherit from global"
    corners: {
      topLeft:     { corner: null, radiusX: null, radiusY: null },
      topRight:    { corner: null, radiusX: null, radiusY: null },
      bottomRight: { corner: null, radiusX: null, radiusY: null },
      bottomLeft:  { corner: null, radiusX: null, radiusY: null },
    },
    // Shading
    join:          'Miter',
    joinColor:     '#000000',
    miter:         10,
    fill:          '',
    shadowColor:   '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    // Per-diagonal settings (same structure as sides)
    diagonals: {
      lr: { enabled: false, lineWidth: null, lineStyle: null, lineColor: null },
      rl: { enabled: false, lineWidth: null, lineStyle: null, lineColor: null },
    },
    // Margins — offset for the border from element edges
    marginLeft: 0, marginRight: 0, marginTop: 0, marginBottom: 0,
    // Margin border line style (visible border at the margin inset)
    marginLineStyle: 'None',
    marginColor:     '#000000',
    marginLineWidth: 0.2,
    // Fill shape — independent corner type and inset
    fillCorner:         'Standard',
    fillRadiusX:        0,
    fillRadiusY:        0,
    fillPaddingLeft:    0, fillPaddingRight:  0,
    fillPaddingTop:     0, fillPaddingBottom: 0,
    // Offsets
    offsetLeft: 0, offsetRight:  0, offsetTop:    0, offsetBottom: 0,
  };
}
