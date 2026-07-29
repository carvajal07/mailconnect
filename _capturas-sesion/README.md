# Capturas de verificación — sesión de trabajo

> ⚠️ **Rama de solo revisión, NO parte de ningún PR.** Estas son capturas de pantalla
> tomadas con Playwright para verificar cambios en el navegador durante la sesión — no son
> parte del código de la plataforma. Bórrala cuando termines de revisar:
> `git push origin --delete claude/capturas-revision`.

Agrupadas por lo que se estaba verificando, en orden cronológico.

## Constructor HTML — rediseño del armazón (ventana propia, scroll independiente)
- `01-builder.png` — vista general del editor
- `02-bloques.png` / `03-scroll.png` — paleta y scroll independiente por panel
- `04-fullscreen.png` — pantalla completa
- `05-embebido.png` — vista embebida

## Redes sociales — estilo "un solo color" y alineación
- `06-redes-mono.png` — estilo de un solo color
- `07-redes-izquierda.png` — alineación izquierda
- `08-barra.png` — barra de herramientas del bloque
- `09-alineacion.png` — selector de alineación
- `10-revisar.png` — chequeo previo (spam, gritos en mayúsculas)

## Paquete de iconos recoloreables
- `11-pack.png` / `12-pack-claro.png` — generador de iconos por color, tema oscuro/claro

## AlignPicker — slider de 3 casillas
- `13-align-imagen.png`, `14-align-derecha.png`, `15-align-boton.png`, `16-align-texto.png`

## Inserción de bloques y ajustes globales
- `17-insertar.png` — insertar debajo del bloque seleccionado
- `18-ajustes.png` — ajustes globales (fondo, color de texto, fuente)
- `19-cargar.png` — diálogo "Cargar" (diseños editables vs. solo en SES)

## Redes en el lienzo + modo oscuro de vista previa
- `20-redes-lienzo.png` — logos reales en el lienzo
- `21-oscuro.png` — vista previa en modo oscuro

## Centro de notificaciones (campanita)
- `22-campanita.png` — contador en la barra
- `23-panel.png` — panel desplegado con los 3 avisos de prueba
- `24-leidas.png` / `25-leidas-ok.png` — verificación del badge tras "Marcar leídas"
  (confirma que `MuiBadge-invisible` + `scale(0)` es el estado correcto, no un bug)

## Landing — sección de precios (primera versión, sin tabla por canal)
- `30-precios.png`

## Editor de texto — barra de formato (fix de recorte + redes con logos reales)
- `31-barra-texto.png` / `31a-editor.png` — la barra ya no se recorta en el primer bloque
- `32-redes-panel.png` — panel de propiedades con miniaturas de logos reales

## Landing — tabla de precios por canal, footer, accesibilidad
- `40-precios-tabla.png` — tabla "desde" por canal (SMS/WhatsApp/Voz/Correo)
- `41-footer.png` — footer sin enlaces muertos
- `42-canales.png` — logo real de WhatsApp en la tarjeta del canal
- `43-tabla.png` — tabla de precios alineada
- `44-modal.png` — modal de activación accesible (foco, aria-labelledby)
- `45-barra.png` — selector de color anclado al botón (ya no sale en la esquina)

## Botón flotante de WhatsApp
- `50-boton-flotante.png` — logo real (antes era un bocadillo genérico)

## Dominios — panel SPF/DKIM/DMARC
- `60-tabla-dominios.png` — tabla de remitentes
- `61-detalle-dkim-ok.png` — DKIM verde, SPF/DMARC grises con el registro recomendado
- `62-detalle-spf-ok.png` — SPF/DMARC verdes, DKIM gris (caso inverso)
