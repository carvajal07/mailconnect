import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FAQ } from './LandingPage';

/**
 * Preguntas frecuentes de la landing.
 *
 * ⚠️ El texto vive DOS veces: en el acordeón que ve la persona (`FAQ`, en LandingPage) y en
 * el JSON-LD `FAQPage` de `index.html`, que es lo que lee Google. Está duplicado a
 * propósito: el JSON-LD tiene que ser ESTÁTICO —los rastreadores que no ejecutan JavaScript
 * no verían nada inyectado por React—, y esa es la misma razón por la que el resto de metas
 * de SEO también están en el HTML.
 *
 * El precio de duplicar es la deriva, y aquí no es cosmética: Google exige que la respuesta
 * marcada esté VISIBLE en la página y coincida; si divergen, el resultado enriquecido se
 * pierde (o se penaliza). Este guard es el que paga ese precio.
 */
const raiz = join(__dirname, '..', '..', '..');

const faqDelHtml = () => {
  const html = readFileSync(join(raiz, 'index.html'), 'utf8');
  const bloque = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(bloque, 'index.html no tiene el bloque JSON-LD').toBeTruthy();
  const grafo = JSON.parse(bloque![1])['@graph'] as Array<Record<string, unknown>>;
  const page = grafo.find((e) => e['@type'] === 'FAQPage');
  return page as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] } | undefined;
};

describe('FAQ de la landing', () => {
  it('el JSON-LD publica EXACTAMENTE las preguntas visibles, en el mismo orden', () => {
    const page = faqDelHtml();
    expect(page, 'falta la entidad FAQPage en el JSON-LD de index.html').toBeTruthy();
    expect(page!.mainEntity.map((q) => q.name)).toEqual(FAQ.map((f) => f.p));
  });

  it('cada respuesta marcada es la que se ve en la página', () => {
    const page = faqDelHtml();
    page!.mainEntity.forEach((q, i) => {
      expect(q.acceptedAnswer.text).toBe(FAQ[i].r.join(' '));
    });
  });

  it('ninguna respuesta queda vacía', () => {
    for (const f of FAQ) {
      expect(f.p.trim().length, f.p).toBeGreaterThan(0);
      expect(f.r.join('').trim().length, f.p).toBeGreaterThan(0);
    }
  });

  it('no promete los canales que la plataforma NO ofrece', () => {
    // Mismo criterio que el prompt del asistente y que el apagado de canales: WhatsApp y
    // voz se pueden MENCIONAR, pero solo para decir que todavía no están. Una FAQ que los
    // ofrece es la forma más cara de conseguir un cliente: llega esperando lo que no hay.
    const mencionan = FAQ.filter((f) => /whatsapp|voz/i.test(f.p + f.r.join(' ')));
    for (const f of mencionan) {
      expect(f.r.join(' '), f.p).toMatch(/todavía no|aún no|en camino|próximamente/i);
    }
  });
});
