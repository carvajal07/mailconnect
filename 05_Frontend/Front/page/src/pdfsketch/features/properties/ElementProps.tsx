import { useMemo } from 'react';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import type { BaseEl, ElementModel } from '@/types/document';
import { SectionTitle, round } from './shared';
import ShapeProps from './props/ShapeProps';
import TextProps from './props/TextProps';
import ImageProps from './props/ImageProps';
import LineProps from './props/LineProps';
import QrProps from './props/QrProps';
import DataFieldProps from './props/DataFieldProps';
import TableProps from './props/TableProps';
import FrameProps from './props/FrameProps';
import FlowableProps from './props/FlowableProps';

type NumKey = 'x' | 'y' | 'width' | 'height' | 'rotation';
type BoolKey = 'visible' | 'locked';

export default function ElementProps() {
  const pages = useDocumentStore((s) => s.doc.pages);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  const selected = useMemo<ElementModel[]>(() => {
    if (selectedIds.length === 0) return [];
    const idSet = new Set(selectedIds);
    return pages.flatMap((p) => p.elements).filter((e) => idSet.has(e.id));
  }, [pages, selectedIds]);

  if (selected.length === 0) return null;

  const commonNum = (k: NumKey): number | undefined => {
    const first = selected[0][k];
    return selected.every((e) => e[k] === first) ? (first as number) : undefined;
  };
  const commonBool = (k: BoolKey): boolean | undefined => {
    const first = selected[0][k];
    return selected.every((e) => e[k] === first) ? (first as boolean) : undefined;
  };
  const applyNum = (k: NumKey, v: number) => {
    for (const el of selected) updateElement(el.id, { [k]: v } as Partial<BaseEl>);
  };
  const applyBool = (k: BoolKey, v: boolean) => {
    for (const el of selected) updateElement(el.id, { [k]: v } as Partial<BaseEl>);
  };

  const allSameType = selected.every((e) => e.type === selected[0].type);
  const singleEl = selected.length === 1 ? selected[0] : null;
  const typeEl = allSameType ? selected[0] : null;

  return (
    <div className="flex flex-col gap-2">

      {/* ── Posición y tamaño ── */}
      <SectionTitle>Posición y tamaño</SectionTitle>

      {/* Fila X / Y */}
      <div className="grid grid-cols-2 gap-x-2">
        <NumField label="X" unit="mm" value={commonNum('x')} onCommit={(v) => applyNum('x', v)} />
        <NumField label="Y" unit="mm" value={commonNum('y')} onCommit={(v) => applyNum('y', v)} />
      </div>

      {/* Fila Ancho / Alto */}
      <div className="grid grid-cols-2 gap-x-2">
        <NumField label="Ancho" unit="mm" min={0.5} value={commonNum('width')} onCommit={(v) => applyNum('width', v)} />
        <NumField label="Alto" unit="mm" min={0.5} value={commonNum('height')} onCommit={(v) => applyNum('height', v)} />
      </div>

      {/* Rotación — fila completa */}
      <NumField label="Rotación" unit="°" step={1} value={commonNum('rotation')} onCommit={(v) => applyNum('rotation', v)} />

      {/* ── Propiedades específicas del tipo ── */}
      {singleEl && typeEl && renderTypeProps(typeEl)}

      {/* ── Estado ── */}
      <SectionTitle>Estado</SectionTitle>
      <div className="flex gap-2">
        <ToggleBtn
          label={commonBool('visible') === false ? 'Oculto' : 'Visible'}
          icon={commonBool('visible') === false ? EyeOff : Eye}
          active={commonBool('visible') !== false}
          mixed={commonBool('visible') === undefined}
          onClick={() => applyBool('visible', !(commonBool('visible') ?? true))}
        />
        <ToggleBtn
          label={commonBool('locked') ? 'Bloqueado' : 'Libre'}
          icon={commonBool('locked') ? Lock : Unlock}
          active={commonBool('locked') === true}
          mixed={commonBool('locked') === undefined}
          onClick={() => applyBool('locked', !(commonBool('locked') ?? false))}
        />
      </div>
    </div>
  );
}

function renderTypeProps(el: ElementModel) {
  switch (el.type) {
    case 'rect':
    case 'circle':
      return <ShapeProps el={el} />;
    case 'text':
      return <TextProps el={el} />;
    case 'image':
      return <ImageProps el={el} />;
    case 'line':
    case 'pen':
      return <LineProps el={el} />;
    case 'qr':
      return <QrProps el={el} />;
    case 'dataField':
      return <DataFieldProps el={el} />;
    case 'table':
      return <TableProps el={el} />;
    case 'frame':
      return <FrameProps el={el} />;
    case 'flowable':
      return <FlowableProps el={el} />;
    default:
      return null;
  }
}

/* ─── NumField: label encima, input abajo ─── */

interface NumFieldProps {
  label: string;
  unit?: string;
  value: number | undefined;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
}

function NumField({ label, unit, value, onCommit, step = 0.1, min }: NumFieldProps) {
  const display = value === undefined ? '' : round(value).toString();
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted leading-none">{label}</span>
      <div
        className="h-[26px] flex items-center rounded-3 px-2 gap-1 border"
        style={{ background: 'var(--bg-2)', borderColor: 'var(--line-2)' }}
      >
        <input
          type="number"
          step={step}
          {...(min !== undefined ? { min } : {})}
          className="bg-transparent flex-1 font-mono text-11 outline-none min-w-0"
          style={{ color: 'var(--ink)' }}
          placeholder="—"
          value={display}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value === '' || Number.isNaN(v)) return;
            if (min !== undefined && v < min) return;
            onCommit(v);
          }}
        />
        {unit && (
          <span className="text-[10px] shrink-0" style={{ color: 'var(--muted)' }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── ToggleBtn ─── */

function ToggleBtn({
  label, icon: Icon, active, mixed, onClick,
}: {
  label: string; icon: typeof Eye; active: boolean; mixed: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[26px] px-2 flex items-center gap-1.5 rounded-3 border hover:bg-bg-3 flex-1"
      style={
        active
          ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-dim)' }
          : mixed
            ? { color: 'var(--muted)', borderColor: 'var(--line-2)' }
            : { color: 'var(--ink-2)', borderColor: 'var(--line-2)' }
      }
      title={mixed ? `${label} (valores mixtos)` : label}
    >
      <Icon size={12} />
      <span className="text-11">{mixed ? '—' : label}</span>
    </button>
  );
}
