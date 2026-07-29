import { useRef, useState } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import ImageIcon from '@mui/icons-material/Image';
import PlayCircleFilledIcon from '@mui/icons-material/PlayCircleFilled';
import type { BlockType } from './htmlBuilder';

/**
 * Selector de ALINEACIÓN de 3 posiciones, en vez de un desplegable.
 *
 * Muestra las tres casillas de la fila y el bloque DENTRO de la que está elegida, así que
 * se lee de un vistazo dónde va a quedar el elemento — que es la pregunta que el usuario
 * se está haciendo. Un desplegable obliga a leer tres palabras y a imaginarse el
 * resultado.
 *
 * La miniatura imita el tipo de bloque (imagen, botón, texto…): mover "una imagen" es más
 * concreto que mover un punto genérico de slider.
 *
 * Interacción: clic en cualquier casilla, arrastre de la miniatura entre casillas, y
 * teclado (flechas / Inicio / Fin). Es un `radiogroup`, no un `slider`: los valores son
 * tres opciones nombradas, no un rango continuo, y los lectores de pantalla deben
 * anunciarlas por su nombre.
 */

export type Align = 'left' | 'center' | 'right';

const OPCIONES: { value: Align; label: string }[] = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Derecha' },
];

/**
 * Casilla que corresponde a una posición RELATIVA (0..1) dentro de la fila — es lo que
 * traduce el arrastre a un valor. Se satura fuera de rango: al arrastrar por fuera de la
 * fila el usuario espera quedarse en el extremo, no que se ignore el movimiento.
 */
export const alignDesdeRatio = (ratio: number): Align => {
  if (ratio < 1 / 3) return 'left';
  if (ratio < 2 / 3) return 'center';
  return 'right';
};

interface Props {
  value: Align;
  onChange: (v: Align) => void;
  /** Tipo del bloque: define qué miniatura se dibuja dentro de la casilla. */
  blockType?: BlockType;
  label?: string;
}

/** Miniatura del bloque: lo que se "mueve" entre las casillas. */
const Miniatura = ({ tipo }: { tipo?: BlockType }) => {
  const base = { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' };

  if (tipo === 'image' || tipo === 'logo' || tipo === 'imageText' || tipo === 'textImage') {
    return <Box sx={base}><ImageIcon sx={{ fontSize: 30, color: '#6b7a90' }} /></Box>;
  }
  if (tipo === 'video') {
    return <Box sx={base}><PlayCircleFilledIcon sx={{ fontSize: 30, color: '#6b7a90' }} /></Box>;
  }
  if (tipo === 'button' || tipo === 'textButton' || tipo === 'buttonTextRow') {
    return (
      <Box sx={base}>
        <Box sx={{ bgcolor: '#0075be', borderRadius: 0.75, width: '72%', height: 16 }} />
      </Box>
    );
  }
  if (tipo === 'social') {
    return (
      <Box sx={{ ...base, gap: 0.4 }}>
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#6b7a90' }} />
        ))}
      </Box>
    );
  }
  // Texto / encabezado / cualquier otro: tres renglones.
  return (
    <Box sx={{ ...base, flexDirection: 'column', gap: 0.5, px: 0.75 }}>
      {[100, 100, 60].map((w, i) => (
        <Box key={i} sx={{ width: `${w}%`, height: 4, borderRadius: 2, bgcolor: '#8b99ab' }} />
      ))}
    </Box>
  );
};

export const AlignPicker = ({ value, onChange, blockType, label = 'Alineación' }: Props) => {
  const [arrastrando, setArrastrando] = useState(false);
  const fila = useRef<HTMLDivElement | null>(null);

  const alMover = (clientX: number) => {
    const caja = fila.current?.getBoundingClientRect();
    if (!caja || caja.width === 0) return;
    const destino = alignDesdeRatio((clientX - caja.left) / caja.width);
    if (destino !== value) onChange(destino);
  };

  const teclado = (e: React.KeyboardEvent) => {
    const i = OPCIONES.findIndex((o) => o.value === value);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(OPCIONES[Math.max(0, i - 1)].value);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(OPCIONES[Math.min(OPCIONES.length - 1, i + 1)].value);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange('left');
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange('right');
    }
  };

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {label}
      </Typography>
      <Box
        ref={fila}
        role="radiogroup"
        aria-label={label}
        tabIndex={0}
        onKeyDown={teclado}
        // El arrastre se sigue a nivel de la FILA, no de la miniatura: si se siguiera en
        // la miniatura, al salirse de ella el puntero se perdería el movimiento.
        onPointerMove={(e) => { if (arrastrando) alMover(e.clientX); }}
        onPointerUp={() => setArrastrando(false)}
        onPointerLeave={() => setArrastrando(false)}
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 0.75,
          outline: 'none',
          '&:focus-visible': { boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}55`, borderRadius: 1 },
        }}
      >
        {OPCIONES.map((o) => {
          const activa = value === o.value;
          return (
            <Tooltip key={o.value} title={o.label} placement="top">
              <Box
                role="radio"
                aria-checked={activa}
                aria-label={o.label}
                onClick={() => onChange(o.value)}
                onPointerDown={() => { if (activa) setArrastrando(true); }}
                sx={{
                  height: 54,
                  borderRadius: 1,
                  cursor: activa ? 'grab' : 'pointer',
                  transition: 'background-color .15s, border-color .15s',
                  // La casilla ELEGIDA es una caja sólida con el bloque dentro; las otras
                  // dos, huecos punteados. Es la metáfora de la referencia: el elemento
                  // ocupa uno de los tres lugares. El grosor es 2px en ambos estados para
                  // que la caja no salte 1px al seleccionarla.
                  border: activa ? '2px solid' : '2px dashed',
                  borderColor: activa
                    ? 'primary.main'
                    : (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,.30)' : '#b3c0d0'),
                  bgcolor: activa
                    ? (t) => (t.palette.mode === 'dark' ? 'rgba(0,117,190,.18)' : '#eef4fa')
                    : 'transparent',
                  '&:active': activa ? { cursor: 'grabbing' } : undefined,
                  '&:hover': activa ? {} : { borderColor: 'primary.main', bgcolor: 'action.hover' },
                }}
              >
                {activa && <Miniatura tipo={blockType} />}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
};
