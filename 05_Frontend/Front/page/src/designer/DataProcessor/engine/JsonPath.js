// src/nodes/DataProcessor/engine/JsonPath.js
// Resolves inputPath expressions against the WorkflowPacket.
// Supports:
//   "fieldName"             → packet.fieldName
//   "user.address.city"     → packet.user.address.city
//   "items[0].sku"          → packet.items[0].sku
//   "items[-1].sku"         → packet.items[last].sku
//   "$trigger.body.userId"  → packet.$trigger.body.userId
//   "$.deep.path"           → JSON path notation
//   "@outputName"           → cross-field reference (resolved by FieldPipeline)

/** Split a path like "a.b[0].c[-1].d" into segments */
function parsePath(path) {
  const segments = [];
  // Tokenize: dots and bracket notation
  const re = /([^.[]+)|\[(-?\d+)\]/g;
  let m;
  while ((m = re.exec(path)) !== null) {
    if (m[1] !== undefined) segments.push({ type: 'key',   value: m[1] });
    else                    segments.push({ type: 'index', value: parseInt(m[2], 10) });
  }
  return segments;
}

/**
 * Resolve a path against an object. Returns undefined if path is invalid.
 * @param {string} path - dot/bracket notation path
 * @param {object} obj  - source object
 */
export function resolvePath(path, obj) {
  if (!path || obj === undefined || obj === null) return undefined;

  // Strip leading $. (JSON path style)
  const clean = path.startsWith('$.') ? path.slice(2) : path;

  // Cross-field refs handled by FieldPipeline, not here
  if (clean.startsWith('@')) return undefined;

  const segments = parsePath(clean);
  let current = obj;

  for (const seg of segments) {
    if (current === null || current === undefined) return undefined;
    if (seg.type === 'key') {
      current = current[seg.value];
    } else {
      // Negative index: count from end
      if (!Array.isArray(current)) return undefined;
      const idx = seg.value < 0 ? current.length + seg.value : seg.value;
      current = current[idx];
    }
  }

  return current;
}

/**
 * Set a value at a path (returns a new object, does not mutate).
 * Creates intermediate objects/arrays as needed.
 */
export function setPath(path, obj, value) {
  const clean = path.startsWith('$.') ? path.slice(2) : path;
  const segments = parsePath(clean);
  if (segments.length === 0) return obj;

  const result = Array.isArray(obj) ? [...obj] : { ...obj };
  let current = result;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg  = segments[i];
    const next = segments[i + 1];
    const key  = seg.type === 'key' ? seg.value : seg.value;

    if (current[key] === null || current[key] === undefined) {
      current[key] = next.type === 'index' ? [] : {};
    } else {
      current[key] = Array.isArray(current[key])
        ? [...current[key]]
        : { ...current[key] };
    }
    current = current[key];
  }

  const last = segments[segments.length - 1];
  current[last.value] = value;
  return result;
}

/**
 * Delete a top-level key from the packet (returns new object).
 */
export function deletePath(path, obj) {
  // Only supports root-level deletes for now
  const clean = path.startsWith('$.') ? path.slice(2) : path;
  if (!clean.includes('.') && !clean.includes('[')) {
    const { [clean]: _removed, ...rest } = obj;
    return rest;
  }
  // For nested deletes, set to undefined (omit during serialization)
  return setPath(clean, obj, undefined);
}
