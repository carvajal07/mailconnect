import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REDES } from './LandingPage';

/**
 * Redes de la empresa.
 *
 * Las URLs viven en `REDES` (pie de la landing) y en el `sameAs` del JSON-LD de
 * `index.html`, que es como Google asocia la organización con sus perfiles. Están
 * duplicadas por la misma razón que la FAQ: el JSON-LD tiene que ser ESTÁTICO para los
 * rastreadores que no ejecutan JavaScript. Este guard paga el precio de esa duplicación.
 *
 * ⚠️ Deriva especialmente fácil aquí: el día que existan las páginas de EMPRESA
 * (`linkedin.com/company/…` en vez del perfil personal `/in/…`) se va a cambiar la lista
 * visible y es muy probable que nadie se acuerde del JSON-LD — un `sameAs` apuntando a un
 * perfil que ya no es el oficial es peor que no tenerlo.
 */
const raiz = join(__dirname, '..', '..', '..');

const organizacion = () => {
  const html = readFileSync(join(raiz, 'index.html'), 'utf8');
  const bloque = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const grafo = JSON.parse(bloque![1])['@graph'] as Array<Record<string, unknown>>;
  return grafo.find((e) => e['@type'] === 'Organization') as { sameAs?: string[] };
};

describe('redes de la empresa', () => {
  it('el sameAs del JSON-LD tiene EXACTAMENTE las redes del pie', () => {
    const publicadas = REDES.filter((r) => r.url.trim()).map((r) => r.url);
    expect(organizacion().sameAs ?? []).toEqual(publicadas);
  });

  it('cada red tiene nombre, URL absoluta https y su glifo', () => {
    for (const r of REDES) {
      expect(r.nombre.trim().length, r.nombre).toBeGreaterThan(0);
      // Absoluta y https: una relativa la resolvería el navegador contra el propio sitio
      // (llevaría a una 404 nuestra) y http es un salto extra que algunas redes rechazan.
      expect(r.url, r.nombre).toMatch(/^https:\/\//);
      expect(r.d.trim().length, `${r.nombre} sin glifo`).toBeGreaterThan(0);
    }
  });

  it('no hay redes repetidas', () => {
    const nombres = REDES.map((r) => r.nombre.toLowerCase());
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
