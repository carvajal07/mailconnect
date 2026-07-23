// editor/resources/ImageAssetPanel.jsx — Panel for image asset in ContextPanel

import ImageAssetEditor from './ImageAssetEditor.jsx';
import './ImageAssetEditor.css';
import '../fill/FillStylePanel.css';

export default function ImageAssetPanel({ state }) {
  const { panelContext, template, updateImageAsset, addImageAsset, setPanelContext, availableFields } = state;
  const assetId = panelContext?.slice('imageAsset:'.length);
  const asset   = (template?.images ?? []).find(img => img.id === assetId) ?? null;

  if (!asset) {
    return <p className="fsp__empty">Imagen no encontrada.</p>;
  }

  function handlePromoteToVariable() {
    const newId = addImageAsset?.({ kind: 'variable', defaultImageId: assetId });
    if (newId) setPanelContext?.('imageAsset:' + newId);
  }

  return (
    <div className="fsp">
      <ImageAssetEditor
        asset={asset}
        onChange={changes => updateImageAsset(assetId, changes)}
        availableFields={availableFields ?? []}
        allAssets={template?.images ?? []}
        onPromoteToVariable={handlePromoteToVariable}
      />
    </div>
  );
}
