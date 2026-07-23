// engine/systemFields.js
// Catálogo ÚNICO de las variables de SISTEMA del render: las inyecta el motor de composición y
// están disponibles en cualquier template (no vienen del WorkflowPacket). Antes esta lista vivía
// duplicada/parcial dentro de PagesConfigPanel; centralizarla permite ofrecerlas en TODOS los
// selectores del diseñador (selección de página, pageFlow condicional, condiciones, etc.).
//
// `$overflow` es la pieza clave para la paginación por desbordamiento (equivale a la variable
// "Overflow" de Inspire): permite reglas tipo "si $overflow → ir a la página X / repetir esta".

export const SYSTEM_FIELDS = [
  { path: '$overflow',     type: 'boolean', label: '¿Desbordó el contenido de la página?', system: true },
  { path: '$pageNumber',   type: 'number',  label: 'Número de página actual',               system: true },
  { path: '$pageCount',    type: 'number',  label: 'Total de páginas',                       system: true },
  { path: '$totalPages',   type: 'number',  label: 'Total de páginas (alias de pageCount)',  system: true },
  { path: '$date',         type: 'string',  label: 'Fecha actual',                           system: true },
  { path: '$datetime',     type: 'string',  label: 'Fecha y hora actual',                    system: true },
  { path: '$documentName', type: 'string',  label: 'Nombre del documento',                   system: true },
  { path: '$index',        type: 'number',  label: 'Índice del ítem (en repetición)',        system: true },
  { path: '$item',         type: 'object',  label: 'Ítem actual (en repetición)',            system: true },
];

/** Variables de sistema cuyo tipo coincide (boolean/number/string/object). type null = todas. */
export function systemFieldsByType(type) {
  if (!type) return SYSTEM_FIELDS;
  const aliases = {
    boolean: ['boolean', 'bool'],
    number:  ['number', 'integer'],
    string:  ['string', 'text'],
    object:  ['object', 'array'],
  };
  const accepted = aliases[type] ?? [type];
  return SYSTEM_FIELDS.filter(f => accepted.includes(f.type));
}
