// SelectionBox.jsx — Rectángulo de selección múltiple (rubber band)
import './SelectionBox.css';

export default function SelectionBox({ rect }) {
  if (!rect) return null;
  const { x, y, width, height } = rect;
  // Normalizar para que funcione en cualquier dirección de drag
  const left   = Math.min(x, x + width);
  const top    = Math.min(y, y + height);
  const right  = Math.max(x, x + width);
  const bottom = Math.max(y, y + height);

  return (
    <div
      className="selection-box"
      style={{ left, top, width: right - left, height: bottom - top }}
    />
  );
}
