/**
 * Catálogo de FUNCIONES por cliente (feature flags) + helpers de habilitación.
 *
 * El admin enciende/apaga funciones por cliente desde el panel ("Funciones por
 * cliente"). El backend las guarda en `customer.featureFlags` ({clave: bool}) y las
 * devuelve en el login (`SessionUser.featureFlags`) y en `Customer/List`. Convención
 * FAIL-OPEN: una clave AUSENTE (o true) = función HABILITADA; solo `false` la apaga.
 * Así los clientes existentes sin banderas conservan todo, y solo se restringe lo
 * que el admin apague explícitamente.
 *
 * Claves:
 *  - `tab:<id>`  → oculta/deshabilita un tab del portal (mismo id que PORTAL_TABS).
 *  - `func:<x>`  → deshabilita una FUNCIÓN puntual dentro de un tab (p. ej. el mapeo
 *                  de CSV multiregistro o la importación de JSON en Bases de datos).
 */

export interface FeatureDef {
  key: string;
  label: string;
  description: string;
  group: string;
}

/** Claves de función puntual (no-tab) referenciadas desde el código del portal. */
export const FEATURE_CSV_MULTIRECORD = 'func:csv_multiregistro';
export const FEATURE_JSON_IMPORT = 'func:json_import';
/** Canales de envío (independientes del tab de plantillas del canal). */
export const FEATURE_CHANNEL_SMS = 'func:canal_sms';
export const FEATURE_CHANNEL_WHATSAPP = 'func:canal_whatsapp';
export const FEATURE_CHANNEL_VOICE = 'func:canal_voz';

/**
 * Funciones que un cliente NUEVO NO trae habilitadas (las escribe `Api_V1_Security_Register`
 * en `customer.featureFlags` como false al registrar la empresa). El admin las habilita
 * por cliente desde "Funciones por cliente".
 * ⚠️ Mantener en sync con DEFAULT_DISABLED_FEATURES del lambda Register.
 */
export const DEFAULT_DISABLED_FEATURES: string[] = [
  FEATURE_CHANNEL_VOICE,
  FEATURE_CHANNEL_WHATSAPP,
  'tab:whatsapp',
  'tab:estudio',
  'tab:disenador',
  FEATURE_CSV_MULTIRECORD,
  FEATURE_JSON_IMPORT,
];

/**
 * Catálogo que ve el admin. Agrupado para la UI. El orden define el de la lista.
 * (No incluye "Mi cuenta": es esencial y nunca se deshabilita.)
 */
