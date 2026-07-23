import { useDocumentStore } from '@/store/documentStore';
import type { FlowableEl } from '@/types/document';
import { SectionTitle, Row, ColorInput, NumberInput, SelectInput } from '../shared';

interface Props {
  el: FlowableEl;
}

const FLOW_TYPES: { value: FlowableEl['flowType']; label: string }[] = [
  { value: 'content', label: 'Contenido' },
  { value: 'paragraph', label: 'Párrafo' },
  { value: 'spacer', label: 'Espaciador' },
  { value: 'table', label: 'Tabla' },
  { value: 'image', label: 'Imagen' },
];

export default function FlowableProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<FlowableEl>) => updateElement(el.id, patch);

  return (
    <>
      <SectionTitle>Sub-área (Flowable)</SectionTitle>

      <Row label="Tipo">
        <SelectInput
          value={el.flowType}
          onChange={(v) => up({ flowType: v })}
          options={FLOW_TYPES}
        />
      </Row>

      <Row label="Relleno">
        <ColorInput value={el.fill} onChange={(v) => up({ fill: v })} allowTransparent />
      </Row>

      <Row label="Trazo">
        <ColorInput value={el.stroke} onChange={(v) => up({ stroke: v })} />
      </Row>

      <Row label="Grosor">
        <NumberInput value={el.strokeWidth} onChange={(v) => up({ strokeWidth: v })} min={0} step={0.1} unit="mm" />
      </Row>

      <div className="mt-1 text-[10px] text-muted">
        Frame: {el.frameId}
      </div>
    </>
  );
}
