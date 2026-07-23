import { useDocumentStore } from '@/store/documentStore';
import type { FrameEl } from '@/types/document';
import { SectionTitle, Row, ColorInput, NumberInput } from '../shared';

interface Props {
  el: FrameEl;
}

export default function FrameProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<FrameEl>) => updateElement(el.id, patch);

  return (
    <>
      <SectionTitle>Área (Frame)</SectionTitle>

      <Row label="Relleno">
        <ColorInput value={el.fill} onChange={(v) => up({ fill: v })} allowTransparent />
      </Row>

      <Row label="Trazo">
        <ColorInput value={el.stroke} onChange={(v) => up({ stroke: v })} />
      </Row>

      <Row label="Grosor">
        <NumberInput value={el.strokeWidth} onChange={(v) => up({ strokeWidth: v })} min={0} step={0.1} unit="mm" />
      </Row>

      <Row label="Radio">
        <NumberInput value={el.cornerRadius} onChange={(v) => up({ cornerRadius: v })} min={0} step={0.5} unit="mm" />
      </Row>

      <SectionTitle>Padding</SectionTitle>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        <div className="flex items-center gap-2">
          <span className="text-ink-2 text-[10px] w-[52px] text-right">Arriba</span>
          <NumberInput
            value={el.padding.top}
            onChange={(v) => up({ padding: { ...el.padding, top: v } })}
            min={0} step={0.5} unit="mm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-2 text-[10px] w-[52px] text-right">Abajo</span>
          <NumberInput
            value={el.padding.bottom}
            onChange={(v) => up({ padding: { ...el.padding, bottom: v } })}
            min={0} step={0.5} unit="mm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-2 text-[10px] w-[52px] text-right">Izq.</span>
          <NumberInput
            value={el.padding.left}
            onChange={(v) => up({ padding: { ...el.padding, left: v } })}
            min={0} step={0.5} unit="mm"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-2 text-[10px] w-[52px] text-right">Der.</span>
          <NumberInput
            value={el.padding.right}
            onChange={(v) => up({ padding: { ...el.padding, right: v } })}
            min={0} step={0.5} unit="mm"
          />
        </div>
      </div>
    </>
  );
}
