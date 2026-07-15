/**
 * Caché de datos del portal (Capa 1: Stale-While-Revalidate).
 *
 * Persiste cada dataset en sessionStorage por cliente, con timestamp. Al montar el
 * portal se hidrata de aquí (pinta al instante) y se refresca en segundo plano solo
 * si el dato está "viejo" (más de TTL_MS). sessionStorage (no local): se limpia al
 * cerrar la pestaña, que es lo correcto para datos de negocio.
 *
 * La clave incluye el customerId → nunca se mezclan datos entre cuentas.
 */

const TTL_MS = 60_000; // 1 min: por debajo de esto no se refresca en background
const PREFIX = 'mc_cache_';

const keyOf = (customerId: string, name: string) => `${PREFIX}${customerId}_${name}`;

export interface CacheEntry<T> {
  data: T;
  fresh: boolean; // true si aún dentro del TTL
}

/** Lee un dataset cacheado. Devuelve null si no hay o si está corrupto. */
export function readCache<T>(customerId: string, name: string): CacheEntry<T> | null {
  if (!customerId) return null;
  try {
    const raw = sessionStorage.getItem(keyOf(customerId, name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: T; ts: number };
    return { data: parsed.data, fresh: Date.now() - parsed.ts < TTL_MS };
  } catch {
    return null;
  }
}

/** Guarda un dataset en caché (best-effort: si la cuota está llena, se ignora). */
export function writeCache<T>(customerId: string, name: string, data: T): void {
  if (!customerId) return;
  try {
    sessionStorage.setItem(keyOf(customerId, name), JSON.stringify({ data, ts: Date.now() }));
  } catch {
    /* cuota llena / modo privado: la caché es opcional, no rompe nada */
  }
}

/** Borra toda la caché del portal (de cualquier cliente). Llamar en logout. */
export function clearPortalCache(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
