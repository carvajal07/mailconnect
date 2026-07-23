// layout/layoutConfig.js — Panel registry and zone defaults

export const ZONE_IDS = ['top', 'left', 'left2', 'right2', 'right', 'bottom'];

export const PANELS = {
  'text-toolbar': {
    label:        'Barra de formato',
    shortLabel:   'Formato',
    color:        '#6366f1',
    allowedZones: ['top', 'bottom'],
  },
  'element-bar': {
    label:        'Barra de herramientas',
    shortLabel:   'Herram.',
    color:        '#0ea5e9',
    allowedZones: ['top', 'left', 'left2', 'right2', 'right', 'bottom'],
  },
  'pages': {
    label:        'Árbol de páginas',
    shortLabel:   'Páginas',
    color:        '#10b981',
    allowedZones: ['left', 'left2', 'right2', 'right', 'bottom'],
  },
  'data': {
    label:        'Datos / Variables',
    shortLabel:   'Datos',
    color:        '#f59e0b',
    allowedZones: ['left', 'left2', 'right2', 'right', 'bottom'],
  },
  'resources': {
    label:        'Recursos',
    shortLabel:   'Recursos',
    color:        '#ec4899',
    allowedZones: ['left', 'left2', 'right2', 'right', 'bottom'],
  },
  'properties': {
    label:        'Propiedades',
    shortLabel:   'Props',
    color:        '#8b5cf6',
    allowedZones: ['left', 'left2', 'right2', 'right', 'bottom'],
  },
};

export const DEFAULT_LAYOUT = {
  top:        [],
  left:       ['element-bar', 'pages', 'data', 'resources'],
  left2:      ['properties'],
  right2:     [],
  right:      [],
  bottom:     [],
  splitZones: [],
};

export const ZONE_LABELS = {
  top:    'Superior',
  left:   'Izquierda',
  left2:  'Izq. extra',
  right2: 'Der. extra',
  right:  'Derecha',
  bottom: 'Inferior',
};

// Returns which zone a panel currently lives in (null = hidden)
export function getPanelZone(layout, panelId) {
  for (const zone of ZONE_IDS) {
    if ((layout[zone] ?? []).includes(panelId)) return zone;
  }
  return null;
}

// Returns panels not assigned to any zone
export function getHiddenPanels(layout) {
  const assigned = new Set(ZONE_IDS.flatMap(z => layout[z] ?? []));
  return Object.keys(PANELS).filter(id => !assigned.has(id));
}

// Move panel to zone at index, removing it from previous location
export function movePanel(layout, panelId, toZone, toIndex) {
  const next = {};
  for (const z of ZONE_IDS) {
    next[z] = (layout[z] ?? []).filter(id => id !== panelId);
  }
  if (toZone === 'hidden') return next;
  const arr = [...next[toZone]];
  arr.splice(toIndex, 0, panelId);
  next[toZone] = arr;
  return next;
}
