// editor/resources/colorUtils.jsx — Shared CMYK helpers used across style editors

import { useState, useEffect, useRef } from 'react';
import './colorUtils.css';

export function hexToCmyk(hex) {
  if (!hex || hex.length < 7) return { c: 0, m: 0, y: 0, k: 100 };
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const d = 1 - k;
  return {
    c: Math.round(((1 - r - k) / d) * 100),
    m: Math.round(((1 - g - k) / d) * 100),
    y: Math.round(((1 - b - k) / d) * 100),
    k: Math.round(k * 100),
  };
}

export function cmykToHex(c, m, y, k) {
  const r = Math.round(255 * (1 - c / 100) * (1 - k / 100));
  const g = Math.round(255 * (1 - m / 100) * (1 - k / 100));
  const b = Math.round(255 * (1 - y / 100) * (1 - k / 100));
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

export function CmykInputs({ hex, onCommit }) {
  const [cmyk, setCmyk] = useState(() => hexToCmyk(hex));
  const lastHexRef = useRef(hex);

  useEffect(() => {
    if (hex !== lastHexRef.current) {
      lastHexRef.current = hex;
      setCmyk(hexToCmyk(hex));
    }
  }, [hex]);

  function handleChange(key, raw) {
    const val = Math.max(0, Math.min(100, Number(raw) || 0));
    const next = { ...cmyk, [key]: val };
    setCmyk(next);
    const newHex = cmykToHex(next.c, next.m, next.y, next.k);
    lastHexRef.current = newHex;
    onCommit(newHex);
  }

  return (
    <div className="cmyk-row">
      {[['c','C'],['m','M'],['y','Y'],['k','K']].map(([key, label]) => (
        <div key={key} className="cmyk-row__field">
          <input
            type="number"
            className="cmyk-row__input"
            min={0} max={100}
            value={cmyk[key]}
            onChange={e => handleChange(key, e.target.value)}
          />
          <span className="cmyk-row__label">{label}</span>
        </div>
      ))}
    </div>
  );
}
