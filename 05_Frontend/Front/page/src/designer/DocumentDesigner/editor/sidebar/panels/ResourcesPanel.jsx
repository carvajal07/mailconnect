import { Box, Images, Minus, Hash, Anchor, Braces, Table, List } from 'lucide-react';
import { ResourceSection } from '../components/ResourceSection.jsx';
import { TextStyleResourceSection } from '../sections/TextStyleResourceSection.jsx';
import { ParagraphStyleResourceSection } from '../sections/ParagraphStyleResourceSection.jsx';
import { FillStyleResourceSection } from '../sections/FillStyleResourceSection.jsx';
import { ContentAreaResourceSection } from '../sections/ContentAreaResourceSection.jsx';
import { ColorResourceSection } from '../sections/ColorResourceSection.jsx';
import { AreasResourceSection } from '../sections/AreasResourceSection.jsx';
import { TablasResourceSection } from '../sections/TablasResourceSection.jsx';
import { RowSetsResourceSection } from '../sections/RowSetsResourceSection.jsx';
import { CeldasResourceSection } from '../sections/CeldasResourceSection.jsx';
import FontResourceSection from '../../resources/font/FontResourceSection.jsx';

export function ResourcesPanel({ template, state, expandedSection, expandTick }) {
  return (
    <div className="dsb-section">
      <ColorResourceSection state={state} forceOpen={expandedSection === 'colors'} expandTick={expandTick} />
      <TextStyleResourceSection     state={state} forceOpen={expandedSection === 'textStyles'}      expandTick={expandTick} />
      <ParagraphStyleResourceSection state={state} forceOpen={expandedSection === 'paragraphStyles'} expandTick={expandTick} />
      <ResourceSection
        icon={List} label="Viñetas y numeración" items={template?.styles?.bulletNumbering} empty="Sin viñetas/numeración"
        onAdd={() => { const id = state.addBulletNumbering?.(); if (id) state.setPanelContext?.('bulletNumbering:' + id); }}
        onRemove={state.removeBulletNumbering}
        onSelect={id => state.setPanelContext?.('bulletNumbering:' + id)}
        onClone={id => { const newId = state.cloneBulletNumbering?.(id); if (newId) state.setPanelContext?.('bulletNumbering:' + newId); }}
        onRenameItem={(id, name) => state.updateBulletNumbering?.(id, { name })}
        selectedId={state.panelContext?.startsWith('bulletNumbering:') ? state.panelContext.slice('bulletNumbering:'.length) : null}
        forceOpen={expandedSection === 'bulletNumbering'} expandTick={expandTick}
      />
      <ResourceSection
        icon={Box} label="Border Styles" items={template?.styles?.border} empty="Sin border styles"
        onAdd={() => { const id = state.addBorderStyle?.(); if (id) state.setPanelContext?.('borderStyle:' + id); }}
        onRemove={state.removeBorderStyle}
        onSelect={id => state.setPanelContext?.('borderStyle:' + id)}
        onClone={id => { const newId = state.cloneBorderStyle?.(id); if (newId) state.setPanelContext?.('borderStyle:' + newId); }}
        onRenameItem={(id, name) => state.updateBorderStyle?.(id, { name })}
        selectedId={state.panelContext?.startsWith('borderStyle:') ? state.panelContext.slice('borderStyle:'.length) : null}
        forceOpen={expandedSection === 'borderStyles'} expandTick={expandTick}
      />
      <ResourceSection
        icon={Table} label="Table Styles" items={template?.styles?.table} empty="Sin table styles"
        onAdd={() => { const id = state.addTableStyle?.(); if (id) state.setPanelContext?.('tableStyle:' + id); }}
        onRemove={state.removeTableStyle}
        onSelect={id => state.setPanelContext?.('tableStyle:' + id)}
        onClone={id => { const newId = state.cloneTableStyle?.(id); if (newId) state.setPanelContext?.('tableStyle:' + newId); }}
        onRenameItem={(id, name) => state.updateTableStyle?.(id, { name })}
        selectedId={state.panelContext?.startsWith('tableStyle:') ? state.panelContext.slice('tableStyle:'.length) : null}
        forceOpen={expandedSection === 'tableStyles'} expandTick={expandTick}
      />
      <TablasResourceSection      state={state} forceOpen={expandedSection === 'tablas'}       expandTick={expandTick} />
      <RowSetsResourceSection     state={state} forceOpen={expandedSection === 'rowSets'}      expandTick={expandTick} />
      <CeldasResourceSection      state={state} forceOpen={expandedSection === 'celdas'}       expandTick={expandTick} />
      <ContentAreaResourceSection state={state} forceOpen={expandedSection === 'contentAreas'} expandTick={expandTick} />
      <AreasResourceSection       state={state} forceOpen={expandedSection === 'areas'}        expandTick={expandTick} />
      <FillStyleResourceSection   state={state} forceOpen={expandedSection === 'fillStyles'}   expandTick={expandTick} />
      <ResourceSection
        icon={Images} label="Imágenes" items={template?.images} empty="Sin imágenes"
        onAdd={() => { const id = state.addImageAsset?.({ kind: 'static' }); if (id) state.setPanelContext?.('imageAsset:' + id); }}
        headerActions={[
          { label: 'Insertar imagen',          Icon: Images, onClick: () => { const id = state.addImageAsset?.({ kind: 'static' });   if (id) state.setPanelContext?.('imageAsset:' + id); } },
          { label: 'Insertar imagen variable',  Icon: Braces, onClick: () => { const id = state.addImageAsset?.({ kind: 'variable' }); if (id) state.setPanelContext?.('imageAsset:' + id); } },
        ]}
        onRemove={state.removeImageAsset}
        onSelect={id => state.setPanelContext?.('imageAsset:' + id)}
        onRenameItem={(id, name) => state.updateImageAsset?.(id, { name })}
        onDragStart={(item, e) => {
          e.dataTransfer.setData('application/x-image-asset', item.id);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        getItemBadge={item => item.assetKind === 'variable'
          ? <span className="dsb-var-badge">var</span>
          : null
        }
        selectedId={state.panelContext?.startsWith('imageAsset:') ? state.panelContext.slice('imageAsset:'.length) : null}
        forceOpen={expandedSection === 'images'} expandTick={expandTick}
      />
      <FontResourceSection state={state} forceOpen={expandedSection === 'fonts'} expandTick={expandTick} />
      <ResourceSection icon={Minus}  label="Line Styles" items={template?.styles?.line} empty="Sin line styles" forceOpen={expandedSection === 'lineStyles'} expandTick={expandTick} />
      <ResourceSection icon={Images} label="Assets"      items={template?.assets}       empty="Sin assets"      forceOpen={expandedSection === 'assets'}     expandTick={expandTick} />
      <ResourceSection icon={Anchor} label="Anchors"     items={template?.anchors}      empty="Sin anchors"     forceOpen={expandedSection === 'anchors'}    expandTick={expandTick} />
    </div>
  );
}
