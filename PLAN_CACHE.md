# Plan de precarga + caché del portal

> **Objetivo:** que al iniciar sesión, "por debajo" ya se esté cargando todo, y que al
> abrir cada tab (o recargar la página) la data aparezca **al instante**, refrescándose
> en segundo plano. Hoy `PortalDataProvider` ya precarga 3 datasets, pero solo en memoria
> (se pierde al recargar) y le faltan varios. Este plan lo lleva a un modelo de caché real.

_Estado actual: `context/PortalDataContext.tsx` precarga campañas + bases + estadísticas en
paralelo al montar `/panel`. En memoria, sin persistencia, sin TTL, sin lista negra ni
plantillas._

---

## Estrategia recomendada (3 capas, incrementales)

### Capa 1 — Stale-While-Revalidate en el cliente (quick win, sin backend)
El patrón SWR: **muestra lo cacheado al instante y refresca en segundo plano**.
- **Persistencia:** guardar cada dataset en `sessionStorage` con clave
  `mc_cache_{customerId}_{dataset}` + `{data, ts}` (timestamp). (sessionStorage, no local:
  se limpia al cerrar la pestaña; para datos de negocio es lo correcto.)
- **Hidratación:** al montar el provider, leer de la caché y pintar de inmediato
  (`loaded=true`); disparar el refresh en paralelo. Si el dato tiene < `TTL` (p. ej. 60 s)
  no se refresca; si es más viejo, se refresca en background sin bloquear la UI.
- **Invalidación por mutación:** tras crear/editar/borrar (campaña, base, plantilla,
  contacto de lista negra) se refresca solo ese dataset (ya existen los `refreshX`).
- **Datasets a precargar** (hoy faltan): **lista negra**, **plantillas SES** (`Template/List`),
  **plantillas de mensaje** (`MessageTemplate/List`). Añadirlos al provider.

**Impacto:** tabs instantáneos al revisitar y tras recargar; carga en segundo plano.
**Costo:** solo frontend; ~1 archivo nuevo (helper de caché) + extender el provider.

### Capa 2 — Endpoint agregado de arranque (el mayor salto de velocidad percibida)
Una sola lambda **`POST /Portal/Bootstrap`** que devuelve TODO lo del portal en **una
llamada** (en vez de 5-6 round trips tras el login):
```
data: { campaigns[], databases[], stats{}, blacklist[], sesTemplates[], messageTemplates[] }
```
- Toma el tenant del **context del Authorizer** (mismo patrón multi-tenant ya desplegado).
- Internamente hace las lecturas en paralelo (ThreadPool) o secuenciales; devuelve el
  envelope estándar. Con las **GSIs de Fase 2** (`USE_GSI=true`) cada lectura es O(resultado).
- El front, al loguear, llama **solo** a `/Portal/Bootstrap` y llena el contexto de una;
  cada `refreshX` sigue existiendo para refrescos puntuales.

**Impacto:** en redes móviles (alta latencia) pasar de ~6 round trips a 1 es la mayor
mejora de "se siente instantáneo". **Costo:** 1 lambda + 1 ruta (ya tenemos el IaC:
agregar a `routes.json`) + service en el front.

### Capa 3 — Caché de servidor (NO recomendada aún)
DAX / ElastiCache sobre DynamoDB **no ayuda aquí**: el cuello de botella no son consultas
idénticas repetidas sino los **Scan** sobre tablas (cada tenant tiene poca data). La
inversión correcta es la de **Fase 2** (GSIs + pre-agregación de contadores), no una capa
de caché de servidor que añadiría complejidad e inconsistencia. Revisar solo si, ya con
GSIs, algún endpoint agregado (Dashboard/Billing) sigue siendo caro → ahí un ítem-resumen
materializado (parte de Fase 2) es mejor que un cache tier.

---

## Detalles de diseño (Capa 1)

**Helper de caché** (`src/services/portalCache.ts`, sketch):
```ts
const TTL_MS = 60_000;
const key = (cid: string, name: string) => `mc_cache_${cid}_${name}`;
export function readCache<T>(cid: string, name: string): { data: T; fresh: boolean } | null {
  try {
    const raw = sessionStorage.getItem(key(cid, name));
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    return { data, fresh: Date.now() - ts < TTL_MS };
  } catch { return null; }
}
export function writeCache<T>(cid: string, name: string, data: T) {
  try { sessionStorage.setItem(key(cid, name), JSON.stringify({ data, ts: Date.now() })); }
  catch { /* cuota llena: ignorar */ }
}
export function clearCache(cid: string) {
  Object.keys(sessionStorage).filter(k => k.startsWith(`mc_cache_${cid}_`))
        .forEach(k => sessionStorage.removeItem(k));
}
```

**Provider (patrón por dataset):**
1. `useState` inicial: si hay caché → `{items: cache.data, loaded: true}`; si no → vacío.
2. `useEffect` al montar: por cada dataset, si `!cache || !cache.fresh` → `refreshX()`.
3. `refreshX`: al terminar OK → `writeCache(...)`.
4. En `logout` → `clearCache(customerId)`. En login de otro usuario, la clave por
   `customerId` evita mezclar tenants.

**Consideración de sesión:** la precarga corre tras el login (montaje de `/panel`), cuando
el token ya está. `RequireAuth` renueva el token en segundo plano; si un refresh falla por
401, `apiClient` ya limpia sesión y redirige. La caché por `customerId` no se comparte
entre cuentas.

---

## Recomendación de ejecución
1. **Capa 1 (frontend)** primero — entrega el "instant load" percibido sin tocar backend.
2. **Capa 2 (bootstrap)** después — colapsa el waterfall del login a 1 request; máxima
   ganancia en móvil. Requiere la lambda + ruta (ya hay IaC) y desplegar con las GSIs.
3. **Capa 3** solo si, con GSIs, un agregado sigue caro (mejor pre-agregar, no cachear).

**Dependencia útil:** activar `USE_GSI=true` (tras crear las GSIs de Fase 2) hace que tanto
el bootstrap como los refrescos sean baratos a escala.
