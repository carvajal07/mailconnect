import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { channelOffered, channelEnabled, tabEnabled } from '../../../config/features';

/**
 * Canales apagados a nivel de PLATAFORMA (WSP/VOZ, ago 2026).
 *
 * ⚠️ El guard de TEXTO existe por una lección concreta: el apagado se hizo primero en los
 * selectores y quedó suelto el texto de ayuda del modal "Crear campaña", que seguía
 * describiendo WhatsApp y Voz. Ocultar el selector pero DESCRIBIR el canal es ofrecerlo
 * igual — esta prueba recorre las pantallas y falla si vuelve a aparecer una mención sin
 * condicionar.
 */
const src = (rel: string) => readFileSync(join(__dirname, '..', '..', '..', rel), 'utf8');

describe('compuerta de plataforma', () => {
  it('WhatsApp y Voz no se ofrecen, en todas sus grafías', () => {
    for (const ch of ['WSP', 'WHATSAPP', 'VOZ', 'VOICE', 'wsp', 'voz']) {
      expect(channelOffered(ch)).toBe(false);
    }
  });

  it('correo y SMS SÍ se ofrecen', () => {
    for (const ch of ['EM', 'EAU', 'EAP', 'SMS', 'EMAIL']) {
      expect(channelOffered(ch)).toBe(true);
    }
  });

  it('el apagado va POR ENCIMA de los flags del cliente', () => {
    // Un flag encendido no puede reactivar un canal que la plataforma no ofrece.
    const todoEncendido = {
      'func:canal_whatsapp': true, 'tab:whatsapp': true, 'func:canal_voz': true,
    };
    expect(channelEnabled(todoEncendido, 'WSP')).toBe(false);
    expect(channelEnabled(todoEncendido, 'VOZ')).toBe(false);
    expect(channelEnabled(todoEncendido, 'SMS')).toBe(true);
  });

  it('el tab de plantillas WhatsApp está oculto para todos', () => {
    expect(tabEnabled({ 'tab:whatsapp': true }, 'whatsapp')).toBe(false);
    expect(tabEnabled(undefined, 'sms')).toBe(true);
  });
});

describe('guard de texto: no describir canales que no se venden', () => {
  const PANTALLAS = [
    'components/admin/CampanasSection.tsx',
    'components/portal/BasesDatosSection.tsx',
    'components/portal/ListaNegraSection.tsx',
  ];

  it.each(PANTALLAS)('%s no OFRECE WhatsApp/Voz sin condicionar', (rel) => {
    const lineas = src(rel).split('\n');

    /**
     * Se buscan las dos formas de OFRECER un canal, no cualquier mención:
     *  · `<li>` que DESCRIBE el canal en la ayuda ("VOZ: llamada telefónica…").
     *  · `<MenuItem value="WSP">` — el usuario puede ELEGIRLO.
     *
     * Queda fuera a propósito todo lo que solo RENDERIZA datos existentes (el selector
     * de plantillas HSM dentro de la rama `isWsp`, las etiquetas de una campaña VOZ ya
     * creada): eso debe seguir funcionando mientras el apagado es reversible.
     */
    const ofrece = (l: string) =>
      (/<li>/.test(l) && /WhatsApp|WSP|VOZ|texto a voz/.test(l))
      || /<MenuItem\s+value="(WSP|VOZ|WHATSAPP|VOICE)"/.test(l);

    // La condición suele ir en la línea de arriba (`{channelOffered('WSP') && (`),
    // así que se mira una ventana corta hacia atrás.
    const condicionadaCerca = (i: number) =>
      lineas.slice(Math.max(0, i - 3), i + 1)
        .some((l) => /channelOffered|channelEnabled/.test(l));

    const sospechosas = lineas.filter((l, i) => ofrece(l) && !condicionadaCerca(i));
    expect(sospechosas, `ofrecen un canal apagado sin condicionar:\n${sospechosas.join('\n')}`).toEqual([]);
  });
});
