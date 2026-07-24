import { useDocumentStore } from '@/store/documentStore';
import type { CircleEl, RectEl, TriangleEl } from '@/types/document';
import { SectionTitle, Row, ColorInput, NumberInput, SliderRow } from '../shared';

type ShapeEl = RectEl | CircleEl | TriangleEl;

interface Props {
  el: ShapeEl;
}

export default function ShapeProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<ShapeEl>) => updateElement(el.id, patch as never);

  const opacity = (el as RectEl & { opacity?: number }).opacity ?? 1;

  return (
    <>
      <SectionTitle>Apariencia</SectionTitle>

      <Row label="Relleno">
        <ColorInput
          value={el.fill}
          onChange={(v) => up({ fill: v })}
          allowTransparent
        />
      </Row>

      <Row label="Trazo">
        <ColorInput
          value={el.stroke}
          onChange={(v) => up({ stroke: v })}
        />
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

      <div className="flex items-center gap-2">
        <input
          id="shape-dash"
          type="checkbox"
          checked={Array.isArray((el as { dash?: number[] }).dash) && ((el as { dash?: number[] }).dash?.length ?? 0) > 0}
          onChange={(e) => up({ dash: e.target.checked ? [2, 2] : undefined } as never)}
          className="accent-[color:var(--accent)]"
        />
        <label htmlFor="shape-dash" className="text-ink-2 text-[10px] cursor-pointer select-none">
          Borde discontinuo
        </label>
      </div>

      {el.type === 'rect' && (
        <Row label="Esquinas">
          <NumberInput
            value={(el as RectEl).cornerRadius}
            onChange={(v) => up({ cornerRadius: v } as Partial<RectEl>)}
            min={0}
            step={0.5}
            unit="mm"
          />
        </Row>
      )}

      <SliderRow
        label="Opacidad"
        value={Math.round(opacity * 100)}
        onChange={(v) => up({ opacity: v / 100 } as never)}
        unit="%"
      />
    </>
  );
}
