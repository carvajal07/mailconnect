import { useCallback, useEffect, useRef, useState } from 'react';
import FormatToolbar from './FormatToolbar';
import StatusBar from './StatusBar';
import LeftRail from './LeftRail';
import LeftPanel from './LeftPanel';
import Canvas from '@/features/canvas/Canvas';
import PdfPreviewModal from '@/features/canvas/PdfPreviewModal';
import { useUIStore } from '@/store/uiStore';

const LEFT_MIN = 300;
const LEFT_MAX = 520;

/**
 * Layout del editor (flexbox):
 *
 *   ┌───────────────────────────────────────────────┐
 *   │ FormatToolbar (ancho completo)                 │
 *   ├──────┬──────────┬──┬───────────────────────────┤
 *   │ Left │ LeftPanel │▚▚│  Canvas                   │
 *   │ Rail │ (árbol +  │  │  ─────────────────────────│
 *   │ 44px │ propied.) │  │  StatusBar (dentro del    │
 *   │      │ ancho     │  │   marco del lienzo)       │
 *   └──────┴──────────┴──┴───────────────────────────┘
 *
 * - Sin MenuBar (Archivo/Editar/…): se quitó por decisión de producto.
 * - La StatusBar vive DENTRO de la columna del lienzo (no a ancho completo).
 * - El separador `▚▚` permite redimensionar el ancho del LeftPanel arrastrando
 *   (como el Diseñador PDF).
 */
export default function AppShell() {
  const showFormat = useUIStore((s) => s.panels.formatToolbar);
  const showRail = useUIStore((s) => s.panels.leftRail);
  const showLeft = useUIStore((s) => s.panels.leftPanel);
  const showStatus = useUIStore((s) => s.panels.statusBar);

  const [leftW, setLeftW] = useState(340);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.min(LEFT_MAX, Math.max(LEFT_MIN, d.startW + (e.clientX - d.startX)));
    setLeftW(next);
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }, [onDragMove]);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: leftW };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  };

  useEffect(() => () => {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }, [onDragMove, onDragEnd]);

  return (
    <div className="h-full w-full bg-bg-0 text-ink overflow-hidden flex flex-col">
      {/* FormatToolbar (ancho completo) */}
      {showFormat && (
        <div className="shrink-0 border-b border-line" style={{ height: 38 }}>
          <FormatToolbar />
        </div>
      )}

      {/* Fila principal */}
      <div className="flex-1 min-h-0 flex">
        {/* LeftRail */}
        {showRail && (
          <>
            <div className="shrink-0 bg-bg-1 overflow-hidden" style={{ width: 44 }}>
              <LeftRail />
            </div>
            {/* Separador (igual al que hay entre el panel y el lienzo, pero fijo) */}
            <div className="shrink-0 relative" style={{ width: 6, background: 'var(--bg-0)' }}>
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2"
                style={{ width: 2, background: 'var(--line-2)' }}
              />
            </div>
          </>
        )}

        {/* LeftPanel (redimensionable) */}
        {showLeft && (
          <>
            <div
              className="shrink-0 border-r border-line bg-bg-1 min-h-0 overflow-hidden"
              style={{ width: leftW }}
            >
              <LeftPanel />
            </div>
            {/* Separador arrastrable */}
            <div
              onMouseDown={startDrag}
              title="Arrastra para cambiar el ancho del panel"
              className="shrink-0 group relative"
              style={{ width: 6, cursor: 'col-resize', background: 'var(--bg-0)' }}
            >
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 transition-colors"
                style={{ width: 2, background: 'var(--line-2)' }}
              />
              <div
                className="absolute inset-y-0 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: 2, background: 'var(--accent)' }}
              />
            </div>
          </>
        )}

        {/* Columna del lienzo: Canvas + StatusBar (dentro del marco) */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-hidden">
            <Canvas />
          </div>
          {showStatus && (
            <div className="shrink-0 border-t border-line" style={{ height: 26 }}>
              <StatusBar />
            </div>
          )}
        </div>
      </div>

      <PdfPreviewModal />
    </div>
  );
}
