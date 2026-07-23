import TitleBar from './TitleBar';
import MenuBar from './MenuBar';
import FormatToolbar from './FormatToolbar';
import StatusBar from './StatusBar';
import LeftRail from './LeftRail';
import LeftPanel from './LeftPanel';
import Canvas from '@/features/canvas/Canvas';
import PdfPreviewModal from '@/features/canvas/PdfPreviewModal';
import { useUIStore } from '@/store/uiStore';

/**
 * Grid 5 filas × 3 columnas (según README):
 *   rows:    30px 34px 38px 1fr 24px
 *   cols:    44px 240px 1fr
 */
export default function AppShell() {
  const showFormat = useUIStore((s) => s.panels.formatToolbar);
  const showRail = useUIStore((s) => s.panels.leftRail);
  const showLeft = useUIStore((s) => s.panels.leftPanel);
  const showStatus = useUIStore((s) => s.panels.statusBar);

  return (
    <div
      className="h-screen w-screen bg-bg-0 text-ink overflow-hidden"
      style={{
        display: 'grid',
        gridTemplateRows: `30px 34px ${showFormat ? '38px' : '0px'} 1fr ${showStatus ? '24px' : '0px'}`,
        gridTemplateColumns: `${showRail ? '44px' : '0px'} ${showLeft ? '240px' : '0px'} 1fr`,
      }}
    >
      {/* Row 1: TitleBar (full width) */}
      <div style={{ gridRow: 1, gridColumn: '1 / -1' }} className="border-b border-line">
        <TitleBar />
      </div>

      {/* Row 2: MenuBar (full width) */}
      <div style={{ gridRow: 2, gridColumn: '1 / -1' }} className="border-b border-line">
        <MenuBar />
      </div>

      {/* Row 3: FormatToolbar (full width) */}
      {showFormat && (
        <div style={{ gridRow: 3, gridColumn: '1 / -1' }} className="border-b border-line">
          <FormatToolbar />
        </div>
      )}

      {/* Row 4: Main — 3 columnas */}
      {showRail && (
        <div style={{ gridRow: 4, gridColumn: 1 }} className="border-r border-line bg-bg-1 min-h-0 overflow-hidden">
          <LeftRail />
        </div>
      )}
      {showLeft && (
        <div style={{ gridRow: 4, gridColumn: 2 }} className="border-r border-line bg-bg-1 min-h-0 overflow-hidden">
          <LeftPanel />
        </div>
      )}
      <div style={{ gridRow: 4, gridColumn: showLeft ? 3 : showRail ? '2 / -1' : '1 / -1' }} className="min-h-0 overflow-hidden">
        <Canvas />
      </div>

      {/* Row 5: StatusBar */}
      {showStatus && (
        <div style={{ gridRow: 5, gridColumn: '1 / -1' }} className="border-t border-line">
          <StatusBar />
        </div>
      )}

      <PdfPreviewModal />
    </div>
  );
}
