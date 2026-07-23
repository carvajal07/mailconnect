// editor/canvas/elements/ElementRenderer.jsx — Routes element type to component
import './ElementRenderer.css';

import ShapeElement     from './ShapeElement.jsx';
import ImageElement     from './ImageElement.jsx';
import TableElement     from './TableElement.jsx';
import QRElement           from './QRElement.jsx';
import BarcodeElement      from './BarcodeElement.jsx';
import ChartElement         from './ChartElement.jsx';
import ContentAreaElement  from './ContentAreaElement.jsx';

const MAP = {
  shape:       ShapeElement,
  image:       ImageElement,
  table:       TableElement,
  contentarea: ContentAreaElement,
  qr:          QRElement,
  barcode:     BarcodeElement,
  chart:       ChartElement,
};

export default function ElementRenderer({ element, state }) {
  const Component = MAP[element.type];
  if (!Component) {
    return (
      <div className="element-renderer--unknown">
        {element.type}?
      </div>
    );
  }
  // ContentAreaElement needs state for updateArea + inline editing
  if (element.type === 'contentarea') {
    return <Component element={element} state={state} />;
  }
  if (element.type === 'image') {
    return <Component element={element} images={state?.template?.images ?? []} />;
  }
  if (element.type === 'table') {
    return <Component element={element} state={state} />;
  }
  if (element.type === 'barcode') {
    return <Component element={element} fillStyles={state?.template?.styles?.fill ?? []} textStyles={state?.template?.styles?.text ?? []} />;
  }
  if (element.type === 'shape') {
    return <Component
      element={element}
      fillStyles={state?.template?.styles?.fill ?? []}
      borderStyles={state?.template?.styles?.border ?? []}
      colors={state?.template?.colors ?? []}
      zoom={state?.zoom ?? 1}
    />;
  }
  if (element.type === 'chart') {
    return <Component element={element} state={state} />;
  }
  return <Component element={element} areaEditCtx={state?.areaEditCtx} showInvisibles={state?.showInvisibles} />;
}
