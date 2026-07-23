import { useDocumentStore } from '@/store/documentStore';
import type { TextEl } from '@/types/document';
import { SectionTitle, Row, ColorInput, NumberInput, TextInput, IconToggleGroup } from '../shared';

interface Props {
  el: TextEl;
}

const ALIGN_OPTIONS = [
  { value: 'left', label: '⬅', title: 'Izquierda' },
  { value: 'center', label: '≡', title: 'Centro' },
  { value: 'right', label: '➡', title: 'Derecha' },
  { value: 'justify-block', label: '☰', title: 'Justificado' },
] as const;

const DECO_OPTIONS = [
  { value: '', label: 'N', title: 'Normal' },
  { value: 'underline', label: 'S̲', title: 'Subrayado' },
  { value: 'line-through', label: 'S̶', title: 'Tachado' },
] as const;

export default function TextProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<TextEl>) => updateElement(el.id, patch);

  return (
    <>
      <SectionTitle>Contenido</SectionTitle>

      {(el.spans?.length ?? 0) > 0 ? (
        <div
          className="px-2 py-1.5 rounded text-[10px] leading-snug"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)', border: '1px solid var(--accent-dim)' }}
        >
          Texto enriquecido activo ({el.spans!.length} segmento{el.spans!.length !== 1 ? 's' : ''})
          — edita en el lienzo con doble clic
          <button
            type="button"
            className="mt-1 block text-[10px] underline opacity-70 hover:opacity-100"
            onClick={() => up({ spans: [], text: el.text })}
          >
            Convertir a texto plano
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-ink-2 text-[10px]">Texto</span>
          <textarea
            value={el.text}
            onChange={(e) => up({ text: e.target.value })}
            rows={3}
            className="bg-bg-3 border border-line-2 rounded-3 px-1.5 py-1 text-11 font-mono resize-none outline-none w-full"
          />
        </div>
      )}

      <SectionTitle>Tipografía</SectionTitle>

      <Row label="Fuente">
        <TextInput value={el.fontFamily} onChange={(v) => up({ fontFamily: v })} />
      </Row>

      <div className="flex items-center gap-2">
        <span className="text-ink-2 shrink-0 w-[52px] text-right text-[10px]">Tamaño</span>
        <NumberInput value={el.fontSize} onChange={(v) => up({ fontSize: v })} min={1} step={0.5} unit="pt" />
        <NumberInput value={el.lineHeight} onChange={(v) => up({ lineHeight: v })} min={0.5} step={0.05} unit="×" />
      </div>

      <Row label="Peso">
        <IconToggleGroup
          value={el.fontWeight >= 700 ? 'bold' : 'normal'}
          onChange={(v) => up({ fontWeight: v === 'bold' ? 700 : 400 })}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'bold', label: 'Negrita' },
          ]}
        />
      </Row>

      <Row label="Estilo">
        <IconToggleGroup
          value={el.fontStyle}
          onChange={(v) => up({ fontStyle: v })}
          options={[
            { value: 'normal', label: 'Normal' },
            { value: 'italic', label: 'Cursiva' },
          ]}
        />
      </Row>

      <Row label="Alineación">
        <IconToggleGroup
          value={el.align}
          onChange={(v) => up({ align: v })}
          options={ALIGN_OPTIONS as unknown as { value: TextEl['align']; label: string; title: string }[]}
        />
      </Row>

      <Row label="Decoración">
        <IconToggleGroup
          value={el.textDecoration ?? ''}
          onChange={(v) => up({ textDecoration: v === '' ? undefined : (v as TextEl['textDecoration']) })}
          options={DECO_OPTIONS as unknown as { value: string; label: string; title: string }[]}
        />
      </Row>

      <Row label="Color">
        <ColorInput value={el.color} onChange={(v) => up({ color: v })} />
      </Row>
    </>
  );
}
