import { useEffect, useState } from 'react';

/**
 * Carga una imagen HTML y la devuelve cuando está lista. Devuelve null mientras
 * está cargando o si falla la carga.
 */
export function useHtmlImage(src: string | null): {
  image: HTMLImageElement | null;
  status: 'idle' | 'loading' | 'loaded' | 'error';
} {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'loaded' | 'error'>(
    'idle',
  );

  useEffect(() => {
    if (!src) {
      setImage(null);
      setStatus('idle');
      return;
    }
    setStatus('loading');
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      setStatus('loaded');
    };
    img.onerror = () => {
      setImage(null);
      setStatus('error');
    };
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return { image, status };
}
