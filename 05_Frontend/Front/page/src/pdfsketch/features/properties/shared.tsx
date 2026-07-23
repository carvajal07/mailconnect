/** Primitivos de UI reutilizables para paneles de propiedades. */

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted border-b border-line-2 pb-1 mt-2 first:mt-0">
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-2 shrink-0 w-[52px] text-right text-[10px]">{label}</span>
      {children}
    </div>
  );
}

interface NumberInputProps {
  value: number | undefined;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}

export function NumberInput({ value, onChange, step = 0.1, min, max, unit }: NumberInputProps) {
  const display = value === undefined ? '' : round(value).toString();
  return (
    <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1">
      <input
        type="number"
        step={step}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        className="bg-transparent w-full text-right font-mono text-11 outline-none"
        placeholder={value === undefined ? '—' : undefined}
        value={display}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value === '' || Number.isNaN(v)) return;
          if (min !== undefined && v < min) return;
          if (max !== undefined && v > max) return;
          onChange(v);
        }}
      />
      {unit && <span className="text-muted text-[10px] ml-1 shrink-0">{unit}</span>}
    </div>
  );
}

interface ColorInputProps {
  value: string;
  onChange: (v: string) => void;
  allowTransparent?: boolean;
}

export function ColorInput({ value, onChange, allowTransparent }: ColorInputProps) {
  const isTransparent = value === 'transparent';
  return (
    <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1 gap-1.5">
      <div className="relative w-5 h-4 rounded shrink-0 overflow-hidden border border-line-2">
        {isTransparent ? (
          <div className="w-full h-full" style={{ background: 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 6px 6px' }} />
        ) : (
          <>
            <div className="absolute inset-0 rounded" style={{ background: value }} />
            <input
              type="color"
              value={value.startsWith('#') ? value : '#000000'}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
          </>
        )}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent flex-1 font-mono text-11 outline-none min-w-0"
      />
      {allowTransparent && (
        <button
          type="button"
          title={isTransparent ? 'Con color' : 'Transparente'}
          className="text-muted hover:text-ink text-[10px] shrink-0"
          onClick={() => onChange(isTransparent ? '#000000' : 'transparent')}
        >
          {isTransparent ? '○' : '◉'}
        </button>
      )}
    </div>
  );
}

interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

export function TextInput({ value, onChange, placeholder }: TextInputProps) {
  return (
    <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 flex-1">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent w-full font-mono text-11 outline-none"
      />
    </div>
  );
}

interface SelectInputProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}

export function SelectInput<T extends string>({ value, onChange, options }: SelectInputProps<T>) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-[22px] bg-bg-3 border border-line-2 rounded-3 text-11 px-1.5 outline-none flex-1"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

interface SliderRowProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export function SliderRow({ label, value, onChange, min = 0, max = 100, step = 1, unit }: SliderRowProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-ink-2 shrink-0 w-[52px] text-right text-[10px]">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[color:var(--accent)] h-1"
      />
      <div className="h-[22px] flex items-center bg-bg-3 border border-line-2 rounded-3 px-1.5 w-14">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={round(value)}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
          className="bg-transparent w-full text-right font-mono text-11 outline-none"
        />
        {unit && <span className="text-muted text-[10px] ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

interface IconToggleGroupProps<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
}

export function IconToggleGroup<T extends string>({ value, onChange, options }: IconToggleGroupProps<T>) {
  return (
    <div className="flex gap-0.5 flex-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title ?? o.label}
          onClick={() => onChange(o.value)}
          className="flex-1 h-[22px] rounded-3 border text-11 flex items-center justify-center"
          style={
            value === o.value
              ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent-dim)' }
              : { borderColor: 'var(--line-2)', color: 'var(--ink-2)' }
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}
