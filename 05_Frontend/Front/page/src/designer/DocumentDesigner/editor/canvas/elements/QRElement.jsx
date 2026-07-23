// editor/canvas/elements/QRElement.jsx — QR code placeholder

import { QrCode } from 'lucide-react';
import './QRElement.css';

export default function QRElement({ element }) {
  const { value = '', valueSource = 'static' } = element;
  return (
    <div className="qre">
      <QrCode size={20} className="qre__icon" />
      <span className="qre__label">
        {valueSource === 'dynamic' ? (value || '{{campo}}') : (value || 'QR')}
      </span>
    </div>
  );
}