export const FEATURE_CATALOG: FeatureDef[] = [
  // ── Datos ──
  { key: 'tab:basesdatos', group: 'Datos', label: 'Bases de datos',
    description: 'Cargar y gestionar las listas de destinatarios.' },
  { key: FEATURE_CSV_MULTIRECORD, group: 'Datos', label: 'Mapeo de CSV multiregistro',
    description: 'Asistente para archivos CSV sin encabezado con la columna de tipo de registro.' },
  { key: FEATURE_JSON_IMPORT, group: 'Datos', label: 'Importar bases en JSON',
    description: 'Cargar bases desde archivos .json (array de objetos o envoltorio).' },
  { key: 'tab:listanegra', group: 'Datos', label: 'Lista negra',
    description: 'Gestionar los contactos excluidos del envío.' },

  // ── Plantillas ──
  { key: 'tab:html', group: 'Plantillas', label: 'Plantillas HTML',
    description: 'Constructor de correos HTML.' },
  { key: 'tab:docx', group: 'Plantillas', label: 'Plantillas DOCX',
    description: 'Combinación de correspondencia con documentos Word.' },
  { key: 'tab:pdf', group: 'Plantillas', label: 'Plantillas PDF básicas',
    description: 'Editor tipo Word (WYSIWYG) para PDF sencillos.' },
  { key: 'tab:estudio', group: 'Plantillas', label: 'Plantillas PDF avanzadas (Estudio)',
    description: 'Editor de lienzo pdfsketch con tablas y variables.' },
  { key: 'tab:disenador', group: 'Plantillas', label: 'Plantillas PDF profesionales (Diseñador)',
    description: 'Diseñador de documentos completo (nivel full).' },
  { key: 'tab:sms', group: 'Plantillas', label: 'Plantillas SMS',
    description: 'Plantillas de texto para SMS.' },
  { key: 'tab:whatsapp', group: 'Plantillas', label: 'Plantillas WhatsApp',
    description: 'Plantillas HSM de WhatsApp.' },

  // ── Canales de envío ──
  { key: FEATURE_CHANNEL_SMS, group: 'Canales', label: 'Canal SMS',
    description: 'Ofrecer SMS como canal en campañas y cascada.' },
  { key: FEATURE_CHANNEL_WHATSAPP, group: 'Canales', label: 'Canal WhatsApp',
    description: 'Ofrecer WhatsApp como canal en campañas y cascada.' },
  { key: FEATURE_CHANNEL_VOICE, group: 'Canales', label: 'Canal Voz',
    description: 'Ofrecer llamadas de voz (TTS) en campañas y cascada.' },

  // ── Envíos ──
  { key: 'tab:campanas', group: 'Envíos', label: 'Campañas',
    description: 'Crear y editar campañas.' },
  { key: 'tab:programar', group: 'Envíos', label: 'Programar envíos',
    description: 'Agendar el envío real a una fecha/hora futura.' },
  { key: 'tab:cascada', group: 'Envíos', label: 'Entrega garantizada (cascada)',
    description: 'Cascada omnicanal (email → SMS → WhatsApp → voz).' },
  { key: 'tab:muestras', group: 'Envíos', label: 'Muestras',
    description: 'Enviar pruebas antes del envío real.' },
  { key: 'tab:aprobaciones', group: 'Envíos', label: 'Aprobaciones',
    description: 'Flujo maker-checker de aprobación de campañas.' },

  // ── Reportes ──
  { key: 'tab:reportes', group: 'Reportes', label: 'Reportes',
    description: 'Exportar y consultar reportes por campaña.' },
  { key: 'tab:estadisticas', group: 'Reportes', label: 'Estadísticas',
    description: 'Tablero de métricas de envío.' },

  // ── Cuenta ──
  { key: 'tab:saldo', group: 'Cuenta', label: 'Saldo y recargas',
    description: 'Consultar el saldo y registrar recargas.' },
  { key: 'tab:dominios', group: 'Cuenta', label: 'Dominios',
    description: 'Verificar dominios/correos de envío propios.' },
  { key: 'tab:usuarios', group: 'Cuenta', label: 'Usuarios',
    description: 'Gestionar el equipo de la empresa.' },
];

/** Grupos en el orden en que aparecen en el catálogo (para la UI del admin). */
export const FEATURE_GROUPS: string[] = FEATURE_CATALOG.reduce<string[]>((acc, f) => {
  if (!acc.includes(f.group)) acc.push(f.group);
  return acc;
}, []);

/** ¿La función está habilitada? FAIL-OPEN: ausente o true = sí; solo false la apaga. */
export const featureEnabled = (
  flags: Record<string, boolean> | undefined,
  key: string,
): boolean => flags?.[key] !== false;

/** ¿El tab del portal está habilitado para este cliente? */
export const tabEnabled = (
  flags: Record<string, boolean> | undefined,
  tabId: string,
): boolean => featureEnabled(flags, `tab:${tabId}`);

/**
 * Canal de campaña → claves de función que lo gobiernan (TODAS deben estar habilitadas).
 * Cada canal tiene su clave propia (`func:canal_*`) y, además, los canales con plantillas
 * propias siguen respetando su tab: apagar "Plantillas WhatsApp" sigue quitando el canal
 * WhatsApp (comportamiento previo, para no reactivar canales en clientes ya configurados).
 * Los canales de correo (EM/EAU/EAP) no se gatean: son la base del producto.
 */
const CHANNEL_FEATURES: Record<string, string[]> = {
  SMS: [FEATURE_CHANNEL_SMS, 'tab:sms'],
  WSP: [FEATURE_CHANNEL_WHATSAPP, 'tab:whatsapp'],
  WHATSAPP: [FEATURE_CHANNEL_WHATSAPP, 'tab:whatsapp'],
  VOZ: [FEATURE_CHANNEL_VOICE],
  VOICE: [FEATURE_CHANNEL_VOICE],
};

/** ¿El canal de campaña está habilitado para este cliente? (canal sin clave → sí). */
export const channelEnabled = (
  flags: Record<string, boolean> | undefined,
  channel: string,
): boolean => {
  const keys = CHANNEL_FEATURES[String(channel || '').toUpperCase()];
  return !keys || keys.every((k) => featureEnabled(flags, k));
};
