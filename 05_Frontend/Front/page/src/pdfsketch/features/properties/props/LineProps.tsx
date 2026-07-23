import { useDocumentStore } from '@/store/documentStore';
import type { LineEl, PenEl } from '@/types/document';
import { SectionTitle, Row, ColorInput, NumberInput } from '../shared';

type LineOrPen = LineEl | PenEl;

interface Props {
  el: LineOrPen;
}

export default function LineProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<LineOrPen>) => updateElement(el.id, patch as never);

  const hasDash = el.type === 'line' && Array.isArray((el as LineEl).dash) && (el as LineEl).dash!.length > 0;

  return (
    <>
      <SectionTitle>Trazo</SectionTitle>

      <Row label="Color">
        <ColorInput value={el.stroke} onChange={(v) => up({ stroke: v })} />
      </Row>

      <Row label="Grosor">
        <NumberInput
          value={el.strokeWidth}
          onChange={(v) => up({ strokeWidth: v })}
          min={0}
          step={0.1}
          unit="mm"
        />
      </Row>

      {el.type === 'line' && (
        <div className="flex items-center gap-2">
          <input
            id="line-dash"
            type="checkbox"
            checked={hasDash}
            onChange={(e) =>
              up({ dash: e.target.checked ? [4, 4] : undefined } as Partial<LineEl>)
            }
            className="accent-[color:var(--accent)]"
          />
          <label htmlFor="line-dash" className="text-ink-2 text-[10px] cursor-pointer select-none">
            Línea discontinua
          </label>
        </div>
      )}

      {el.type === 'pen' && (
        <Row label="Tensión">
          <NumberInput
            value={(el as PenEl).tension}
            onChange={(v) => up({ tension: Math.min(1, Math.max(0, v)) } as Partial<PenEl>)}
            min={0}
            max={1}
            step={0.05}
          />
        </Row>
      )}
    </>
  );
}
