import {
  MousePointer2,
  Hand,
  Type,
  Square,
  Circle,
  Slash,
  PenLine,
  Image,
  Table2,
  QrCode,
  LayoutTemplate,
} from 'lucide-react';
import { useToolStore, type Tool } from '@/store/toolStore';

const groups: { items: { icon: typeof Square; tool: Tool; label: string; shortcut: string }[] }[] =
  [
    {
      items: [
        { icon: MousePointer2, tool: 'select', label: 'Seleccionar', shortcut: 'V' },
        { icon: Hand, tool: 'hand', label: 'Mano / pan', shortcut: 'H' },
      ],
    },
    {
      items: [
        { icon: LayoutTemplate, tool: 'frame', label: 'Área (Frame)', shortcut: 'F' },
        { icon: Type, tool: 'text', label: 'Texto', shortcut: 'T' },
        { icon: Square, tool: 'rect', label: 'Rectángulo', shortcut: 'R' },
        { icon: Circle, tool: 'circle', label: 'Círculo', shortcut: 'O' },
        { icon: Slash, tool: 'line', label: 'Línea', shortcut: 'L' },
        { icon: PenLine, tool: 'pen', label: 'Lápiz', shortcut: 'P' },
      ],
    },
    {
      items: [
        { icon: Image, tool: 'image', label: 'Imagen', shortcut: 'I' },
        { icon: Table2, tool: 'table', label: 'Tabla', shortcut: '' },
        { icon: QrCode, tool: 'qr', label: 'QR', shortcut: '' },
      ],
    },
  ];

export default function LeftRail() {
  const active = useToolStore((s) => s.active);
  const setActive = useToolStore((s) => s.setActive);

  return (
    <div className="h-full flex flex-col items-center py-2 gap-1">
      {groups.map((g, gi) => (
        <div key={gi} className="flex flex-col items-center gap-1">
          {g.items.map(({ icon: Icon, tool, label, shortcut }) => {
            const isActive = active === tool;
            return (
              <button
                key={tool}
                type="button"
                title={shortcut ? `${label} (${shortcut})` : label}
                aria-label={label}
                onClick={() => setActive(tool)}
                className="w-8 h-8 rounded-3 flex items-center justify-center"
                style={
                  isActive
                    ? {
                        background: 'var(--accent-soft)',
                        color: 'var(--accent)',
                        border: '1px solid var(--accent-dim)',
                      }
                    : { color: 'var(--ink-2)' }
                }
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget.style.background = 'var(--bg-3)');
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget.style.background = 'transparent');
                }}
              >
                <Icon size={16} />
              </button>
            );
          })}
          {gi < groups.length - 1 && <div className="my-1 w-[22px] h-px bg-line-2" />}
        </div>
      ))}
    </div>
  );
}
