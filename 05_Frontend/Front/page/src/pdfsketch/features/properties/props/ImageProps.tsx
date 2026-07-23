import { useRef, useState } from 'react';
import { useDocumentStore } from '@/store/documentStore';
import type { ImageEl } from '@/types/document';
import { SectionTitle, SliderRow } from '../shared';

interface Props {
  el: ImageEl;
}

export default function ImageProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<ImageEl>) => updateElement(el.id, patch);
  const fileRef = useRef<HTMLInputElement>(null);
  const [keepRatio, setKeepRatio] = useState(true);

  function handleReplaceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const src = URL.createObjectURL(file);

    if (keepRatio) {
      const img = new window.Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        const newH = el.width / ratio;
        up({ src, height: Math.max(1, newH) });
      };
      img.src = src;
    } else {
      up({ src });
    }
    e.target.value = '';
  }

  function handleKeepRatioChange(checked: boolean) {
    setKeepRatio(checked);
    if (checked && el.src) {
      const img = new window.Image();
      img.onload = () => {
        const ratio = img.naturalWidth / img.naturalHeight;
        up({ height: el.width / ratio });
      };
      img.src = el.src;
    }
  }

  return (
    <>
      <SectionTitle>Imagen</SectionTitle>

      <SliderRow
        label="Opacidad"
        value={Math.round((el.opacity ?? 1) * 100)}
        onChange={(v) => up({ opacity: v / 100 })}
        unit="%"
      />

      <div className="flex items-center gap-2 mt-1">
        <input
          id="keep-ratio"
          type="checkbox"
          checked={keepRatio}
          onChange={(e) => handleKeepRatioChange(e.target.checked)}
          className="accent-[color:var(--accent)]"
        />
        <label htmlFor="keep-ratio" className="text-ink-2 text-[10px] cursor-pointer select-none">
          Conservar proporción
        </label>
      </div>

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="mt-2 w-full h-[26px] rounded-3 border border-line-2 text-11 hover:bg-bg-3 text-ink-2 flex items-center justify-center gap-1.5"
      >
        🖼 Reemplazar imagen…
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleReplaceFile}
      />

      {el.src && (
        <div className="mt-2 text-[10px] text-muted truncate" title={el.src}>
          {el.src.startsWith('blob:') ? '(archivo local)' : el.src}
        </div>
      )}
    </>
  );
}
