// editor/resources/FontResourceSection.jsx — Custom font section (upload, rename, clone, delete)

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Type, Plus, Trash2, PenLine, Copy, Upload, ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
import { useDesignerAssets } from '../../DesignerUploadContext.js';
import AssetPickerModal from '../../components/AssetPickerModal.jsx';
import './FontResourceSection.css';

// ── Context menu (mirrors ResourceItemMenu from DesignerSidebar) ─────────────

function ItemMenu({ x, y, actions, onClose }) {
  useEffect(() => {
    const down = e => { if (!e.target.closest('.dsb-item-menu')) onClose(); };
    const key  = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown',   key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [onClose]);

  return createPortal(
    <div className="dsb-item-menu" style={{ position: 'fixed', top: y, left: x }}>
      {actions.map((a, i) => (
        <button
          key={i}
          className={`dsb-item-menu__action${a.danger ? ' dsb-item-menu__action--danger' : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { a.onClick(); onClose(); }}
        >
          {a.Icon && <a.Icon size={11} />}
          <span>{a.label}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

// ── File helpers ──────────────────────────────────────────────────────────────

function fileExtToFormat(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return { ttf: 'truetype', otf: 'opentype', woff: 'woff', woff2: 'woff2' }[ext] ?? 'truetype';
}

function nameFromFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FontResourceSection({ state, forceOpen, expandTick }) {
  const [open,       setOpen]       = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [itemMenu,   setItemMenu]   = useState(null);   // { id, x, y }
  const [headerMenu, setHeaderMenu] = useState(null);   // { x, y }
  const [renamingId, setRenamingId] = useState(null);
  const [renamingName, setRenamingName] = useState('');
  const fileInputRef = useRef(null);

  const assets = useDesignerAssets();   // presente solo en modo template (backend)
  const [pickerOpen, setPickerOpen] = useState(false);
  const fonts     = state?.template?.fonts ?? [];
  const addFont   = state?.addFont;
  const removeFont = state?.removeFont;
  const updateFont = state?.updateFont;

  // ResourceBar / forceOpen support
  const prevTickRef = useRef(expandTick);
  if (expandTick !== prevTickRef.current) {
    prevTickRef.current = expandTick;
    if (forceOpen && !open) setOpen(true);
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  async function handleFiles(fileList) {
    if (!addFont || !fileList?.length) return;
    setLoading(true);
    try {
      for (const file of Array.from(fileList)) {
        const name   = nameFromFilename(file.name);
        const format = fileExtToFormat(file.name);
        // Modo template: sube al backend y usa la URL firmada en el @font-face.
        // Si falla (o sin backend), embebe la fuente como data URL (modo workflow).
        if (assets?.upload) {
          try {
            const view = await assets.upload(file, 'font');
            addFont({ name, family: name, assetId: view.id, variants: [{ weight: 400, style: 'normal', format, data: view.url }] });
            continue;
          } catch (err) {
            console.error('Font backend upload failed, embedding instead', err);
          }
        }
        const data = await readFileAsDataURL(file);
        addFont({ name, family: name, variants: [{ weight: 400, style: 'normal', format, data }] });
      }
    } catch (err) {
      console.error('Font upload error', err);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function openFilePicker() { fileInputRef.current?.click(); }

  function pickFontFromLibrary(a) {
    if (!addFont) return;
    addFont({
      name: nameFromFilename(a.name),
      family: nameFromFilename(a.name),
      assetId: a.id,
      variants: [{ weight: 400, style: 'normal', format: fileExtToFormat(a.name), data: a.url }],
    });
  }

  // ── Clone ─────────────────────────────────────────────────────────────────

  function cloneFont(id) {
    const src = fonts.find(f => f.id === id);
    if (!src || !addFont) return;
    addFont({ name: `${src.name} copia`, family: `${src.family} copia`, variants: src.variants });
  }

  // ── Rename ────────────────────────────────────────────────────────────────

  function commitRename(id) {
    const trimmed = renamingName.trim();
    if (trimmed && updateFont) updateFont(id, { name: trimmed, family: trimmed });
    setRenamingId(null);
  }

  // ── Menu actions ──────────────────────────────────────────────────────────

  const openItemMenu = useCallback((id, x, y) => setItemMenu({ id, x, y }), []);

  function getItemActions(id) {
    const font = fonts.find(f => f.id === id);
    return [
      { label: 'Renombrar', Icon: PenLine, onClick: () => { setRenamingId(id); setRenamingName(font?.name ?? ''); } },
      { label: 'Clonar',    Icon: Copy,    onClick: () => cloneFont(id) },
      { label: 'Eliminar',  Icon: Trash2,  danger: true, onClick: () => removeFont?.(id) },
    ];
  }

  const headerActions = [
    { label: 'Subir fuente', Icon: Upload, onClick: openFilePicker },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="dsb-resource" onDragOver={e => e.preventDefault()} onDrop={e => {
      e.preventDefault();
      const files = [...e.dataTransfer.files].filter(f => /\.(ttf|otf|woff2?)$/i.test(f.name));
      if (files.length) handleFiles(files);
    }}>

      {/* ── Header ── */}
      <button
        className="dsb-resource__header"
        onClick={() => setOpen(v => !v)}
        onContextMenu={e => { e.preventDefault(); setHeaderMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Type size={13} />
        <span>Fuentes</span>
        <span className="dsb-resource__count">{fonts.length}</span>
        <span
          className="dsb-resource__add-btn"
          role="button"
          tabIndex={0}
          title="Subir fuente"
          onClick={e => { e.stopPropagation(); openFilePicker(); }}
          onKeyDown={e => e.key === 'Enter' && openFilePicker()}
        >
          <Plus size={11} />
        </span>
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        multiple
        style={{ display: 'none' }}
        onChange={e => handleFiles(e.target.files)}
      />

      <AssetPickerModal open={pickerOpen} kind="font" list={assets?.list}
        onClose={() => setPickerOpen(false)} onPick={pickFontFromLibrary} />

      {/* ── Body ── */}
      {open && (
        <div className="dsb-resource__body">
          {assets?.list && (
            <button className="frs__upload-hint" style={{ marginBottom: 6 }} onClick={() => setPickerOpen(true)}>
              <Upload size={11} /> Elegir de la biblioteca…
            </button>
          )}
          {fonts.length === 0 ? (
            <div className="frs__empty">
              <p className="dsb-resource__empty">Sin fuentes personalizadas</p>
              <button
                className="frs__upload-hint"
                onClick={openFilePicker}
                disabled={loading}
              >
                <Upload size={11} />
                {loading ? 'Cargando…' : 'Subir fuente (.ttf · .otf · .woff2)'}
              </button>
            </div>
          ) : (
            <>
              {fonts.map(font => (
                <div
                  key={font.id}
                  className="dsb-resource__item"
                  onContextMenu={e => { e.preventDefault(); openItemMenu(font.id, e.clientX, e.clientY); }}
                >
                  {/* Font preview */}
                  <span
                    className="frs__preview"
                    style={{ fontFamily: `'${font.family}', sans-serif` }}
                    title={font.name}
                  >
                    Aa
                  </span>

                  {/* Name / rename input */}
                  {renamingId === font.id
                    ? <input
                        className="dsb-resource__item-name"
                        autoFocus
                        value={renamingName}
                        onChange={e => setRenamingName(e.target.value)}
                        onBlur={() => commitRename(font.id)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') commitRename(font.id);
                          if (e.key === 'Escape') setRenamingId(null);
                          e.stopPropagation();
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    : <span className="dsb-resource__item-label">
                        {font.name}
                      </span>
                  }

                  {/* Delete button */}
                  <button
                    className="dsb-resource__item-del"
                    title="Eliminar"
                    onClick={() => removeFont?.(font.id)}
                  >
                    <Trash2 size={10} />
                  </button>

                  {/* More options ⋮ */}
                  <button
                    className="dsb-resource__item-more"
                    title="Más opciones"
                    onMouseDown={e => e.preventDefault()}
                    onClick={e => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      openItemMenu(font.id, r.right, r.bottom + 2);
                    }}
                  >
                    <MoreVertical size={10} />
                  </button>
                </div>
              ))}

              {/* Upload more */}
              <button
                className="frs__upload-hint"
                onClick={openFilePicker}
                disabled={loading}
              >
                <Upload size={11} />
                {loading ? 'Cargando…' : 'Subir otra fuente'}
              </button>
            </>
          )}
        </div>
      )}

      {/* ── Menus ── */}
      {itemMenu && (
        <ItemMenu
          x={itemMenu.x} y={itemMenu.y}
          actions={getItemActions(itemMenu.id)}
          onClose={() => setItemMenu(null)}
        />
      )}
      {headerMenu && (
        <ItemMenu
          x={headerMenu.x} y={headerMenu.y}
          actions={headerActions}
          onClose={() => setHeaderMenu(null)}
        />
      )}
    </div>
  );
}
