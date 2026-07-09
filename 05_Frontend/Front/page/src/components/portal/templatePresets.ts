/**
 * Plantillas prediseñadas para el constructor HTML.
 *
 * - 5 integradas (BUILTIN_PRESETS) como punto de partida.
 * - Personalizadas: se guardan en localStorage (las crea el admin con "Guardar como
 *   plantilla"). Persisten por navegador; para compartirlas entre usuarios/dispositivos
 *   hará falta backend más adelante.
 */

import { createBlock, nextId, DEFAULT_SETTINGS, type Block, type BlockType, type EmailSettings } from './htmlBuilder';

export interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  settings: EmailSettings;
  blocks: Block[];
  custom?: boolean;
}

/** Crea un bloque con overrides (ids reales; se re-clonan al cargar). */
const b = (type: BlockType, overrides: Partial<Block> = {}): Block => ({ ...createBlock(type), ...overrides });

const S = (o: Partial<EmailSettings> = {}): EmailSettings => ({ ...DEFAULT_SETTINGS, ...o });

export const BUILTIN_PRESETS: TemplatePreset[] = [
  {
    id: 'newsletter',
    name: 'Boletín (Newsletter)',
    description: 'Logo, titular, imagen, texto y botón. Ideal para novedades periódicas.',
    settings: S(),
    blocks: [
      b('logo'),
      b('heading', { text: 'Novedades del mes', align: 'center', color: '#16233f' }),
      b('text', { text: 'Hola {{nombre}}, esto es lo más importante de este mes en {{empresa}}.' }),
      b('image', { url: 'https://via.placeholder.com/600x260?text=Destacado', align: 'center' }),
      b('text', { text: 'Cuéntale a tus lectores por qué esto les interesa. Mantén los párrafos cortos.' }),
      b('button', { text: 'Leer más', url: 'https://', align: 'center', color: '#0075be' }),
      b('divider'),
      b('social', { align: 'center', links: { facebook: 'https://', instagram: 'https://', x: '', linkedin: '' } }),
    ],
  },
  {
    id: 'promo',
    name: 'Promoción',
    description: 'Oferta con imagen grande y llamada a la acción destacada.',
    settings: S({ linkColor: '#1fbf87' }),
    blocks: [
      b('heading', { text: '¡50% de descuento!', align: 'center', color: '#0075be' }),
      b('image', { url: 'https://via.placeholder.com/600x300?text=Oferta', align: 'center' }),
      b('text', { text: 'Solo por hoy, {{nombre}}. Aprovecha antes de que se acabe.', align: 'center' }),
      b('button', { text: 'Comprar ahora', url: 'https://', align: 'center', color: '#1fbf87' }),
      b('spacer', { height: 16 }),
      b('text', { text: 'Aplican términos y condiciones.', align: 'center' }),
    ],
  },
  {
    id: 'welcome',
    name: 'Bienvenida',
    description: 'Da la bienvenida a nuevos usuarios y guíalos al primer paso.',
    settings: S(),
    blocks: [
      b('logo'),
      b('heading', { text: '¡Bienvenido, {{nombre}}!', align: 'center', color: '#16233f' }),
      b('text', { text: 'Gracias por unirte a {{empresa}}. Estamos felices de tenerte.', align: 'center' }),
      b('button', { text: 'Empezar ahora', url: 'https://', align: 'center', color: '#0075be' }),
      b('divider'),
      b('text', { text: '¿Tienes dudas? Responde este correo y te ayudamos.', align: 'center' }),
    ],
  },
  {
    id: 'announcement',
    name: 'Anuncio / Novedad',
    description: 'Presenta una novedad con dos columnas de detalle.',
    settings: S(),
    blocks: [
      b('heading', { text: 'Tenemos algo nuevo', align: 'center', color: '#16233f' }),
      b('image', { url: 'https://via.placeholder.com/600x240?text=Novedad', align: 'center' }),
      b('columns', { text: 'Qué es\nUna breve descripción de la novedad.', textRight: 'Por qué importa\nCómo beneficia a {{nombre}}.' }),
      b('button', { text: 'Ver detalles', url: 'https://', align: 'center', color: '#0075be' }),
    ],
  },
  {
    id: 'event',
    name: 'Evento / Invitación',
    description: 'Invita a un evento con fecha, lugar y confirmación.',
    settings: S({ linkColor: '#6f5ec2' }),
    blocks: [
      b('logo'),
      b('heading', { text: 'Estás invitado', align: 'center', color: '#16233f' }),
      b('text', { text: '{{nombre}}, te esperamos el 20 de agosto, 6:00 p.m., en {{ciudad}}.', align: 'center' }),
      b('button', { text: 'Confirmar asistencia', url: 'https://', align: 'center', color: '#6f5ec2' }),
      b('divider'),
      b('social', { align: 'center', links: { facebook: 'https://', instagram: 'https://', x: '', linkedin: '' } }),
    ],
  },
];

/** Devuelve una copia de los bloques con ids nuevos (para no colisionar al cargar). */
export function cloneBlocks(blocks: Block[]): Block[] {
  return blocks.map((bl) => ({ ...bl, links: { ...bl.links }, id: nextId() }));
}

/* --------------------------- Personalizadas (localStorage) --------------------------- */

const PRESETS_KEY = 'mc_html_presets';

interface StoredPreset {
  description: string;
  settings: EmailSettings;
  blocks: Block[];
}

function readStore(): Record<string, StoredPreset> {
  try {
    return JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, StoredPreset>): void {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(store));
}

export const customPresets = {
  list: (): TemplatePreset[] =>
    Object.entries(readStore()).map(([name, p]) => ({
      id: `custom:${name}`,
      name,
      description: p.description || 'Plantilla personalizada',
      settings: { ...DEFAULT_SETTINGS, ...p.settings },
      blocks: p.blocks ?? [],
      custom: true,
    })),
  save: (name: string, blocks: Block[], settings: EmailSettings, description = ''): void => {
    const store = readStore();
    store[name] = { description, settings, blocks };
    writeStore(store);
  },
  remove: (name: string): void => {
    const store = readStore();
    delete store[name];
    writeStore(store);
  },
};

/** Todas las plantillas disponibles: integradas + personalizadas. */
export const allPresets = (): TemplatePreset[] => [...BUILTIN_PRESETS, ...customPresets.list()];
