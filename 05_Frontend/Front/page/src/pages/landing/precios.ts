/**
 * Precios PÚBLICOS de la landing.
 *
 * ⚠️ Estos números son un ESPEJO de `VOLUME_TIERS` en el backend (`Api_V1_Cost_Estimate` y
 * las otras 5 lambdas que los copian). Viven aquí, en un solo archivo, por una razón
 * concreta: la landing anterior tenía las cifras escritas a mano dentro del JSX y se
 * desalinearon del sistema —decía $19 por correo a 10.000 y el backend cobraba $25—, así
 * que alguien se registraba con un número y se encontraba otro.
 *
 * Si cambian las tarifas del backend, cambian aquí. `precios.test.ts` compara esta tabla
 * contra los tramos y falla si divergen.
 *
 * ℹ️ Se publica el precio del PRIMER tramo ("desde") y el del tramo alto, nunca la tabla
 * completa: el precio real depende del volumen y del canal, y se cierra en la cotización.
 */

export interface CanalPrecio {
  /** Nombre visible del canal. */
  canal: string;
  /** Unidad que se cobra (importa: en SMS es por SEGMENTO, no por mensaje). */
  unidad: string;
  /** Precio del primer tramo (volumen bajo) — el "desde x". */
  desde: number;
  /** Precio del tramo más alto, para que se vea cuánto baja con volumen. */
  hasta: number;
  /** Volúmenes de ejemplo con su precio unitario en ese tramo. */
  ejemplos: { volumen: number; unitario: number }[];
  /** Aclaración propia del canal (los que dependen de un tercero). */
  nota?: string;
}

/**
 * Tramos vigentes (COP, sin IVA). Copiados de `VOLUME_TIERS`:
 *   EM    [(1,30) (2000,28) (5000,27) (10000,25) (20000,21) (50000,19) (100000,14) …]
 *   SMS   [(1,205) (2000,202) (5000,199) (10000,196) (20000,193) (50000,190) …]
 *   WSP   [(1,130) (2000,125) (5000,118) (10000,110) (20000,100) (50000,90) …]
 *   VOZ   [(1,380) (2000,375) (5000,370) (10000,365) (20000,360) (50000,355) …]
 */
export const PRECIOS_CANAL: CanalPrecio[] = [
  {
    canal: 'Correo',
    unidad: 'por correo',
    desde: 30,
    hasta: 4,
    ejemplos: [
      { volumen: 1000, unitario: 30 },
      { volumen: 10000, unitario: 25 },
      { volumen: 100000, unitario: 14 },
    ],
  },
  {
    canal: 'SMS',
    unidad: 'por segmento',
    desde: 205,
    hasta: 180,
    ejemplos: [
      { volumen: 1000, unitario: 205 },
      { volumen: 10000, unitario: 196 },
      { volumen: 100000, unitario: 187 },
    ],
    // Es la diferencia que más sorprende en la factura: un mensaje largo son 2 segmentos.
    nota: 'Un SMS de más de 160 caracteres cuenta como 2 segmentos (70 si lleva emojis).',
  },
  {
    canal: 'WhatsApp',
    unidad: 'por mensaje',
    desde: 130,
    hasta: 65,
    ejemplos: [
      { volumen: 1000, unitario: 130 },
      { volumen: 10000, unitario: 110 },
      { volumen: 100000, unitario: 82 },
    ],
    nota: 'Requiere plantilla aprobada por Meta. La tarifa depende del país del destinatario.',
  },
  {
    canal: 'Voz',
    unidad: 'por minuto',
    desde: 380,
    hasta: 335,
    ejemplos: [
      { volumen: 1000, unitario: 380 },
      { volumen: 10000, unitario: 365 },
      { volumen: 100000, unitario: 350 },
    ],
    nota: 'Se cobra por minuto de llamada, redondeado según el operador.',
  },
];

/** Formato de moneda colombiana sin decimales: $1.300. */
export const cop = (valor: number): string => `$${valor.toLocaleString('es-CO')}`;
