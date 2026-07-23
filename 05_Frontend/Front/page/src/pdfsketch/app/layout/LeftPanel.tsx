import { useState } from 'react';
import { Database, Layers, Palette } from 'lucide-react';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import LayoutTree from '@/features/tree/LayoutTree';
import Inspector from '@/features/properties/Inspector';
import StylesPanel from '@/features/styles/StylesPanel';
import DataPanel from '@/features/data/DataPanel';

type Tab = 'layers' | 'styles' | 'data';

export default function LeftPanel() {
  const [tab, setTab] = useState<Tab>('layers');

  return (
    <div className="h-full flex flex-col">
      {/* ── Tab switcher ── */}
      <div
        className="h-8 shrink-0 flex items-center px-1 gap-0.5"
        style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-1)' }}
      >
        <TabBtn
          active={tab === 'layers'}
          icon={Layers}
          label="Capas"
          onClick={() => setTab('layers')}
        />
        <TabBtn
          active={tab === 'styles'}
          icon={Palette}
          label="Estilos"
          onClick={() => setTab('styles')}
        />
        <TabBtn
          active={tab === 'data'}
          icon={Database}
          label="Datos"
          onClick={() => setTab('data')}
        />
      </div>

      {/* ── Contenido según tab ── */}
      {tab === 'layers' && (
        <PanelGroup direction="vertical" autoSaveId="left-panel">
          <Panel defaultSize={55} minSize={20}>
            <div className="h-full flex flex-col">
              <SectionHeader title="Árbol de capas" />
              <div className="flex-1 min-h-0 overflow-auto">
                <LayoutTree />
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="h-px bg-line hover:bg-accent-dim transition-colors" />
          <Panel defaultSize={45} minSize={20}>
            <div className="h-full flex flex-col">
              <SectionHeader title="Propiedades" />
              <div className="flex-1 min-h-0 overflow-auto">
                <Inspector />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      )}

      {tab === 'styles' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <SectionHeader title="Estilos" />
          <div className="flex-1 min-h-0">
            <StylesPanel />
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <SectionHeader title="Datos" />
          <div className="flex-1 min-h-0">
            <DataPanel />
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active, icon: Icon, label, onClick,
}: {
  active: boolean;
  icon: typeof Layers;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 h-6 px-2.5 rounded text-11 transition-colors"
      style={
        active
          ? { background: 'var(--accent-soft)', color: 'var(--accent)', fontWeight: 600 }
          : { color: 'var(--ink-2)' }
      }
    >
      <Icon size={12} />
      {label}
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="h-7 px-2 flex items-center shrink-0" style={{ borderBottom: '1px solid var(--line-2)', background: 'var(--bg-2)' }}>
      <span className="text-11 font-semibold text-ink uppercase tracking-wide">{title}</span>
    </div>
  );
}
