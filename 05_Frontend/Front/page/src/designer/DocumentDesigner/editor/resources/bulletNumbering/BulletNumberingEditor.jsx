// BulletNumberingEditor.jsx — Editor del recurso "Viñetas y numeración"
//
// Dos pestañas: Viñetas / Numeración. La pestaña activa define el `kind` efectivo
// del recurso ('bullet' | 'numbering'); el modo "Ninguna" dentro de cada pestaña
// equivale a kind='none'.

import { useState } from 'react';
import { DEFAULT_BULLET_CHARS, DEFAULT_NUMBER_FORMATS } from '../../../engine/elementFactory.js';
import VariableTreeSelect from '../../components/VariableTreeSelect.jsx';
import './BulletNumberingEditor.css';

function NumField({ label, value, onChange, disabled }) {
  return (
    <label className="bne-field">
      <span className="bne-field__label">{label}</span>
      <span className="bne-field__input-wrap">
        <input
          type="number"
          className="bne-field__input"
          value={value ?? 0}
          step="0.1"
          min="0"
          disabled={disabled}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
        />
        <span className="bne-field__unit">mm</span>
      </span>
    </label>
  );
}

export default function BulletNumberingEditor({ item, onChange, availableFields = [], colors = [], disabled = false }) {
  const initialTab = item.kind === 'numbering' ? 'numbering' : 'bullets';
  const [tab, setTab] = useState(initialTab);

  const set = (changes) => { if (!disabled) onChange(changes); };

  return (
    <div className="bne">
      <div className="bne__tabs">
        <button
          className={`bne__tab${tab === 'bullets' ? ' bne__tab--active' : ''}`}
          onClick={() => setTab('bullets')}
        >Viñetas</button>
        <button
          className={`bne__tab${tab === 'numbering' ? ' bne__tab--active' : ''}`}
          onClick={() => setTab('numbering')}
        >Numeración</button>
      </div>

      {tab === 'bullets' && (
        <div className="bne__body">
          <label className="bne-radio">
            <input type="radio" name="bulletMode" checked={item.bulletMode === 'none'}
              onChange={() => set({ kind: 'none', bulletMode: 'none' })} disabled={disabled} />
            <span>Ninguna</span>
          </label>

          <label className="bne-radio">
            <input type="radio" name="bulletMode" checked={item.bulletMode === 'default'}
              onChange={() => set({ kind: 'bullet', bulletMode: 'default' })} disabled={disabled} />
            <span>Viñetas por defecto</span>
          </label>
          <div className="bne-char-grid">
            {DEFAULT_BULLET_CHARS.map(ch => (
              <button
                key={ch}
                className={`bne-char${item.bulletMode === 'default' && item.bulletChar === ch ? ' bne-char--active' : ''}`}
                onClick={() => set({ kind: 'bullet', bulletMode: 'default', bulletChar: ch })}
                disabled={disabled}
              >{ch}</button>
            ))}
          </div>

          <label className="bne-radio">
            <input type="radio" name="bulletMode" checked={item.bulletMode === 'custom'}
              onChange={() => set({ kind: 'bullet', bulletMode: 'custom' })} disabled={disabled} />
            <span>Viñeta personalizada</span>
          </label>
          <input
            className="bne-text-input"
            value={item.bulletCustom ?? ''}
            placeholder="Carácter o texto…"
            disabled={disabled || item.bulletMode !== 'custom'}
            onChange={e => set({ kind: 'bullet', bulletMode: 'custom', bulletChar: e.target.value, bulletCustom: e.target.value })}
          />

          <div className="bne-row">
            <NumField label="Sangría viñeta" value={item.indent} disabled={disabled}
              onChange={v => set({ indent: v })} />
            <NumField label="Sangría texto" value={item.textIndent} disabled={disabled}
              onChange={v => set({ textIndent: v })} />
          </div>
        </div>
      )}

      {tab === 'numbering' && (
        <div className="bne__body">
          <label className="bne-radio">
            <input type="radio" name="numberMode" checked={item.numberMode === 'none'}
              onChange={() => set({ kind: 'none', numberMode: 'none' })} disabled={disabled} />
            <span>Ninguna</span>
          </label>

          <label className="bne-radio">
            <input type="radio" name="numberMode" checked={item.numberMode === 'variable'}
              onChange={() => set({ kind: 'numbering', numberMode: 'variable' })} disabled={disabled} />
            <span>Variable de numeración</span>
          </label>
          <VariableTreeSelect
            value={item.numberingVariable}
            disabled={disabled || item.numberMode !== 'variable'}
            onChange={p => set({ kind: 'numbering', numberMode: 'variable', numberingVariable: p })}
            fields={availableFields}
            accept={['number', 'integer', 'string']}
            placeholder="— Selecciona variable —"
            clearLabel="— Sin variable —"
          />

          <label className="bne-radio">
            <input type="radio" name="numberMode" checked={item.numberMode === 'default'}
              onChange={() => set({ kind: 'numbering', numberMode: 'default' })} disabled={disabled} />
            <span>Numeraciones por defecto</span>
          </label>
          <div className="bne-char-grid">
            {DEFAULT_NUMBER_FORMATS.map(fmt => (
              <button
                key={fmt}
                className={`bne-char bne-char--fmt${item.numberMode === 'default' && item.numberFormat === fmt ? ' bne-char--active' : ''}`}
                onClick={() => set({ kind: 'numbering', numberMode: 'default', numberFormat: fmt })}
                disabled={disabled}
              >{fmt}</button>
            ))}
          </div>

          <label className="bne-radio">
            <input type="radio" name="numberMode" checked={item.numberMode === 'custom'}
              onChange={() => set({ kind: 'numbering', numberMode: 'custom' })} disabled={disabled} />
            <span>Numeración personalizada</span>
          </label>
          <input
            className="bne-text-input"
            value={item.numberCustom ?? ''}
            placeholder="Patrón, p. ej. (0)"
            disabled={disabled || item.numberMode !== 'custom'}
            onChange={e => set({ kind: 'numbering', numberMode: 'custom', numberFormat: e.target.value, numberCustom: e.target.value })}
          />

          <div className="bne-row">
            <label className="bne-field">
              <span className="bne-field__label">Empieza en</span>
              <input type="number" className="bne-field__input" min="0" value={item.startAt ?? 1}
                disabled={disabled} onChange={e => set({ startAt: parseInt(e.target.value, 10) || 0 })} />
            </label>
            <label className="bne-field">
              <span className="bne-field__label">Tipo</span>
              <select className="bne-field__input" value={item.numberType ?? 'increment'}
                disabled={disabled} onChange={e => set({ numberType: e.target.value })}>
                <option value="increment">Incremental</option>
              </select>
            </label>
          </div>
          <div className="bne-row">
            <NumField label="Sangría número" value={item.indent} disabled={disabled}
              onChange={v => set({ indent: v })} />
            <NumField label="Sangría texto" value={item.textIndent} disabled={disabled}
              onChange={v => set({ textIndent: v })} />
          </div>
        </div>
      )}

      {/* Color del marcador — atado a la paleta de colores del documento */}
      <div className="bne__color-row">
        <span className="bne-field__label">Color del marcador</span>
        <select
          className="bne-select"
          value={item.colorId ?? ''}
          disabled={disabled}
          onChange={e => set({ colorId: e.target.value || null })}
        >
          <option value="">Heredar del texto</option>
          {colors.map(c => (
            <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
