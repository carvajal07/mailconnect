// StyleEditModal.jsx — Modal para editar el estilo de texto /
// párrafo / viñetas del área (o celda) sobre el que se hizo clic derecho.
//
// Semántica (fork-on-edit, NO fork-on-open):
//  - Se abre mostrando el estilo que el área usa ACTUALMENTE (default o propio).
//  - "Cancelar" → no cambia nada (cero copias).
//  - "Aplicar" sin cambios → no cambia nada.
//  - "Aplicar" con cambios:
//      · si el área usaba el DEFAULT (protegido) → crea/encuentra un estilo nuevo
//        con esos valores y lo asigna al área (el default nunca se muta).
//      · si el área ya tenía un estilo PROPIO → se edita en sitio (propaga).

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import TextStyleEditor from '../resources/text/TextStyleEditor.jsx';
import ParagraphStyleEditor from '../resources/paragraph/ParagraphStyleEditor.jsx';
import BulletNumberingEditor from '../resources/bulletNumbering/BulletNumberingEditor.jsx';
import { resolveTextStyle } from '../../engine/textStyleUtils.js';
import { resolveParagraphStyle } from '../../engine/paragraphStyleUtils.js';
import {
  createBulletNumbering, DEFAULT_TEXT_STYLE_ID, DEFAULT_PARAGRAPH_STYLE_ID,
} from '../../engine/elementFactory.js';
import {
  applyTextStyleToRange, applyParagraphStyleToRange, applyParagraphBlockStyles,
} from '../canvas/elements/selectionStyle.js';
import './StyleEditModal.css';

const TITLES = {
  text:      'Estilo de texto',
  paragraph: 'Estilo de párrafo',
  bullets:   'Viñetas y numeración',
};

function stripMeta(s) {
  if (!s) return {};
  const { id: _i, name: _n, isDefault: _d, ...rest } = s;
  return rest;
}

