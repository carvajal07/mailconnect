/**
 * Segmentación de SMS — la misma regla que aplica el operador (y que cobra AWS).
 *
 * Por qué importa: **AWS cobra por SEGMENTO, no por mensaje**. Un SMS de 200 caracteres
 * son 2 segmentos y cuesta el doble. El contador que había (`length / 160`) ignoraba dos
 * cosas que cambian el resultado a la mitad:
 *
 *  1. Al **concatenar**, cada parte pierde 7 bits de cabecera → caben 153, no 160.
 *  2. Un solo carácter fuera de **GSM 03.38** (una emoji, un "•", comillas tipográficas
 *     que Word inserta solo) convierte TODO el mensaje a UCS-2 → 70 caracteres, o 67 por
 *     parte. Un mensaje de 100 caracteres con una emoji son 2 segmentos, no 1.
 *
 * ⚠️ Réplica de `_sms_segments` en `Api_V1_Email_Prepare-batch-template` (convención del
 * repo: las lambdas no comparten código con el front). Si cambia una, cambia la otra —
 * si divergen, el cliente ve un costo y se le debita otro.
 */

/** GSM 03.38 básico: 1 carácter = 1 espacio. */
const GSM7_BASICO =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/** GSM 03.38 extendido: se codifican con un escape, así que ocupan DOS espacios. */
const GSM7_EXTENDIDO = '^{}\\[~]|€';

export const GSM7_SIMPLE = 160;
export const GSM7_CONCAT = 153;
export const UCS2_SIMPLE = 70;
export const UCS2_CONCAT = 67;

export interface SmsInfo {
  /** Segmentos que se van a cobrar. */
  segments: number;
  /** Espacios ocupados (no es `length`: los del GSM extendido cuentan doble). */
  length: number;
  /** true = alfabeto GSM-7; false = el mensaje se manda en UCS-2 (menos caracteres). */
  gsm7: boolean;
  /** Cuántos caracteres más caben antes de pasar al siguiente segmento. */
  remaining: number;
}

export const smsInfo = (body: string): SmsInfo => {
  const texto = body || '';
  let length = 0;
  let gsm7 = true;
  for (const ch of texto) {
    if (GSM7_EXTENDIDO.includes(ch)) length += 2;
    else if (GSM7_BASICO.includes(ch)) length += 1;
    else { gsm7 = false; break; }
  }
  // Fuera de GSM-7 se cuenta por unidades de código UTF-16, que es lo que mide UCS-2.
  if (!gsm7) length = texto.length;

  const simple = gsm7 ? GSM7_SIMPLE : UCS2_SIMPLE;
  const concat = gsm7 ? GSM7_CONCAT : UCS2_CONCAT;
  const segments = length === 0 ? 1 : length <= simple ? 1 : Math.ceil(length / concat);
  const capacidad = segments === 1 ? simple : segments * concat;
  return { segments, length, gsm7, remaining: Math.max(0, capacidad - length) };
};

/** Solo los segmentos (lo que multiplica la tarifa). */
export const smsSegments = (body: string): number => smsInfo(body).segments;
