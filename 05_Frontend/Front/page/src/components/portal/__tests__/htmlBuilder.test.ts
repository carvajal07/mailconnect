/**
 * Pruebas del constructor de correos: SANEAMIENTO (lo más sensible: el HTML que sale de
 * aquí viaja en el correo de un cliente), texto enriquecido, generación email-safe y el
 * chequeo previo de entregabilidad.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeInlineHtml,
  sanitizeBlockHtml,
  blockContentHtml,
  variableToken,
  usedVariables,
  richToPlain,
} from '../richText';
import {
  createBlock,
  generateHtml,
  generatePlainText,
  analyzeTemplate,
  DEFAULT_SETTINGS,
  COLUMN_LAYOUTS,
  MAX_COLUMNS,
  columnWidths,
  contrastRatio,
  renderBlock,
  videoThumbnail,
  youtubeId,
  isHexColor,
  socialMonoColor,
  socialRadius,
  socialBgFor,
  socialGlyphFor,
  PLATFORM_VARIABLES,
  socialOutlineWidth,
  socialOutlineColor,
  forceDarkPreview,
  DEFAULT_SOCIAL_MONO,
  type Block,
} from '../htmlBuilder';
import { alignDesdeRatio } from '../AlignPicker';

const settings = { ...DEFAULT_SETTINGS };

describe('sanitizeInlineHtml — lista blanca', () => {
  it('conserva el formato que los clientes de correo sí renderizan', () => {
    const out = sanitizeInlineHtml('<strong>Hola</strong> <em>mundo</em> <u>hoy</u>');
    expect(out).toBe('<strong>Hola</strong> <em>mundo</em> <u>hoy</u>');
  });

  it('normaliza <b>/<i> a las etiquetas semánticas', () => {
    expect(sanitizeInlineHtml('<b>a</b><i>b</i>')).toBe('<strong>a</strong><em>b</em>');
  });

  it('ELIMINA script y su contenido', () => {
    const out = sanitizeInlineHtml('Hola<script>alert(document.cookie)</script>mundo');
    expect(out).toBe('Holamundo');
    expect(out).not.toContain('alert');
  });

  it('quita manejadores de evento aunque la etiqueta sea válida', () => {
    const out = sanitizeInlineHtml('<span onclick="robar()" style="color:#f00">x</span>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('color:#f00');
  });

  it('descarta enlaces javascript: dejando solo el texto', () => {
    const out = sanitizeInlineHtml('<a href="javascript:alert(1)">clic</a>');
    expect(out).toBe('clic');
  });

  it('acepta http, mailto y las variables de plantilla', () => {
    expect(sanitizeInlineHtml('<a href="https://x.co">a</a>')).toContain('href="https://x.co"');
    expect(sanitizeInlineHtml('<a href="mailto:a@b.co">a</a>')).toContain('mailto:a@b.co');
    expect(sanitizeInlineHtml('<a href="{{unsubscribeUrl}}">baja</a>')).toContain('{{unsubscribeUrl}}');
  });

  it('filtra el CSS a la lista blanca (fuera position/expression)', () => {
    const out = sanitizeInlineHtml('<span style="color:#0f0;position:fixed;width:expression(x)">t</span>');
    expect(out).toContain('color:#0f0');
    expect(out).not.toContain('position');
    expect(out).not.toContain('expression');
  });

  it('desenvuelve los <div> que produce el contentEditable al presionar Enter', () => {
    expect(sanitizeInlineHtml('<div>uno</div><div>dos</div>')).toBe('uno<br>dos<br>');
  });

  it('escapa el texto suelto (no se puede colar markup por la puerta de atrás)', () => {
    expect(sanitizeInlineHtml('5 < 10 & 3 > 1')).toBe('5 &lt; 10 &amp; 3 &gt; 1');
  });
});

describe('sanitizeBlockHtml — HTML crudo pegado por el usuario', () => {
  it('conserva las tablas (así se maqueta un correo)', () => {
    const out = sanitizeBlockHtml('<table><tr><td style="padding:8px">hola</td></tr></table>');
    expect(out).toContain('<table>');
    expect(out).toContain('padding:8px');
  });

  it('elimina script, iframe y form', () => {
    const out = sanitizeBlockHtml('<div>ok</div><script>x()</script><iframe src="http://mal"></iframe><form></form>');
    expect(out).toContain('ok');
    expect(out).not.toContain('script');
    expect(out).not.toContain('iframe');
    expect(out).not.toContain('form');
  });

  it('quita src/href peligrosos pero deja los normales', () => {
    const out = sanitizeBlockHtml('<img src="javascript:x"><a href="https://ok.co">a</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('https://ok.co');
  });
});

describe('blockContentHtml — compatibilidad con plantillas viejas', () => {
  it('un bloque LEGADO (sin `rich`) se escapa como antes', () => {
    // Sin esta distinción, un texto viejo con "5 < 10" se rompería al tratarlo como HTML.
    expect(blockContentHtml('5 < 10', undefined)).toBe('5 &lt; 10');
  });

  it('un bloque nuevo (`rich`) conserva su formato', () => {
    expect(blockContentHtml('<strong>hola</strong>', true)).toBe('<strong>hola</strong>');
  });

  it('el salto de línea del texto plano se vuelve <br>', () => {
    expect(blockContentHtml('a\nb', false)).toBe('a<br>b');
  });
});

describe('variables con valor por defecto', () => {
  it('sin respaldo emite el token simple', () => {
    expect(variableToken('nombre')).toBe('{{nombre}}');
  });

  it('con respaldo emite la forma condicional', () => {
    expect(variableToken('nombre', 'estimado cliente'))
      .toBe('{{#if nombre}}{{nombre}}{{else}}estimado cliente{{/if}}');
  });

  it('detecta las variables usadas en ambas formas', () => {
    const vars = usedVariables('Hola {{nombre}} de {{#if empresa}}{{empresa}}{{else}}tu empresa{{/if}}');
    expect(vars.sort()).toEqual(['empresa', 'nombre']);
  });
});

describe('generateHtml — el correo resultante', () => {
  const withBlocks = (bs: Block[]) => generateHtml(bs, settings);

  it('el formato del texto enriquecido llega al correo', () => {
    const b = { ...createBlock('text'), text: 'Hola <strong>Ana</strong>', rich: true };
    expect(withBlocks([b])).toContain('Hola <strong>Ana</strong>');
  });

  it('NO deja pasar script al correo, venga de donde venga', () => {
    const rico = { ...createBlock('text'), text: 'x<script>evil()</script>', rich: true };
    const crudo = { ...createBlock('html'), text: '<script>evil()</script><p>ok</p>', rich: false };
    const out = withBlocks([rico, crudo]);
    expect(out).not.toContain('evil()');
    expect(out).toContain('<p>ok</p>');
  });

  it('omite la imagen sin src en vez de emitir una rota', () => {
    const b = createBlock('image');           // nace vacía a propósito
    expect(withBlocks([b])).not.toContain('<img');
  });

  it('la imagen con enlace queda clicable', () => {
    const b = { ...createBlock('image'), url: 'https://cdn/x.png', imageHref: 'https://tienda.co' };
    const out = withBlocks([b]);
    expect(out).toContain('<a href="https://tienda.co"');
    expect(out).toContain('<img src="https://cdn/x.png"');
  });

  it('respeta el relleno y el fondo propios del bloque', () => {
    const b = { ...createBlock('text'), padY: 40, padX: 8, bgColor: '#eef' };
    const out = withBlocks([b]);
    expect(out).toContain('padding:40px 8px');
    expect(out).toContain('background-color:#eef');
  });

  it('emite las reglas de modo oscuro solo si está activo', () => {
    const b = createBlock('text');
    expect(generateHtml([b], { ...settings, darkMode: true })).toContain('prefers-color-scheme: dark');
    expect(generateHtml([b], { ...settings, darkMode: false })).not.toContain('prefers-color-scheme');
  });

  it('las columnas respetan la distribución elegida', () => {
    const b = { ...createBlock('columns'), widths: [33, 67] };
    const out = withBlocks([b]);
    expect(out).toContain('width="33%"');
    expect(out).toContain('width="67%"');
  });

  it('las columnas renderizan los bloques ANIDADOS', () => {
    const b = {
      ...createBlock('columns'),
      cols: [[{ ...createBlock('text'), text: 'izquierda' }], [{ ...createBlock('button'), text: 'Comprar' }]],
    };
    const out = withBlocks([b]);
    expect(out).toContain('izquierda');
    expect(out).toContain('Comprar');
  });

  it('el modelo LEGADO de columnas (text/textRight) sigue funcionando', () => {
    // Plantilla guardada antes de las columnas anidadas: no puede dejar de renderizar.
    const legacy: Block = {
      ...createBlock('columns'), cols: undefined, rich: false,
      text: 'columna vieja izq', textRight: 'columna vieja der',
    };
    const out = withBlocks([legacy]);
    expect(out).toContain('columna vieja izq');
    expect(out).toContain('columna vieja der');
  });

  it('el pie de desuscripción va SIEMPRE (requisito anti-spam)', () => {
    const out = withBlocks([createBlock('text')]);
    expect(out).toContain('{{unsubscribeUrl}}');
    expect(out).toContain('{{preferencesUrl}}');
  });

  it('mantiene los condicionales de Outlook y el doctype de correo', () => {
    const out = withBlocks([createBlock('text')]);
    expect(out).toContain('<!--[if mso]>');
    expect(out).toContain('XHTML 1.0 Transitional');
  });
});

describe('analyzeTemplate — chequeo previo', () => {
  const find = (issues: ReturnType<typeof analyzeTemplate>, frag: string) =>
    issues.find((i) => i.title.toLowerCase().includes(frag));

  it('reporta la imagen sin definir como ERROR', () => {
    const bs = [createBlock('image')];
    const issues = analyzeTemplate(bs, settings, generateHtml(bs, settings));
    expect(find(issues, 'sin imagen')?.level).toBe('error');
  });

  it('reporta los enlaces sin destino', () => {
    const bs = [createBlock('button')];   // nace con href "https://"
    const issues = analyzeTemplate(bs, settings, generateHtml(bs, settings));
    expect(find(issues, 'sin destino')?.level).toBe('error');
  });

  it('avisa cuando hay imagen y casi nada de texto', () => {
    const bs = [{ ...createBlock('image'), url: 'https://cdn/x.png', text: 'foto' }];
    const issues = analyzeTemplate(bs, settings, generateHtml(bs, settings));
    expect(find(issues, 'poco texto')).toBeTruthy();
  });

  it('avisa del recorte de Gmail por encima de 102 KB', () => {
    const gordo = { ...createBlock('text'), text: 'x'.repeat(110 * 1024), rich: false };
    const issues = analyzeTemplate([gordo], settings, generateHtml([gordo], settings));
    expect(find(issues, '102 kb')?.level).toBe('warning');
  });

  it('una plantilla sana no reporta errores', () => {
    const bs: Block[] = [
      { ...createBlock('heading'), text: 'Novedades del mes' },
      { ...createBlock('text'), text: 'Texto suficientemente largo para que la proporción imagen/texto no dispare el aviso de correo casi-solo-imagen en el chequeo previo.' },
      { ...createBlock('button'), text: 'Ver', url: 'https://mailconnect.com.co' },
    ];
    const issues = analyzeTemplate(bs, { ...settings, preheader: 'Novedades' }, generateHtml(bs, settings));
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
});

describe('richToPlain', () => {
  it('extrae el texto de un contenido enriquecido', () => {
    expect(richToPlain('<strong>Hola</strong> <em>Ana</em>')).toBe('Hola Ana');
  });
});

describe('distribuciones de columnas', () => {
  it('toda distribución suma 100 (si no, la fila se desarma en el correo)', () => {
    for (const [n, layouts] of Object.entries(COLUMN_LAYOUTS)) {
      for (const l of layouts) {
        expect(l.reduce((a: number, b: number) => a + b, 0)).toBe(100);
        expect(l).toHaveLength(Number(n));
      }
    }
  });

  it('no se ofrecen más de 4 columnas (en móvil cada celda quedaría inservible)', () => {
    expect(Math.max(...Object.keys(COLUMN_LAYOUTS).map(Number))).toBe(MAX_COLUMNS);
  });

  it('las columnas nacen VACÍAS, para poner dentro lo que se quiera', () => {
    const b = createBlock('columns');
    expect(b.cols).toEqual([[], []]);
    expect(columnWidths(b)).toEqual([50, 50]);
  });

  it('lee la proporción del modelo VIEJO (`ratio`) si no hay `widths`', () => {
    const legacy = { ...createBlock('columns'), widths: undefined, ratio: '33-67' as const };
    expect(columnWidths(legacy)).toEqual([33, 67]);
  });

  it('renderiza los anchos elegidos por el usuario', () => {
    const b = { ...createBlock('columns'), widths: [25, 25, 25, 25] };
    const out = generateHtml([b], settings);
    expect((out.match(/width="25%"/g) || []).length).toBe(4);
  });
});

describe('generatePlainText — la parte de TEXTO del correo', () => {
  it('NO lleva etiquetas HTML aunque el bloque sea enriquecido', () => {
    const b = { ...createBlock('text'), text: 'Hola <strong>Ana</strong>, <a href="https://x.co">mira</a>', rich: true };
    const out = generatePlainText([b], settings);
    expect(out).toContain('Hola Ana, mira');
    expect(out).not.toContain('<strong>');
    expect(out).not.toContain('href=');
  });

  it('incluye SIEMPRE el enlace de baja (si no, esa versión incumple)', () => {
    const out = generatePlainText([createBlock('text')], settings);
    expect(out).toContain('{{unsubscribeUrl}}');
    expect(out).toContain('{{preferencesUrl}}');
  });

  it('aplana las columnas en orden de lectura (antes quedaba VACÍO)', () => {
    const b = {
      ...createBlock('columns'),
      cols: [
        [{ ...createBlock('text'), text: 'texto de la izquierda' }],
        [{ ...createBlock('text'), text: 'texto de la derecha' }],
      ],
    };
    const out = generatePlainText([b], settings);
    expect(out.indexOf('texto de la izquierda')).toBeGreaterThan(-1);
    expect(out.indexOf('texto de la derecha')).toBeGreaterThan(out.indexOf('texto de la izquierda'));
  });

  it('el botón lleva su URL: sin ella el destinatario no puede hacer clic', () => {
    const b = { ...createBlock('button'), text: 'Comprar', url: 'https://tienda.co/x' };
    expect(generatePlainText([b], settings)).toContain('Comprar: https://tienda.co/x');
  });

  it('omite el botón sin destino en vez de escribir "https://"', () => {
    const b = createBlock('button');   // nace con url 'https://'
    expect(generatePlainText([b], settings)).not.toContain('https://\n');
  });

  it('incluye los productos con su enlace', () => {
    const b = {
      ...createBlock('products'),
      items: [{ image: '', title: 'Camisa', text: 'Algodón', url: 'https://t.co/1' }],
    };
    const out = generatePlainText([b], settings);
    expect(out).toContain('Camisa — Algodón: https://t.co/1');
  });

  it('el preheader encabeza el texto (es lo que se ve en la bandeja)', () => {
    const out = generatePlainText([createBlock('text')], { ...settings, preheader: 'Novedades de julio' });
    expect(out.startsWith('Novedades de julio')).toBe(true);
  });

  it('el encabezado se marca para dar jerarquía sin formato', () => {
    const b = { ...createBlock('heading'), text: 'Titulo', rich: true };
    expect(generatePlainText([b], settings)).toContain('======');
  });

  it('un correo hecho SOLO de columnas ya no queda sin texto', () => {
    const b = { ...createBlock('columns'), cols: [[{ ...createBlock('text'), text: 'contenido real' }], []] };
    const out = generatePlainText([b], settings);
    expect(out).toContain('contenido real');
  });
});

describe('UTM automático', () => {
  const conUtm = { ...settings, utm: { enabled: true, source: 'mailconnect', medium: 'email', campaign: 'agosto' } };

  it('etiqueta los enlaces http(s)', () => {
    const b = { ...createBlock('button'), url: 'https://tienda.co/x' };
    const out = generateHtml([b], conUtm);
    expect(out).toContain('utm_source=mailconnect');
    expect(out).toContain('utm_campaign=agosto');
  });

  it('NO toca las variables de plantilla (romperían el enlace firmado de baja)', () => {
    const out = generateHtml([createBlock('text')], conUtm);
    expect(out).toContain('href="{{unsubscribeUrl}}"');
    expect(out).not.toContain('{{unsubscribeUrl}}?utm');
  });

  it('respeta un enlace que ya venía etiquetado a mano', () => {
    const b = { ...createBlock('button'), url: 'https://t.co/x?utm_source=propio' };
    const out = generateHtml([b], conUtm);
    expect(out).toContain('utm_source=propio');
    expect(out).not.toContain('utm_source=mailconnect');
  });

  it('usa & cuando la URL ya tiene parámetros', () => {
    const b = { ...createBlock('button'), url: 'https://t.co/x?id=7' };
    expect(generateHtml([b], conUtm)).toContain('id=7&utm_source=');
  });

  it('desactivado no agrega nada', () => {
    const b = { ...createBlock('button'), url: 'https://t.co/x' };
    expect(generateHtml([b], settings)).not.toContain('utm_');
  });
});

describe('visibilidad por dispositivo', () => {
  it('“solo escritorio” marca el bloque para ocultarlo en móvil', () => {
    const b = { ...createBlock('text'), hideMobile: true };
    expect(generateHtml([b], settings)).toContain('mc-hide-mobile');
  });

  it('“solo móvil” nace OCULTO y la media query lo enciende', () => {
    // Al revés no sirve: un cliente que ignora las media queries mostraría ambos bloques.
    const b = { ...createBlock('text'), hideDesktop: true };
    const out = generateHtml([b], settings);
    expect(out).toContain('mc-hide-desktop');
    expect(out).toContain('display:none;max-height:0;overflow:hidden;mso-hide:all;');
  });
});

describe('botón configurable', () => {
  it('el ancho completo ocupa toda la fila', () => {
    const b = { ...createBlock('button'), buttonFullWidth: true, url: 'https://x.co' };
    const out = generateHtml([b], settings);
    expect(out).toContain('width="100%"');
    expect(out).toContain('display:block;');
  });

  it('respeta radio, tamaño y relleno', () => {
    const b = { ...createBlock('button'), url: 'https://x.co', buttonRadius: 24, buttonFontSize: 18, buttonPadY: 16, buttonPadX: 40 };
    const out = generateHtml([b], settings);
    expect(out).toContain('border-radius:24px');
    expect(out).toContain('font-size:18px');
    expect(out).toContain('padding:16px 40px');
  });
});

describe('chequeo previo ampliado', () => {
  const find = (issues: ReturnType<typeof analyzeTemplate>, frag: string) =>
    issues.find((i) => i.title.toLowerCase().includes(frag));

  it('avisa cuando se acumulan expresiones de spam', () => {
    const b = { ...createBlock('text'), text: 'GRATIS y garantizado, última oportunidad para gana dinero', rich: true };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'spam')).toBeTruthy();
  });

  it('una palabra suelta NO dispara el aviso (una promoción legítima las usa)', () => {
    const b = { ...createBlock('text'), text: 'Envío gratis en compras superiores a cien mil pesos colombianos.', rich: true };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'spam')).toBeFalsy();
  });

  it('detecta poco contraste', () => {
    const b = { ...createBlock('text'), color: '#f2f2f2' };   // casi blanco sobre blanco
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'contraste')).toBeTruthy();
  });

  it('detecta texto por debajo de 14 px', () => {
    const b = { ...createBlock('text'), fontSize: 11 };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, '14 px')).toBeTruthy();
  });

  it('avisa de los enlaces sin UTM', () => {
    const b = { ...createBlock('button'), url: 'https://x.co' };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'utm')).toBeTruthy();
  });

  it('contrastRatio: negro sobre blanco es el máximo', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff') || 0)).toBe(21);
  });
});

describe('render unificado lienzo ↔ correo', () => {
  it('renderBlock es la MISMA función que usa el correo', () => {
    // El lienzo dibuja esto; si divergiera, volvería el bug de "en el editor se ve
    // distinto" que motivó la unificación.
    const b = { ...createBlock('button'), text: 'Comprar', url: 'https://x.co', buttonFullWidth: true };
    const suelto = renderBlock(b, settings);
    expect(generateHtml([b], settings)).toContain(suelto);
  });
});

describe('bloque de vídeo', () => {
  it('deriva la miniatura de un enlace de YouTube', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://vimeo.com/12345')).toBeNull();

    const b = { ...createBlock('video'), videoUrl: 'https://youtu.be/dQw4w9WgXcQ' };
    expect(videoThumbnail(b)).toContain('img.youtube.com/vi/dQw4w9WgXcQ');
  });

  it('la miniatura propia gana sobre la derivada', () => {
    const b = { ...createBlock('video'), videoUrl: 'https://youtu.be/abc123', videoThumb: 'https://cdn.x/portada.jpg' };
    expect(videoThumbnail(b)).toBe('https://cdn.x/portada.jpg');
  });

  it('envía una IMAGEN clicable, nunca <video> ni <iframe> (los clientes los eliminan)', () => {
    const b = { ...createBlock('video'), videoUrl: 'https://youtu.be/dQw4w9WgXcQ', videoLabel: 'Ver la demo' };
    const html = generateHtml([b], settings);
    expect(html).not.toContain('<video');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('img.youtube.com/vi/dQw4w9WgXcQ');
    // La miniatura lleva al vídeo y además queda el botón debajo.
    expect(html).toContain('href="https://youtu.be/dQw4w9WgXcQ"');
    expect(html).toContain('Ver la demo');
  });

  it('sin enlace se OMITE y el chequeo previo lo reporta como error', () => {
    const b = { ...createBlock('video'), videoUrl: '' };
    const html = generateHtml([b], settings);
    expect(html).not.toContain('img.youtube.com');
    const issues = analyzeTemplate([b], settings, html);
    expect(issues.some((i) => i.level === 'error' && /vídeo/.test(i.title))).toBe(true);
  });

  it('respeta el ancho al que se redimensionó la miniatura', () => {
    const b = { ...createBlock('video'), videoUrl: 'https://youtu.be/abc123', imageWidth: 320 };
    expect(generateHtml([b], settings)).toContain('width="320"');
  });
});

describe('redimensionar imágenes', () => {
  it('el ancho del bloque llega al correo (no solo al lienzo)', () => {
    const b = { ...createBlock('image'), url: 'https://cdn.x/a.png', text: 'Foto', imageWidth: 240 };
    const html = generateHtml([b], settings);
    expect(html).toContain('width="240"');
    // Fluida igual: en móvil no debe desbordar el ancho de la pantalla.
    expect(html).toContain('max-width:100%');
  });
});

describe('vídeo en la parte de TEXTO del correo', () => {
  it('emite el enlace: en texto plano la miniatura no existe', () => {
    const b = { ...createBlock('video'), videoUrl: 'https://youtu.be/abc123', videoLabel: 'Ver la demo' };
    const txt = generatePlainText([b], settings);
    expect(txt).toContain('Ver la demo: https://youtu.be/abc123');
  });
});

describe('redes sociales: color de marca y alineación', () => {
  const conRedes = (extra: Partial<Block> = {}) => ({
    ...createBlock('social'),
    links: { facebook: 'https://fb.com/x', instagram: 'https://ig.com/x' },
    ...extra,
  } as Block);

  it('un bloque NUEVO nace en "un solo color", no con el color de cada red', () => {
    // El estilo "Colores de cada red" se retiró del selector (ago 2026): el manual de
    // marca del cliente manda sobre el azul de Facebook y el rosa de Instagram.
    const b = conRedes();
    expect(b.socialStyle).toBe('mono');
    const html = generateHtml([b], settings);
    expect(html).not.toContain('#1877F2');
    expect(html).not.toContain('#E4405F');
  });

  it('una plantilla GUARDADA con "colores de cada red" se sigue renderizando igual', () => {
    // El estilo salió del selector, no del generador: quien ya lo tenía guardado no debe
    // ver cambiar su correo de un despliegue a otro.
    const html = generateHtml([conRedes({ socialStyle: 'badge' })], settings);
    expect(html).toContain('#1877F2');  // Facebook
    expect(html).toContain('#E4405F');  // Instagram
  });

  it('en "mono" TODAS usan el color de la marca del cliente', () => {
    const html = generateHtml([conRedes({ socialStyle: 'mono', socialColor: '#0075be' })], settings);
    expect(html).not.toContain('#1877F2');
    expect(html).not.toContain('#E4405F');
    expect(html.match(/#0075be/gi)?.length).toBeGreaterThanOrEqual(2);
  });

  it('un hex a medio escribir NO llega al correo', () => {
    // El cliente pega el hex de su manual de marca; entre tecla y tecla vale "#00".
    expect(isHexColor('#0075be')).toBe(true);
    expect(isHexColor('#00')).toBe(false);
    expect(socialMonoColor('#00')).toBe(DEFAULT_SOCIAL_MONO);
    expect(socialMonoColor('#0075be')).toBe('#0075be');
    const html = generateHtml([conRedes({ socialStyle: 'mono', socialColor: '#00' })], settings);
    expect(html).toContain(DEFAULT_SOCIAL_MONO);
  });

  it('la alineación del bloque se respeta (iba clavada a center)', () => {
    const izq = generateHtml([conRedes({ align: 'left' })], settings);
    expect(izq).toContain('align="left"');
    expect(izq).toContain('margin:0;');

    const der = generateHtml([conRedes({ align: 'right' })], settings);
    expect(der).toContain('align="right"');
    expect(der).toContain('margin:0 0 0 auto;');

    const centro = generateHtml([conRedes({ align: 'center' })], settings);
    expect(centro).toContain('margin:0 auto;');
  });

  it('el estilo LEGADO de texto también se alinea', () => {
    const html = generateHtml([conRedes({ socialStyle: 'text', align: 'right' })], settings);
    expect(html).toContain('text-align:right');
  });
});

describe('gritos: mayúsculas sostenidas y signos repetidos', () => {
  const find = (issues: ReturnType<typeof analyzeTemplate>, frag: string) =>
    issues.find((i) => i.title.toLowerCase().includes(frag));

  it('detecta "GRATIS!!! OFERTA!!!" en el CUERPO (antes solo miraba el preheader)', () => {
    const b = { ...createBlock('text'), text: 'GRATIS!!! OFERTA!!!', rich: true };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'mayúsculas sostenidas')).toBeTruthy();
  });

  it('sigue detectándolo en el texto de vista previa', () => {
    const b = createBlock('text');
    const st = { ...settings, preheader: 'ULTIMA OPORTUNIDAD' };
    expect(find(analyzeTemplate([b], st, generateHtml([b], st)), 'mayúsculas sostenidas')).toBeTruthy();
  });

  it('un texto normal NO lo dispara', () => {
    const b = { ...createBlock('text'), text: 'Hola Ana, te contamos las novedades del mes. ¡Que lo disfrutes!', rich: true };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'mayúsculas sostenidas')).toBeFalsy();
  });

  it('una variable en mayúsculas no cuenta como grito', () => {
    // Hay bases cuyas columnas van en mayúsculas por convención; no es el usuario gritando.
    const b = { ...createBlock('text'), text: 'Hola {{NOMBRE}}, tu saldo de {{CIUDAD}} está listo.', rich: true };
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(find(issues, 'mayúsculas sostenidas')).toBeFalsy();
  });
});

describe('forma de las insignias de redes', () => {
  const conRedes = (extra: Partial<Block> = {}) => ({
    ...createBlock('social'),
    links: { facebook: 'https://fb.com/x' },
    ...extra,
  } as Block);

  it('círculo por defecto, cuadrado redondeado y cuadrado', () => {
    expect(socialRadius(34)).toBe(17);
    expect(socialRadius(34, 'circle')).toBe(17);
    expect(socialRadius(34, 'rounded')).toBe(9);
    expect(socialRadius(34, 'square')).toBe(0);
  });

  it('la forma elegida llega al correo', () => {
    expect(generateHtml([conRedes({ socialShape: 'square', socialSize: 40 })], settings))
      .toContain('border-radius:0px');
    expect(generateHtml([conRedes({ socialShape: 'rounded', socialSize: 40 })], settings))
      .toContain('border-radius:10px');
  });

  it('el logo real reemplaza la insignia y NO se le repinta el fondo', () => {
    // Se mira SOLO el bloque: el documento completo tiene border-radius por otras razones
    // (las esquinas del contenedor), así que buscarlo en todo el HTML no probaría nada.
    const bloque = renderBlock(conRedes({
      socialShape: 'rounded', socialSize: 40, icons: { facebook: 'https://cdn.mio/fb.png' },
    }), settings);
    expect(bloque).toContain('<img src="https://cdn.mio/fb.png"');
    // La insignia (color y forma) va HORNEADA en el PNG. Volver a pintarla en el `td`
    // dejaría un halo cuadrado alrededor de la forma redondeada del logo.
    expect(bloque).not.toContain('bgcolor="#1877F2"');
    expect(bloque).not.toContain('border-radius');
  });

  it('la alineación NO usa align en la tabla de iconos (sería un float)', () => {
    // <table align="left"> se renderiza como float: saca la fila del flujo y el
    // contenedor del bloque colapsa (era el bug del "contenedor azul" chiquito).
    const html = generateHtml([conRedes({ align: 'left' })], settings);
    const tablaIconos = html.slice(html.indexOf('<td align="left">'));
    expect(tablaIconos).toContain('<td align="left">');
    expect(tablaIconos).not.toContain('<table role="presentation" border="0" cellpadding="0" cellspacing="0" align=');
  });
});

describe('selector de alineación de 3 casillas', () => {
  it('traduce la posición del arrastre a la casilla correcta', () => {
    expect(alignDesdeRatio(0)).toBe('left');
    expect(alignDesdeRatio(0.32)).toBe('left');
    expect(alignDesdeRatio(0.34)).toBe('center');
    expect(alignDesdeRatio(0.5)).toBe('center');
    expect(alignDesdeRatio(0.66)).toBe('center');
    expect(alignDesdeRatio(0.68)).toBe('right');
    expect(alignDesdeRatio(1)).toBe('right');
  });

  it('arrastrar por fuera de la fila se queda en el extremo, no se ignora', () => {
    expect(alignDesdeRatio(-3)).toBe('left');
    expect(alignDesdeRatio(9)).toBe('right');
  });
});

describe('ajustes globales: color de texto y fuente', () => {
  it('el ENCABEZADO hereda el color de texto de los ajustes', () => {
    // Antes nacía con color '#16233f' clavado en el bloque, así que el ajuste global
    // "Color de texto" no lo alcanzaba nunca — ni en el lienzo ni en el correo.
    const b = createBlock('heading');
    expect(b.color).toBeFalsy();
    const st = { ...settings, textColor: '#008040' };
    expect(generateHtml([b], st)).toContain('color:#008040');
  });

  it('un color propio del bloque sigue ganando sobre el global', () => {
    const b = { ...createBlock('heading'), color: '#ff0000' };
    const st = { ...settings, textColor: '#008040' };
    const html = generateHtml([b], st);
    expect(html).toContain('color:#ff0000');
  });

  it('el texto hereda color y fuente de los ajustes', () => {
    const b = createBlock('text');
    const st = { ...settings, textColor: '#123456', fontFamily: 'Georgia, serif' };
    const html = generateHtml([b], st);
    expect(html).toContain('color:#123456');
    expect(html).toContain('font-family:Georgia, serif');
  });

  it('el fondo de página y el del correo llegan al HTML', () => {
    const st = { ...settings, pageBg: '#ffe0e0', emailBg: '#fffff0' };
    const html = generateHtml([createBlock('text')], st);
    expect(html).toContain('#ffe0e0');
    expect(html).toContain('#fffff0');
  });
});

describe('logos de redes: insignia y color', () => {
  const conRedes = (extra: Partial<Block> = {}) => ({
    ...createBlock('social'),
    links: { facebook: 'https://fb.com/x' },
    ...extra,
  } as Block);

  it('con insignia, el logo va del color de glifo y el fondo del de la red', () => {
    // Estilo LEGADO explícito: el default de un bloque nuevo ya es 'mono'.
    const b = conRedes({ socialStyle: 'badge' });
    expect(socialBgFor(b, '#1877F2')).toBe('#1877F2');
    expect(socialGlyphFor(b, '#1877F2')).toBe('#ffffff');
  });

  it('en "un solo color" el fondo es el elegido, no el de cada red', () => {
    const b = conRedes({ socialStyle: 'mono', socialColor: '#0075be' });
    expect(socialBgFor(b, '#1877F2')).toBe('#0075be');
  });

  it('sin insignia, el LOGO toma el color (no hay fondo donde ponerlo)', () => {
    const b = conRedes({ socialBadge: false, socialStyle: 'badge' });
    expect(socialGlyphFor(b, '#1877F2')).toBe('#1877F2');
    const mono = conRedes({ socialBadge: false, socialStyle: 'mono', socialColor: '#111111' });
    expect(socialGlyphFor(mono, '#1877F2')).toBe('#111111');
  });

  it('el color del glifo se puede personalizar', () => {
    expect(socialGlyphFor(conRedes({ socialGlyph: '#ffee00' }), '#1877F2')).toBe('#ffee00');
    // Un hex a medio escribir no llega: se cae al blanco.
    expect(socialGlyphFor(conRedes({ socialGlyph: '#ff' }), '#1877F2')).toBe('#ffffff');
  });

  it('sin insignia el correo NO pinta fondo en la celda', () => {
    const bloque = renderBlock(conRedes({ socialBadge: false }), settings);
    expect(bloque).not.toContain('bgcolor=');
  });
});

describe('vista previa en modo oscuro', () => {
  it('fuerza las MISMAS reglas del correo, no un estilo aparte', () => {
    // prefers-color-scheme dentro de un iframe sigue la preferencia del NAVEGADOR, así que
    // la única simulación fiel es aplicar la propia media query del correo.
    const html = generateHtml([createBlock('text')], { ...settings, darkMode: true });
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    const oscuro = forceDarkPreview(html);
    expect(oscuro).not.toContain('prefers-color-scheme');
    expect(oscuro).toContain('@media all');
  });

  it('sin modo oscuro activo no hay nada que forzar', () => {
    const html = generateHtml([createBlock('text')], { ...settings, darkMode: false });
    expect(forceDarkPreview(html)).toBe(html);
  });
});

describe('iconos de redes que no se verían', () => {
  const conRedes = (extra: Partial<Block> = {}) => ({
    ...createBlock('social'),
    links: { facebook: 'https://fb.com/x' },
    ...extra,
  } as Block);

  const tieneAvisoDeIconos = (b: Block, st = settings) =>
    analyzeTemplate([b], st, generateHtml([b], st)).some((i) => i.title.includes('iconos de redes'));

  it('avisa cuando el logo es casi del mismo color que la insignia', () => {
    // El caso real: color de marca oscuro + logo oscuro. En el lienzo (sobre blanco) el
    // bloque se ve, pero el icono en sí es invisible.
    expect(tieneAvisoDeIconos(conRedes({
      socialStyle: 'mono', socialColor: '#16233f', socialGlyph: '#1b1b2b',
    }))).toBe(true);
  });

  it('el logo blanco sobre insignia oscura NO dispara el aviso', () => {
    expect(tieneAvisoDeIconos(conRedes({
      socialStyle: 'mono', socialColor: '#16233f', socialGlyph: '#ffffff',
    }))).toBe(false);
  });

  it('sin insignia, se compara contra el fondo del correo', () => {
    // Logo oscuro suelto sobre un correo oscuro: tampoco se ve.
    expect(tieneAvisoDeIconos(
      conRedes({ socialBadge: false, socialStyle: 'mono', socialColor: '#111111' }),
      { ...settings, emailBg: '#000000' },
    )).toBe(true);
  });

  it('un bloque de redes SIN enlaces no se revisa (no se dibuja nada)', () => {
    expect(tieneAvisoDeIconos({
      ...createBlock('social'), links: {}, socialStyle: 'mono', socialGlyph: '#16233f',
    } as Block)).toBe(false);
  });

  it('el estilo de enlaces de texto no se revisa (no hay insignia)', () => {
    expect(tieneAvisoDeIconos(conRedes({ socialStyle: 'text', socialGlyph: '#16233f' }))).toBe(false);
  });
});

describe('contorno de las insignias', () => {
  const b = (extra: Partial<Block> = {}) => ({ ...createBlock('social'), ...extra } as Block);

  it('sin activarlo no hay aro', () => {
    expect(socialOutlineWidth(34, b())).toBe(0);
  });

  it('activado, el grosor escala con el tamaño de la insignia', () => {
    expect(socialOutlineWidth(34, b({ socialOutline: true }))).toBeGreaterThan(0);
    expect(socialOutlineWidth(64, b({ socialOutline: true })))
      .toBeGreaterThan(socialOutlineWidth(34, b({ socialOutline: true })));
  });

  it('nunca baja de 1 px: un aro de 0 px no se vería', () => {
    expect(socialOutlineWidth(20, b({ socialOutline: true }))).toBeGreaterThanOrEqual(1);
  });

  it('un hex a medio escribir cae al blanco', () => {
    expect(socialOutlineColor(b({ socialOutline: true, socialOutlineColor: '#ff' }))).toBe('#ffffff');
    expect(socialOutlineColor(b({ socialOutline: true, socialOutlineColor: '#ff0000' }))).toBe('#ff0000');
  });
});

describe('texto enriquecido: resaltado y fuente', () => {
  it('el resaltado sobrevive al saneamiento y llega al correo', () => {
    const html = sanitizeInlineHtml('<span style="background-color:#fff3a3">oferta</span>');
    expect(html).toContain('background-color:#fff3a3');
  });

  it('la familia de fuente sobrevive al saneamiento', () => {
    const html = sanitizeInlineHtml('<span style="font-family:Georgia, serif">titular</span>');
    expect(html).toContain('font-family:Georgia, serif');
  });

  it('text-align NO pasa: el generador ya envuelve el texto en su propio párrafo', () => {
    // Meter otra alineación dentro produciría HTML anidado que Outlook rompe; la
    // alineación se controla desde el bloque.
    expect(sanitizeInlineHtml('<span style="text-align:center">x</span>')).toBe('x');
  });
});

describe('botón: alineación y compatibilidad con Outlook', () => {
  const boton = (extra: Partial<Block> = {}) =>
    ({ ...createBlock('button'), text: 'Comprar', url: 'https://tienda.co', ...extra } as Block);

  it('alineado a la DERECHA se va a la derecha (antes caía a la izquierda)', () => {
    // `right` compartía el `margin:0` de `left`, así que el control existía pero no movía
    // el botón: quedaba pegado a la izquierda igual que en 'left'.
    const html = renderBlock(boton({ align: 'right' }), settings);
    expect(html).toContain('margin:0 0 0 auto');
  });

  it('centrado y a la izquierda siguen funcionando', () => {
    expect(renderBlock(boton({ align: 'center' }), settings)).toContain('margin:0 auto');
    expect(renderBlock(boton({ align: 'left' }), settings)).toContain('margin:0;');
  });

  it('emite la versión VML para Outlook con esquinas y alto', () => {
    // Outlook usa el motor de Word: ignora border-radius y el padding del <a>. Sin VML el
    // botón sale cuadrado y del tamaño del texto.
    const html = renderBlock(boton({ buttonRadius: 8 }), settings);
    expect(html).toContain('v:roundrect');
    expect(html).toContain('arcsize=');
    expect(html).toMatch(/height:\d+px/);
  });

  it('cada motor recibe SOLO su versión (no se duplica el botón)', () => {
    const html = renderBlock(boton(), settings);
    expect(html).toContain('<!--[if mso]>');
    expect(html).toContain('<!--[if !mso]><!-->');
    // La versión estándar va dentro del condicional de "no Outlook".
    expect(html.indexOf('<!--[if !mso]><!-->')).toBeLessThan(html.indexOf('<table role="presentation"'));
  });

  it('el arcsize nunca pasa de 50% (VML deforma el botón por encima)', () => {
    const html = renderBlock(boton({ buttonRadius: 999 }), settings);
    const m = html.match(/arcsize="(\d+)%"/);
    expect(Number(m?.[1])).toBeLessThanOrEqual(50);
  });
});

describe('bloques que nacen vacíos en vez de con texto de relleno', () => {
  it('encabezado y texto nacen SIN contenido', () => {
    // Antes traían "Título principal" / "Hola {{nombre}}, escribe aquí…" y eso se ENVIABA
    // si nadie los editaba.
    expect(createBlock('heading').text).toBe('');
    expect(createBlock('text').text).toBe('');
    expect(createBlock('html').text).toBe('');
  });

  it('los productos nacen sin título ni descripción de relleno', () => {
    const items = createBlock('products').items || [];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((it) => !it.title && !it.text)).toBe(true);
  });

  it('el chequeo previo avisa del bloque de texto vacío', () => {
    const b = createBlock('text');
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(issues.some((i) => i.title.includes('sin contenido'))).toBe(true);
  });
});

describe('texto alternativo de la imagen', () => {
  const img = (extra: Partial<Block> = {}) =>
    ({ ...createBlock('image'), url: 'https://cdn/x.png', ...extra } as Block);

  it('el campo `alt` llega al correo', () => {
    expect(renderBlock(img({ alt: 'Promoción de julio' }), settings)).toContain('alt="Promoción de julio"');
  });

  it('una plantilla GUARDADA sigue tomando el alt del campo `text` legado', () => {
    // Antes del campo propio, el alt salía de `text`: esas plantillas no deben perderlo.
    const html = renderBlock({ ...img(), text: 'Alt viejo', rich: false } as Block, settings);
    expect(html).toContain('alt="Alt viejo"');
  });

  it('el chequeo previo avisa de la imagen sin alt', () => {
    const b = img({ alt: '', text: '' });
    const issues = analyzeTemplate([b], settings, generateHtml([b], settings));
    expect(issues.some((i) => i.title.includes('sin texto alternativo'))).toBe(true);
  });
});

describe('grilla de productos: alto parejo de las fotos', () => {
  const grid = (extra: Partial<Block> = {}) => ({
    ...createBlock('products'),
    items: [{ image: 'https://cdn/a.png', title: 'A', text: '', url: '' },
            { image: 'https://cdn/b.png', title: 'B', text: '', url: '' }],
    ...extra,
  } as Block);

  it('impone un alto por defecto para que la fila quede alineada', () => {
    const html = renderBlock(grid(), settings);
    expect(html).toContain('height:180px');
    expect(html).toContain('object-fit:cover');
  });

  it('el alto es configurable', () => {
    expect(renderBlock(grid({ productImageHeight: 240 }), settings)).toContain('height:240px');
  });
});

describe('variables ofrecidas sin base de datos', () => {
  it('solo se ofrecen las que la plataforma garantiza', () => {
    // Antes había una lista INVENTADA (nombre, empresa, ciudad) como respaldo: si el CSV
    // del cliente no traía esa columna exacta, `{{nombre}}` se sustituía por vacío y el
    // correo salía con "Hola ," sin que nada avisara.
    expect(PLATFORM_VARIABLES).toContain('unsubscribeUrl');
    expect(PLATFORM_VARIABLES).toContain('preferencesUrl');
    expect(PLATFORM_VARIABLES).not.toContain('nombre');
    expect(PLATFORM_VARIABLES).not.toContain('empresa');
    expect(PLATFORM_VARIABLES).not.toContain('ciudad');
  });
});
