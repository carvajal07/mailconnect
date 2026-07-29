/**
 * Guard: los precios que PUBLICA la landing tienen que ser los que COBRA el backend.
 *
 * Por qué existe: la landing anterior tenía las cifras escritas a mano dentro del JSX y se
 * desalinearon de `VOLUME_TIERS` — decía $19 por correo a 10.000 cuando el sistema cobraba
 * $25. Un cliente se registraba con un número y se encontraba otro.
 *
 * La prueba LEE los tramos del archivo real de la lambda `Api_V1_Cost_Estimate` (no una
 * copia), así que si alguien cambia las tarifas del backend y olvida la landing, falla.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRECIOS_CANAL, cop } from '../precios';

/** Canal de la landing → clave del canal en VOLUME_TIERS. */
const CLAVE: Record<string, string> = {
  Correo: 'EM', SMS: 'SMS', WhatsApp: 'WHATSAPP', Voz: 'VOICE',
};

/** Extrae VOLUME_TIERS del código Python de la lambda. */
const tiersDelBackend = (): Record<string, [number, number][]> => {
  const ruta = resolve(
    __dirname, '../../../../../../../04_Backend/lambdas/Api_V1_Cost_Estimate/lambda_function.py');
  const py = readFileSync(ruta, 'utf-8');
  const bloque = py.match(/VOLUME_TIERS = \{([\s\S]*?)\n\}/);
  if (!bloque) throw new Error('No se encontró VOLUME_TIERS en la lambda');

  const salida: Record<string, [number, number][]> = {};
  for (const linea of bloque[1].split('\n')) {
    const m = linea.match(/'([A-Z]+)':\s*\[(.*)\]/);
    if (!m) continue;
    salida[m[1]] = [...m[2].matchAll(/\((\d+),\s*(\d+)\)/g)]
      .map((t) => [Number(t[1]), Number(t[2])] as [number, number]);
  }
  return salida;
};

/** Precio unitario que cobra el backend para ese volumen (el tramo aplica a TODO el envío). */
const unitario = (tramos: [number, number][], volumen: number): number => {
  let precio = tramos[0][1];
  for (const [min, valor] of tramos) if (volumen >= min) precio = valor;
  return precio;
};

describe('precios de la landing vs. tarifas del backend', () => {
  const tiers = tiersDelBackend();

  it('la lambda expone los 4 canales que publica la landing', () => {
    for (const canal of Object.values(CLAVE)) expect(tiers[canal]).toBeTruthy();
  });

  for (const canal of PRECIOS_CANAL) {
    describe(canal.canal, () => {
      const tramos = tiers[CLAVE[canal.canal]];

      it('el "desde" es el precio del primer tramo', () => {
        expect(canal.desde).toBe(tramos[0][1]);
      });

      it('el precio del tramo más alto coincide', () => {
        expect(canal.hasta).toBe(tramos[tramos.length - 1][1]);
      });

      it.each(canal.ejemplos)('a $volumen envíos cobra lo que se publica', ({ volumen, unitario: pub }) => {
        expect(pub).toBe(unitario(tramos, volumen));
      });

      it('el precio baja (o se mantiene) con el volumen', () => {
        const valores = canal.ejemplos.map((e) => e.unitario);
        for (let i = 1; i < valores.length; i++) expect(valores[i]).toBeLessThanOrEqual(valores[i - 1]);
      });
    });
  }
});

describe('formato de moneda', () => {
  it('usa el separador de miles colombiano y no muestra decimales', () => {
    expect(cop(1300)).toBe('$1.300');
    expect(cop(205)).toBe('$205');
  });
});
