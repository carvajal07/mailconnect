// ContextPanel.jsx — Panel contextual entre sidebar y canvas
import { useState } from 'react';
import { X, Pin, PinOff, Settings2, FileText, Box, LayoutTemplate, Crosshair, Type as TypeIcon, AlignLeft, Palette } from 'lucide-react';
import PagesConfigPanel      from '../properties/panels/PagesConfigPanel.jsx';
import PagePropertiesPanel   from '../properties/panels/PagePropertiesPanel.jsx';
import BorderStylePanel      from '../resources/border/BorderStylePanel.jsx';
import FillStylePanel        from '../resources/fill/FillStylePanel.jsx';
import ColorPanel            from '../resources/color/ColorPanel.jsx';
import TextStylePanel        from '../resources/text/TextStylePanel.jsx';
import ParagraphStylePanel   from '../resources/paragraph/ParagraphStylePanel.jsx';
import ContentAreaPanel      from '../resources/contentArea/ContentAreaPanel.jsx';
import ImageAssetPanel       from '../resources/image/ImageAssetPanel.jsx';
import TableStylePanel       from '../resources/tableStyle/TableStylePanel.jsx';
import BulletNumberingPanel  from '../resources/bulletNumbering/BulletNumberingPanel.jsx';
import ElementPanel          from '../properties/panels/ElementPanel.jsx';
import './ContextPanel.css';

// ── Icon map for element types ───────────────────────────────────────────────
const ELEMENT_TYPE_LABELS = {
  text:        'Texto',
  shape:       'Forma',
  image:       'Imagen',
  table:       'Tabla',
  contentarea: 'ContentArea',
  qr:          'QR',
  barcode:     'Barcode',
};

function getPanelMeta(panelContext, state) {
  const { pages, template, selectedIds, currentPageIndex, areaEditCtx, focusedAreaCtx } = state;
  if (!panelContext) return { title: '', Icon: Settings2 };

  if (panelContext === 'pagesConfig') return { title: 'Pages Config', Icon: Settings2 };

  if (panelContext.startsWith('page:')) {
    const pageId = panelContext.slice(5);
    const page   = pages?.find(p => p.id === pageId);
    return { title: page ? page.name : 'Página', Icon: FileText };
  }

  if (panelContext.startsWith('textStyle:')) {
    const styleId = panelContext.slice('textStyle:'.length);
    const style   = template?.styles?.text?.find(s => s.id === styleId);
    return { title: style ? style.name : 'Text Style', Icon: TypeIcon };
  }

  if (panelContext.startsWith('paragraphStyle:')) {
    const styleId = panelContext.slice('paragraphStyle:'.length);
    const style   = template?.styles?.paragraph?.find(s => s.id === styleId);
    return { title: style ? style.name : 'Paragraph Style', Icon: AlignLeft };
  }

  if (panelContext.startsWith('borderStyle:')) {
    const styleId = panelContext.slice('borderStyle:'.length);
    const style   = template?.styles?.border?.find(s => s.id === styleId);
    return { title: style ? style.name : 'Border Style', Icon: Box };
  }

  if (panelContext.startsWith('fillStyle:')) {
    const styleId = panelContext.slice('fillStyle:'.length);
    const style   = (template?.styles?.fill ?? []).find(s => s.id === styleId);
    return { title: style ? style.name : 'Fill Style', Icon: Palette };
  }

  if (panelContext.startsWith('tableStyle:')) {
    const styleId = panelContext.slice('tableStyle:'.length);
    const style   = (template?.styles?.table ?? []).find(s => s.id === styleId);
    return { title: style ? style.name : 'Table Style', Icon: Box };
  }

  if (panelContext.startsWith('bulletNumbering:')) {
    const bnId = panelContext.slice('bulletNumbering:'.length);
    const item = (template?.styles?.bulletNumbering ?? []).find(s => s.id === bnId);
    return { title: item ? item.name : 'Viñetas y numeración', Icon: AlignLeft };
  }

  if (panelContext.startsWith('color:')) {
    const colorId = panelContext.slice('color:'.length);
    const color   = (template?.colors ?? []).find(c => c.id === colorId);
    return { title: color ? color.name : 'Color', Icon: Palette };
  }

  if (panelContext.startsWith('contentArea:')) {
    const areaId = panelContext.slice('contentArea:'.length);
    const area   = (template?.contentAreas ?? []).find(a => a.id === areaId);
    return { title: area ? area.label : 'Content Area', Icon: LayoutTemplate };
  }

  if (panelContext.startsWith('imageAsset:')) {
    const assetId = panelContext.slice('imageAsset:'.length);
    const asset   = (template?.images ?? []).find(img => img.id === assetId);
    return { title: asset ? asset.name : 'Imagen', Icon: Palette };
  }

  if (panelContext === 'element') {
    // Check for area context first
    const areaCtx = focusedAreaCtx ?? areaEditCtx;
    if (areaCtx) {
      return { title: 'Área', Icon: LayoutTemplate };
    }
    // Normal element
    const currentPage = template?.pages?.[currentPageIndex];
    const el = (currentPage?.elements ?? []).find(e => e.id === selectedIds?.[0]);
    if (el) {
      return { title: ELEMENT_TYPE_LABELS[el.type] ?? el.type, Icon: Crosshair };
    }
    if (selectedIds?.length > 1) {
      return { title: `${selectedIds.length} elementos`, Icon: Crosshair };
    }
    return { title: 'Propiedades', Icon: Crosshair };
  }

  return { title: panelContext, Icon: Settings2 };
}