export default function StyleEditModal({ kind, state, area, persist, onClose, editorRef, savedRange }) {
  const { template } = state ?? {};
  const textStyles      = template?.styles?.text ?? [];
  const paragraphStyles = template?.styles?.paragraph ?? [];
  const bulletStyles    = template?.styles?.bulletNumbering ?? [];

  // Snapshot del estilo actual al abrir la modal (no recalcula durante la edición).
  const init = useMemo(() => {
    if (kind === 'text') {
      const id = area?.defaultTextStyleId ?? null;
      return { currentId: id, resolved: resolveTextStyle(id, textStyles) };
    }
    if (kind === 'paragraph') {
      const id = area?.paragraphStyleId ?? null;
      return { currentId: id, resolved: resolveParagraphStyle(id, paragraphStyles) };
    }
    // bullets: el recurso está referenciado por el estilo de párrafo del área.
    const psId = area?.paragraphStyleId ?? null;
    const ps   = paragraphStyles.find(s => s.id === psId);
    const bnId = ps?.bulletNumberingId ?? null;
    const resolved = bulletStyles.find(b => b.id === bnId) ?? createBulletNumbering();
    return { currentId: bnId, psId, resolved };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [draft, setDraft] = useState(() => ({ ...init.resolved }));
  const onChange = (changes) => setDraft(d => ({ ...d, ...changes }));

  const changed = JSON.stringify(stripMeta(init.resolved)) !== JSON.stringify(stripMeta(draft));

  // ¿Hay una selección/cursor del editor sobre el que aplicar SOLO a esa parte?
  const editor = editorRef?.current ?? null;
  const rangeInEditor = !!(savedRange && editor && editor.contains(savedRange.startContainer));
  const hasTextSelection = rangeInEditor && !savedRange.collapsed;

  function handleApply() {
    if (!changed) { onClose(); return; }
    const props = stripMeta(draft);

    if (kind === 'text') {
      // Selección de texto → aplicar SOLO a la selección (span inline), sin tocar el área.
      if (hasTextSelection) {
        state.findOrCreateTextStyle?.(init.currentId || DEFAULT_TEXT_STYLE_ID, props); // recurso (visible/reutilizable)
        applyTextStyleToRange(savedRange, draft, template?.styles?.fill ?? [], state?.zoom ?? 1);
        editor.focus();
        onClose();
        return;
      }
      const shared = !init.currentId || init.currentId === DEFAULT_TEXT_STYLE_ID;
      if (shared) {
        const newId = state.findOrCreateTextStyle?.(init.currentId || DEFAULT_TEXT_STYLE_ID, props);
        if (newId) persist?.({ defaultTextStyleId: newId });
      } else {
        state.updateTextStyle?.(init.currentId, props);
      }
    } else if (kind === 'paragraph') {
      // Cursor/selección dentro del editor → aplicar al/los párrafo(s) (por bloque).
      if (rangeInEditor) {
        const psId = state.findOrCreateParagraphStyle?.(init.currentId || DEFAULT_PARAGRAPH_STYLE_ID, props);
        if (psId) {
          applyParagraphStyleToRange(editor, savedRange, psId);
          applyParagraphBlockStyles(editor, template?.styles?.paragraph ?? [], state?.zoom ?? 1);
          editor.focus();
        }
        onClose();
        return;
      }
      const shared = !init.currentId || init.currentId === DEFAULT_PARAGRAPH_STYLE_ID;
      if (shared) {
        const newId = state.findOrCreateParagraphStyle?.(init.currentId || DEFAULT_PARAGRAPH_STYLE_ID, props);
        if (newId) persist?.({ paragraphStyleId: newId });
      } else {
        state.updateParagraphStyle?.(init.currentId, props);
      }
    } else { // bullets
      // Asegura un estilo de párrafo dedicado (forkea el default si hace falta).
      let psId = init.psId;
      if (!psId || psId === DEFAULT_PARAGRAPH_STYLE_ID) {
        psId = state.cloneParagraphStyle?.(psId || DEFAULT_PARAGRAPH_STYLE_ID);
        if (psId) persist?.({ paragraphStyleId: psId });
      }
      if (init.currentId) {
        state.updateBulletNumbering?.(init.currentId, props);
      } else {
        const bnId = state.addBulletNumbering?.(props);
        if (bnId && psId) state.updateParagraphStyle?.(psId, { bulletNumberingId: bnId });
      }
    }
    onClose();
  }

  return createPortal(
    <div
      className="sem-backdrop"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sem" onMouseDown={e => e.stopPropagation()}>
        <div className="sem__header">
          <span className="sem__title">{TITLES[kind] ?? 'Estilo'}</span>
          <button className="sem__close" onClick={onClose} title="Cerrar">✕</button>
        </div>

        <div className="sem__body">
          {kind === 'text' && (
            <TextStyleEditor
              style={draft}
              onChange={onChange}
              borderStyles={template?.styles?.border ?? []}
              lineStyles={template?.styles?.line ?? []}
              fillStyles={template?.styles?.fill ?? []}
              colors={template?.colors ?? []}
              onAddFillStyle={state.addFillStyle}
              onNavigateFillStyle={() => {}}
              customFonts={(template?.fonts ?? []).map(f => f.family)}
            />
          )}
          {kind === 'paragraph' && (
            <ParagraphStyleEditor
              style={draft}
              onChange={onChange}
              textStyles={template?.styles?.text ?? []}
              fillStyles={template?.styles?.fill ?? []}
              borderStyles={template?.styles?.border ?? []}
              onAddFillStyle={state.addFillStyle}
              onNavigateFillStyle={() => {}}
              onNavigateBorderStyle={() => {}}
            />
          )}
          {kind === 'bullets' && (
            <BulletNumberingEditor
              item={draft}
              onChange={onChange}
              availableFields={state?.availableFields ?? []}
              colors={template?.colors ?? []}
            />
          )}
        </div>

        <div className="sem__footer">
          <button className="sem__btn" onClick={onClose}>Cancelar</button>
          <button className="sem__btn sem__btn--primary" onClick={handleApply}>Aplicar</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
