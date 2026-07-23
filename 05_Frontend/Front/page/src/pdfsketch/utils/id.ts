let counter = 0;

/**
 * ID numérico autoincremental global.
 * Todos los tipos (doc, page, element) comparten el mismo contador
 * para garantizar unicidad dentro de la sesión: 1, 2, 3, 4…
 */
export function nextId(_prefix?: string): string {
  counter += 1;
  return String(counter);
}

/** ID numérico para compatibilidad con el XML del backend (enteros). */
let numericCounter = 1000;
export function nextNumericId(): number {
  numericCounter += 1;
  return numericCounter;
}
