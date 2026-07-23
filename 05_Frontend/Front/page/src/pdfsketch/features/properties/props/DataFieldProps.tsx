import { useDocumentStore } from '@/store/documentStore';
import type { DataFieldEl } from '@/types/document';
import { SectionTitle, Row, TextInput, ColorInput, NumberInput } from '../shared';

interface Props {
  el: DataFieldEl;
}

export default function DataFieldProps({ el }: Props) {
  const updateElement = useDocumentStore((s) => s.updateElement);
  const up = (patch: Partial<DataFieldEl>) => updateElement(el.id, patch);

  return (
    <>
      <SectionTitle>Campo de datos</SectionTitle>

      <Row label="Variable">
        <TextInput value={el.binding} onChange={(v) => up({ binding: v })} placeholder="nombre.campo" />
      </Row>

      <Row label="Fallback">
        <TextInput value={el.fallback} onChange={(v) => up({ fallback: v })} placeholder="Texto por defecto" />
      </Row>

      <SectionTitle>Tipografía</SectionTitle>

      <Row label="Fuente">
        <TextInput value={el.fontFamily} onChange={(v) => up({ fontFamily: v })} />
      </Row>

      <Row label="Tamaño">
        <NumberInput value={el.fontSize} onChange={(v) => up({ fontSize: v })} min={1} step={0.5} unit="pt" />
      </Row>

      <Row label="Color">
        <ColorInput value={el.color} onChange={(v) => up({ color: v })} />
      </Row>
    </>
  );
}
