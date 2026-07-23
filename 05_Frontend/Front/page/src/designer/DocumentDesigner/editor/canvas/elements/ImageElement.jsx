// editor/canvas/elements/ImageElement.jsx — Image / placeholder element

import { Image as ImageIcon } from 'lucide-react';
import './ImageElement.css';

function resolveAssetSource(assetId, images = []) {
  const asset = images.find(a => a.id === assetId);
  if (!asset?.source) return null;
  const s = asset.source;
  if (s.kind === 'base64') return { url: s.data, mimeType: s.mimeType };
  if (s.kind === 'static' || s.kind === 'localFile') return { url: s.url };
  return null;
}

export default function ImageElement({ element, images = [] }) {
  const { source = {}, fit = 'contain' } = element;

  if (source.kind === 'asset' && source.assetId) {
    const asset = images.find(a => a.id === source.assetId);
    const resolved = asset?.source ? resolveAssetSource(source.assetId, images) : null;

    // Variable asset: show sample image as design-time preview
    let sampleResolved = null;
    if (!resolved && asset?.variableConfig) {
      const vc = asset.variableConfig;
      const fallbackId = vc.sampleImageId || vc.defaultImageId;
      if (fallbackId) sampleResolved = resolveAssetSource(fallbackId, images);
    }

    const displayResolved = resolved ?? sampleResolved;

    if (displayResolved?.url) {
      return (
        <div className="ime" style={{ position: 'relative' }}>
          <img
            src={displayResolved.url}
            alt=""
            className="ime__img"
            style={{ objectFit: fit }}
            draggable={false}
          />
          {sampleResolved && !resolved && <span className="ime__sample-badge">MUESTRA</span>}
        </div>
      );
    }
    return (
      <div className="ime ime--placeholder">
        <ImageIcon size={20} className="ime__icon" />
        <span className="ime__label">
          {asset?.variableConfig ? 'Imagen variable' : 'Sin imagen'}
        </span>
      </div>
    );
  }

  if (source.kind === 'static' && source.url) {
    return (
      <div className="ime">
        <img
          src={source.url}
          alt=""
          className="ime__img"
          style={{ objectFit: fit }}
          draggable={false}
        />
      </div>
    );
  }

  if (source.kind === 'base64' && source.data) {
    return (
      <div className="ime">
        <img
          src={source.data}
          alt=""
          className="ime__img"
          style={{ objectFit: fit }}
          draggable={false}
        />
      </div>
    );
  }

  if (source.kind === 'localFile' && source.url) {
    return (
      <div className="ime">
        <img
          src={source.url}
          alt=""
          className="ime__img"
          style={{ objectFit: fit }}
          draggable={false}
        />
      </div>
    );
  }

  // placeholder / dynamic
  const isDynamic = source.kind === 'dynamic';
  return (
    <div className="ime ime--placeholder">
      <ImageIcon size={20} className="ime__icon" />
      <span className="ime__label">
        {isDynamic ? (source.field || 'Imagen dinámica') : 'Imagen'}
      </span>
    </div>
  );
}