export default function ContextPanel({ state, availableFields }) {
  const { panelContext, setPanelContext, lastPanelContext } = state;
  const [pinned, setPinned] = useState(true);

  // When pinned, show last known context even if panelContext is null
  const effectiveContext = panelContext ?? (pinned ? lastPanelContext : null);
  if (!effectiveContext) return null;

  const { title, Icon } = getPanelMeta(effectiveContext, state);

  const isElement = effectiveContext === 'element';
  // Non-element panels always show X; element panel shows X only when unpinned
  const showClose = !isElement || !pinned;

  return (
    <div className="ctx-panel">
      <div className="ctx-panel__header">
        <Icon size={13} className="ctx-panel__icon" />
        <span className="ctx-panel__title">{title}</span>
        <button
          className={`ctx-panel__pin${pinned ? ' ctx-panel__pin--active' : ''}`}
          onClick={() => setPinned(p => !p)}
          title={pinned ? 'Desfijar panel' : 'Fijar panel'}
        >
          {pinned ? <Pin size={13} /> : <PinOff size={13} />}
        </button>
        {showClose && (
          <button className="ctx-panel__close" onClick={() => setPanelContext(null)} title="Cerrar">
            <X size={14} />
          </button>
        )}
      </div>
      <div className="ctx-panel__body">
        {effectiveContext === 'pagesConfig' && (
          <PagesConfigPanel state={state} availableFields={availableFields} />
        )}
        {effectiveContext.startsWith('page:') && (
          <PagePropertiesPanel state={state} availableFields={availableFields} />
        )}
        {effectiveContext.startsWith('textStyle:') && (
          <TextStylePanel state={state} />
        )}
        {effectiveContext.startsWith('paragraphStyle:') && (
          <ParagraphStylePanel state={state} />
        )}
        {effectiveContext.startsWith('borderStyle:') && (
          <BorderStylePanel state={state} />
        )}
        {effectiveContext.startsWith('fillStyle:') && (
          <FillStylePanel state={state} />
        )}
        {effectiveContext.startsWith('tableStyle:') && (
          <TableStylePanel state={state} />
        )}
        {effectiveContext.startsWith('bulletNumbering:') && (
          <BulletNumberingPanel state={state} />
        )}
        {effectiveContext.startsWith('color:') && (
          <ColorPanel state={state} availableFields={availableFields} />
        )}
        {effectiveContext.startsWith('imageAsset:') && (
          <ImageAssetPanel state={state} />
        )}
        {effectiveContext.startsWith('contentArea:') && (
          <ContentAreaPanel state={state} availableFields={availableFields} />
        )}
        {effectiveContext === 'element' && (
          <ElementPanel state={state} availableFields={availableFields} />
        )}
      </div>
    </div>
  );
}
