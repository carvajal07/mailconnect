import { useMemo } from 'react';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import type { BaseEl, ElementModel } from '@/types/document';

type NumKey = 'x' | 'y' | 'width' | 'height' | 'rotation';
type BoolKey = 'visible' | 'locked';

/**
 * Tab "Posición" del Inspector. Edita X, Y, ancho, alto, rotación,
 * visibilidad y lock de el/los elemento(s) seleccionado(s). Para
 * multi-selección muestra el valor común o vacío si difieren.
 */
export default function PositionTab() {
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
    return selected.every((e) => e[k] === first) ? first : undefined;
  };
  const commonBool = (k: BoolKey): boolean | undefined => {
    const first = selected[0][k];
    return selected.every((e) => e[k] === first) ? first : undefined;
  };

  const applyNum = (k: NumKey, v: number) => {
    for (const el of selected) updateElement(el.id, { [k]: v } as Partial<BaseEl>);
  };
  const applyBool = (k: BoolKey, v: boolean) => {
    for (const el of selected) updateElement(el.id, { [k]: v } as Partial<BaseEl>);
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>Posición y tamaño</SectionTitle>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <NumberRow
          label="X"
          unit="mm"
          value={commonNum('x')}
          onCommit={(v) => applyNum('x', v)}
        />
        <NumberRow
          label="Y"
          unit="mm"
          value={commonNum('y')}
          onCommit={(v) => applyNum('y', v)}
        />
        <NumberRow
          label="Ancho"
          unit="mm"
          min={1}
          value={commonNum('width')}
          onCommit={(v) => applyNum('width', v)}
        />
        <NumberRow
          label="Alto"
          unit="mm"
          min={1}
          value={commonNum('height')}
          onCommit={(v) => applyNum('height', v)}
        />
      </div>

      <SectionTitle>Transformación</SectionTitle>
      <NumberRow
        label="Rotar"
        unit="°"
        step={1}
        value={commonNum('rotation')}
        onCommit={(v) => applyNum('rotation', v)}
      />

      <SectionTitle>Estado</SectionTitle>
      <div className="flex gap-2">
        <ToggleButton
          label={commonBool('visible') === false ? 'Oculto' : 'Visible'}
          icon={commonBool('visible') === false ? EyeOff : Eye}
          active={commonBool('visible') !== false}
          mixed={commonBool('visible') === undefined}
          onClick={() => applyBool('visible', !(commonBool('visible') ?? true))}
        />
        <ToggleButton
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted border-b border-line-2 pb-1">
      {children}
    </div>
  );
}

interface NumberRowProps {
  label: string;
  unit?: string;
  value: number | undefined;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
}

function NumberRow({ label, unit, value, onCommit, step = 0.1, min }: NumberRowProps) {
  const display = value === undefined ? '' : round(value).toString();
  return (
    <label className="flex items-center gap-2">
      <span className="text-ink-2 w-10">{label}</span>
      <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1">
        <input
          type="number"
          step={step}
          {...(min !== undefined ? { min } : {})}
          className="bg-transparent w-full text-right font-mono text-11 outline-none"
          placeholder={value === undefined ? '—' : undefined}
          value={display}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (e.target.value === '' || Number.isNaN(v)) return;
            if (min !== undefined && v < min) return;
            onCommit(v);
          }}
        />
        {unit && <span className="text-muted text-11 ml-1">{unit}</span>}
      </div>
    </label>
  );
}

interface ToggleButtonProps {
  label: string;
  icon: typeof Eye;
  active: boolean;
  mixed: boolean;
  onClick: () => void;
}

function ToggleButton({ label, icon: Icon, active, mixed, onClick }: ToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[24px] px-2 flex items-center gap-1.5 rounded-3 border border-line-2 hover:bg-bg-3 flex-1"
      style={
        active
          ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
          : mixed
            ? { color: 'var(--muted)' }
            : { color: 'var(--ink-2)' }
      }
      title={mixed ? `${label} (valores mixtos)` : label}
    >
      <Icon size={12} />
      <span className="text-11">{mixed ? '—' : label}</span>
    </button>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
