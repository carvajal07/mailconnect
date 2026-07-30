import { describe, it, expect } from 'vitest';
import { estadoActivacion } from './LandingPage';

/**
 * El aviso de "cuenta activada" no aparecía porque la lambda desplegada redirigía con el
 * esquema LEGADO `?activated=1` mientras la landing solo leía `?activacion=ok`.
 * Estas pruebas fijan que los dos esquemas funcionen.
 */
const p = (qs: string) => new URLSearchParams(qs);

describe('estadoActivacion', () => {
  it('lee el esquema actual', () => {
    expect(estadoActivacion(p('activacion=ok'))).toBe('ok');
    expect(estadoActivacion(p('activacion=error'))).toBe('error');
    expect(estadoActivacion(p('activacion=expirado'))).toBe('expirado');
  });

  it('lee el esquema LEGADO ?activated=1|0', () => {
    // Es el que produjo el defecto: la URL real del correo era ?activated=1
    expect(estadoActivacion(p('activated=1'))).toBe('ok');
    expect(estadoActivacion(p('activated=true'))).toBe('ok');
    expect(estadoActivacion(p('activated=0'))).toBe('error');
    expect(estadoActivacion(p('activated=false'))).toBe('error');
  });

  it('no confunde mayúsculas ni espacios', () => {
    expect(estadoActivacion(p('activacion=OK'))).toBe('ok');
    expect(estadoActivacion(p('activated=%201%20'))).toBe('ok');
  });

  it('sin parámetro no muestra nada', () => {
    expect(estadoActivacion(p(''))).toBe('');
    expect(estadoActivacion(p('otra=cosa'))).toBe('');
    expect(estadoActivacion(p('activacion='))).toBe('');
  });

  it('el esquema actual gana si vienen los dos', () => {
    expect(estadoActivacion(p('activacion=expirado&activated=1'))).toBe('expirado');
  });

  it('un valor legado desconocido cae a error, no a éxito', () => {
    // ⚠️ Ante la duda NUNCA decir "cuenta activada": el usuario se iría a iniciar sesión
    // con una cuenta que sigue inactiva y no entendería por qué lo rechazan.
    expect(estadoActivacion(p('activated=quizas'))).toBe('error');
  });
});
