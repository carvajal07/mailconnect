// ImageAssetEditor.jsx — Editor completo de un Image Asset

import { useState, useRef, useEffect } from 'react';
import { ImageIcon, Braces, Settings2, Upload, Link2, HardDrive, TriangleAlert, Plus, Trash2, ArrowUpCircle, Maximize2 } from 'lucide-react';
import ScriptEditor      from '../../../../ScriptProcessor/config/ScriptEditor.jsx';
import ScriptEditorModal from '../../pages/ScriptEditorModal.jsx';
import ExpressionBuilder from '../../pages/ExpressionBuilder.jsx';
import VariableTreeSelect from '../../components/VariableTreeSelect.jsx';
import { useDesignerAssets } from '../../DesignerUploadContext.js';
import AssetPickerModal from '../../components/AssetPickerModal.jsx';

// ── Constantes ────────────────────────────────────────────────────────────────

// Tipos de fuente solo para imágenes estáticas — Variable es un tipo de asset, no una fuente
const SOURCE_KINDS = [
  { value: 'static',    label: 'URL',      hint: 'URL estática',  Icon: Link2     },
  { value: 'base64',    label: 'Embebida', hint: '≤ 100 KB',      Icon: Upload    },
  { value: 'localFile', label: 'Archivo',  hint: 'Disco local',   Icon: HardDrive },
];

const VARIABLE_MODES = [
  { value: 'variable',    label: 'Variable (URL desde campo)' },
  { value: 'byText',      label: 'Por texto'                  },
  { value: 'byCondition', label: 'Por condición'              },
  { value: 'byInteger',   label: 'Por entero'                 },
  { value: 'byInterval',  label: 'Por intervalo'              },
  { value: 'byScript',    label: 'Por script'                 },
];

const RESIZE_UNITS = ['mm', 'cm', 'in', 'px'];
const BASE64_LIMIT = 100 * 1024; // 100 KB

// Determina si un asset es de tipo variable
function isVariableAsset(asset) {
  return asset?.assetKind === 'variable'
    || (!asset?.assetKind && !asset?.source && asset?.variableConfig != null);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolvePreviewUrl(source) {
  if (!source) return null;
  if (source.kind === 'base64')    return source.data  || null;
  if (source.kind === 'static')    return source.url   || null;
  if (source.kind === 'localFile') return source.url   || null;
  return null;
}

// ── ImagePreview ──────────────────────────────────────────────────────────────

function ImagePreview({ src, badge, sampleSrc }) {
  const [info, setInfo]   = useState(null);
  const [error, setError] = useState(false);
  const displaySrc = src || sampleSrc;

  useEffect(() => {
    setInfo(null); setError(false);
    if (!displaySrc) return;
    const img = new Image();
    img.onload  = () => setInfo({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setError(true);
    img.src = displaySrc;
  }, [displaySrc]);

  if (!displaySrc) {
    return (
      <div className="iae__preview-empty">
        <ImageIcon size={28} strokeWidth={1} />
        <span>Sin imagen</span>
      </div>
    );
  }

  return (
    <div className="iae__preview-wrap">
      {badge && <div className="iae__preview-badge">{badge}</div>}
      {error
        ? <div className="iae__preview-error">No se pudo cargar</div>
        : <img src={displaySrc} alt="preview" className="iae__preview-img" onError={() => setError(true)} />
      }
      {info && <div className="iae__preview-info">{info.w} × {info.h} px</div>}
    </div>
  );
}

// ── Source Kind Chips (solo estáticas) ────────────────────────────────────────

function KindChips({ value, onChange }) {
  return (
    <div className="iae__kind-grid">
      {SOURCE_KINDS.map(sk => (
        <button
          key={sk.value}
          className={`iae__kind-chip${value === sk.value ? ' iae__kind-chip--active' : ''}`}
          onClick={() => onChange(sk.value)}
        >
          <sk.Icon size={13} className="iae__kind-chip__icon" />
          <div className="iae__kind-chip__text">
            <div className="iae__kind-chip__label">{sk.label}</div>
            <div className="iae__kind-chip__hint">{sk.hint}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

// ── Tab Imagen (asset estático) ───────────────────────────────────────────────

function TabImagen({ asset, onChange, allAssets, onPromoteToVariable }) {
  const fileRef  = useRef(null);
  const localRef = useRef(null);
  const assets = useDesignerAssets();   // presente solo en modo template (backend)
  const [pickerOpen, setPickerOpen] = useState(false);
  const src   = asset.source     ?? { kind: 'static', url: '' };
  const props = asset.properties ?? {};

  function setSource(changes) { onChange({ source: { ...src, ...changes } }); }
  function setProp(changes)   { onChange({ properties: { ...props, ...changes } }); }

  function embedAsBase64(file) {
    const reader = new FileReader();
    reader.onload = ev => setSource({
      kind: 'base64', data: ev.target.result,
      filename: file.name, mimeType: file.type, sizeBytes: file.size,
    });
    reader.readAsDataURL(file);
  }

  async function handleBase64Upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // Modo template: sube al backend y guarda la URL firmada + assetId. Si falla,
    // cae a embeber en base64 (modo workflow / sin backend).
    if (assets?.upload) {
      try {
        const view = await assets.upload(file, 'image');
        setSource({
          kind: 'static', url: view.url, assetId: view.id,
          filename: file.name, mimeType: file.type, sizeBytes: file.size,
        });
        return;
      } catch (err) {
        console.error('Asset backend upload failed, embedding instead', err);
      }
    }
    embedAsBase64(file);
  }

  function pickFromLibrary(a) {
    setSource({ kind: 'static', url: a.url, assetId: a.id, filename: a.name, mimeType: a.contentType });
  }

  async function handleLocalFilePick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    // Modo template/workflow con backend: sube a la biblioteca de assets del tenant
    // y guarda la URL firmada + assetId (queda reutilizable desde el picker).
    if (assets?.upload) {
      try {
        const view = await assets.upload(file, 'image');
        setSource({
          kind: 'static', url: view.url, assetId: view.id,
          filename: file.name, mimeType: file.type, saved: true,
        });
        return;
      } catch (err) {
        console.error('Asset backend upload failed, falling back', err);
      }
    }
    // Sin backend (nodo legacy aislado): fallback a referencia local.
    setSource({ kind: 'localFile', filename: file.name, url: '/images/' + file.name, saved: false });
  }

  const previewUrl  = resolvePreviewUrl(src);
  const b64TooLarge = src.kind === 'base64' && src.sizeBytes > BASE64_LIMIT;

  return (
    <>
      {/* Nombre */}
      <div className="pp-field">
        <label className="pp-field__label">Nombre</label>
        <input className="pp-field__input" value={asset.name ?? ''}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Nombre de la imagen" />
      </div>

      {/* Elegir de la biblioteca (solo con backend de assets) */}
      {assets?.list && (
        <div className="pp-field">
          <button
            type="button"
            className="iae__upload-btn"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => setPickerOpen(true)}
          >
            <ImageIcon size={13} /> Elegir de la biblioteca…
          </button>
        </div>
      )}
      <AssetPickerModal open={pickerOpen} kind="image" list={assets?.list}
        onClose={() => setPickerOpen(false)} onPick={pickFromLibrary} />

      {/* Tipo de fuente — 3 chips */}
      <div className="pp-field">
        <label className="pp-field__label">Tipo de fuente</label>
        <KindChips value={src.kind ?? 'static'} onChange={k => setSource({ kind: k })} />
      </div>

      {/* URL estática */}
      {src.kind === 'static' && (
        <div className="pp-field">
          <label className="pp-field__label">URL</label>
          <input className="pp-field__input" value={src.url ?? ''}
            onChange={e => setSource({ url: e.target.value })}
            placeholder="/images/logo.png  o  https://cdn.…" />
        </div>
      )}

      {/* Base64 */}
      {src.kind === 'base64' && (
        <div className="pp-field">
          <label className="pp-field__label">Imagen embebida</label>
          <div className="iae__upload-area">
            <button className="iae__upload-btn" onClick={() => fileRef.current?.click()}>
              <Upload size={12} /> {src.data ? 'Cambiar imagen…' : 'Subir imagen…'}
            </button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleBase64Upload} />
            {src.sizeBytes != null && (
              <span className={`iae__size-badge${b64TooLarge ? ' iae__size-badge--warn' : ''}`}>
                {b64TooLarge && <TriangleAlert size={9} />}
                {Math.round(src.sizeBytes / 1024)} KB
              </span>
            )}
          </div>
          {src.filename && <p className="iae__hint">{src.filename}</p>}
          {b64TooLarge && <p className="iae__warn">Supera el límite de 100 KB. Usa URL estática o Archivo local.</p>}
        </div>
      )}

      {/* Archivo local */}
      {src.kind === 'localFile' && (
        <div className="pp-field">
          <label className="pp-field__label">Archivo local</label>
          <div className="iae__upload-area">
            <button className="iae__upload-btn" onClick={() => localRef.current?.click()}>
              <HardDrive size={12} /> {src.filename ? 'Cambiar…' : 'Elegir archivo…'}
            </button>
            <input ref={localRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLocalFilePick} />
            {src.saved === true && <span className="iae__saved-badge">✓ Guardado</span>}
          </div>
          {src.filename && <p className="iae__hint">Ruta: {src.url}</p>}
          {src.saved === false && (
            <p className="iae__hint iae__hint--info">Copia el archivo a <code>public/images/</code> para que el editor lo muestre.</p>
          )}
        </div>
      )}

      {/* Preview */}
      <div className="iae__preview-box">
        <ImagePreview src={previewUrl} />
      </div>

      {/* Resolución */}
      <p className="pp-section-title">Resolución</p>
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Usar DPI de la imagen</span>
        <input type="checkbox" checked={props.useImageDpi ?? true}
          onChange={e => setProp({ useImageDpi: e.target.checked })} />
      </div>
      {!(props.useImageDpi ?? true) && (
        <div className="pp-row pp-row--mb">
          <div className="pp-field">
            <label className="pp-field__label">DPI X</label>
            <input className="pp-field__input" type="number" min={1} max={2400}
              value={props.dpiX ?? 96} onChange={e => setProp({ dpiX: Number(e.target.value) })} />
          </div>
          <div className="pp-field">
            <label className="pp-field__label">DPI Y</label>
            <input className="pp-field__input" type="number" min={1} max={2400}
              value={props.dpiY ?? 96} onChange={e => setProp({ dpiY: Number(e.target.value) })} />
          </div>
        </div>
      )}

      {/* Redimensionar */}
      <p className="pp-section-title">Redimensionar</p>
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Activar ancho</span>
        <input type="checkbox" checked={props.resizeWidth ?? false}
          onChange={e => setProp({ resizeWidth: e.target.checked })} />
      </div>
      {props.resizeWidth && (
        <div className="pp-field">
          <label className="pp-field__label">Valor ancho</label>
          <input className="pp-field__input" type="number" min={0} step={0.5}
            value={props.resizeWidthValue ?? 50}
            onChange={e => setProp({ resizeWidthValue: Number(e.target.value) })} />
        </div>
      )}
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Activar alto</span>
        <input type="checkbox" checked={props.resizeHeight ?? false}
          onChange={e => setProp({ resizeHeight: e.target.checked })} />
      </div>
      {props.resizeHeight && (
        <div className="pp-field">
          <label className="pp-field__label">Valor alto</label>
          <input className="pp-field__input" type="number" min={0} step={0.5}
            value={props.resizeHeightValue ?? 50}
            onChange={e => setProp({ resizeHeightValue: Number(e.target.value) })} />
        </div>
      )}
      {(props.resizeWidth || props.resizeHeight) && (
        <>
          <div className="pp-field">
            <label className="pp-field__label">Unidad</label>
            <div className="iae__unit-row">
              {RESIZE_UNITS.map(u => (
                <button key={u}
                  className={`iae__unit-btn${(props.resizeUnit ?? 'mm') === u ? ' iae__unit-btn--active' : ''}`}
                  onClick={() => setProp({ resizeUnit: u })}>{u}</button>
              ))}
            </div>
          </div>
          <div className="pp-toggle-row">
            <span className="pp-toggle-row__label">Mantener proporción</span>
            <input type="checkbox" checked={props.maintainAspectRatio ?? true}
              onChange={e => setProp({ maintainAspectRatio: e.target.checked })} />
          </div>
        </>
      )}

      {/* Salida HTML */}
      <p className="pp-section-title">Salida HTML</p>
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Tamaño diferente para HTML</span>
        <input type="checkbox" checked={props.useDifferentSizeForHtml ?? false}
          onChange={e => setProp({ useDifferentSizeForHtml: e.target.checked })} />
      </div>
      {props.useDifferentSizeForHtml && (
        <div className="pp-row pp-row--mb">
          <div className="pp-field">
            <label className="pp-field__label">Ancho</label>
            <input className="pp-field__input" value={props.htmlWidth ?? ''}
              onChange={e => setProp({ htmlWidth: e.target.value })} placeholder="100%, auto…" />
          </div>
          <div className="pp-field">
            <label className="pp-field__label">Alto</label>
            <input className="pp-field__input" value={props.htmlHeight ?? ''}
              onChange={e => setProp({ htmlHeight: e.target.value })} placeholder="auto" />
          </div>
        </div>
      )}

      {/* Promover a variable */}
      {onPromoteToVariable && (
        <>
          <p className="pp-section-title">Variabilidad</p>
          <button className="iae__promote-btn" onClick={onPromoteToVariable}>
            <ArrowUpCircle size={13} />
            Promover a imagen variable
          </button>
          <p className="iae__hint">
            Crea una nueva imagen variable que usa esta imagen como referencia base.
          </p>
        </>
      )}
    </>
  );
}

// ── Tab Variable (asset variable) ─────────────────────────────────────────────

function TabVariable({ asset, onChange, availableFields, allAssets }) {
  const vc = asset.variableConfig ?? {
    mode: 'variable', variableField: '',
    defaultImageId: '', sampleImageId: '', mappings: [], script: '',
  };

  const [editingCondIdx, setEditingCondIdx] = useState(null);
  const [showScriptModal, setShowScriptModal] = useState(false);

  function setVc(changes) { onChange({ variableConfig: { ...vc, ...changes } }); }

  function setMode(newMode) {
    const needsMappings = newMode !== 'variable' && newMode !== 'byScript';
    const mappings = vc.mappings ?? [];
    setVc({
      mode: newMode,
      mappings: needsMappings && mappings.length === 0
        ? [{ value: '', rule: null, begin: 0, end: 0, imageId: '' }]
        : mappings,
    });
  }

  function addMapping() {
    setVc({ mappings: [...(vc.mappings ?? []), { value: '', rule: null, begin: 0, end: 0, imageId: '' }] });
  }
  function updateMapping(i, changes) {
    const m = [...(vc.mappings ?? [])]; m[i] = { ...m[i], ...changes }; setVc({ mappings: m });
  }
  function removeMapping(i) {
    const m = [...(vc.mappings ?? [])]; m.splice(i, 1); setVc({ mappings: m });
  }

  const mode = vc.mode ?? 'variable';
  const needsMappings = mode !== 'variable' && mode !== 'byScript';

  const staticAssets = allAssets.filter(a => !isVariableAsset(a) && a.id !== asset.id);
  const sampleAsset  = staticAssets.find(a => a.id === vc.sampleImageId);
  const sampleSrc    = resolvePreviewUrl(sampleAsset?.source);

  const editingMapping = editingCondIdx != null ? (vc.mappings ?? [])[editingCondIdx] : null;
  const editingRule = editingMapping?.rule ?? { conditionType: 'expression', expression: { logic: 'all', clauses: [] }, script: '' };

  return (
    <>
      {/* Nombre */}
      <div className="pp-field">
        <label className="pp-field__label">Nombre</label>
        <input className="pp-field__input" value={asset.name ?? ''}
          onChange={e => onChange({ name: e.target.value })}
          placeholder="Nombre de la imagen variable" />
      </div>

      {/* Preview de muestra */}
      <div className="iae__preview-box">
        <ImagePreview src={sampleSrc} badge="MUESTRA" />
      </div>

      {/* Modo */}
      <div className="pp-field">
        <label className="pp-field__label">Modo de selección</label>
        <select className="pp-field__select" value={mode}
          onChange={e => setMode(e.target.value)}>
          {VARIABLE_MODES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Campo del flujo — select con variables del layout */}
      {mode !== 'byScript' && (
        <div className="pp-field">
          <label className="pp-field__label">Campo del flujo</label>
          <VariableTreeSelect
            value={vc.variableField}
            onChange={p => setVc({ variableField: p })}
            fields={availableFields}
            accept={['string']}
            placeholder="(Seleccionar campo…)"
            clearLabel="— Sin campo —"
          />
        </div>
      )}

      {/* Imagen por defecto */}
      <div className="pp-field">
        <label className="pp-field__label">Imagen por defecto</label>
        <select className="pp-field__select" value={vc.defaultImageId ?? ''}
          onChange={e => setVc({ defaultImageId: e.target.value })}>
          <option value="">(Ninguna)</option>
          {staticAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="pp-field">
        <label className="pp-field__label">Imagen de muestra (preview)</label>
        <select className="pp-field__select" value={vc.sampleImageId ?? ''}
          onChange={e => setVc({ sampleImageId: e.target.value })}>
          <option value="">(Ninguna)</option>
          {staticAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* Script editor for byScript mode */}
      {mode === 'byScript' && (
        <>
          <p className="pp-section-title">Script</p>
          <div className="iae__script-toolbar">
            <span className="iae__script-label">
              Retorna el <code>id</code> del asset de imagen
            </span>
            <button className="iae__script-expand" onClick={() => setShowScriptModal(true)} title="Ampliar editor">
              <Maximize2 size={11} /> Ampliar
            </button>
          </div>
          <div className="iae__script-editor-wrap">
            <ScriptEditor
              value={vc.script ?? ''}
              onChange={v => setVc({ script: v })}
              placeholder={"// Retorna el id del asset de imagen\nreturn packet.tipo === 'premium' ? 'id_premium' : 'id_default';"}
              upstreamFields={availableFields}
            />
          </div>
        </>
      )}
      {showScriptModal && (
        <ScriptEditorModal
          script={vc.script ?? ''}
          onSave={v => setVc({ script: v })}
          onClose={() => setShowScriptModal(false)}
          availableFields={availableFields}
        />
      )}

      {/* Mappings for byText / byInteger / byInterval / byCondition */}
      {needsMappings && (
        <>
          <p className="pp-section-title">Mapeos</p>
          <div className="iae__mappings">
            {(vc.mappings ?? []).map((m, i) => (
              <div key={i} className="iae__mapping">
                {(mode === 'byText' || mode === 'byInteger') && (
                  <input className="pp-field__input iae__mapping__val"
                    placeholder={mode === 'byText' ? 'Texto…' : 'Entero…'}
                    value={m.value ?? ''} onChange={e => updateMapping(i, { value: e.target.value })} />
                )}
                {mode === 'byInterval' && (
                  <>
                    <input className="pp-field__input iae__mapping__num" type="number"
                      placeholder="Desde" value={m.begin ?? 0}
                      onChange={e => updateMapping(i, { begin: Number(e.target.value) })} />
                    <span className="iae__mapping__sep">–</span>
                    <input className="pp-field__input iae__mapping__num" type="number"
                      placeholder="Hasta" value={m.end ?? 0}
                      onChange={e => updateMapping(i, { end: Number(e.target.value) })} />
                  </>
                )}
                {mode === 'byCondition' && (
                  <button
                    className="iae__mapping__cond-btn"
                    onClick={() => setEditingCondIdx(i)}
                    title="Editar condición"
                  >
                    {(() => {
                      const r = m.rule;
                      if (!r) return 'Sin condición…';
                      if (r.conditionType === 'script') return 'Script';
                      const n = r.expression?.clauses?.length ?? 0;
                      return n > 0 ? `${n} cláusula${n > 1 ? 's' : ''}` : 'Sin condición…';
                    })()}
                  </button>
                )}
                <select className="pp-field__select iae__mapping__img"
                  value={m.imageId ?? ''} onChange={e => updateMapping(i, { imageId: e.target.value })}>
                  <option value="">(imagen…)</option>
                  {staticAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <button className="iae__mapping__del" title="Eliminar" onClick={() => removeMapping(i)}>
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
            <button className="iae__add-mapping" onClick={addMapping}>
              <Plus size={11} /> Agregar fila
            </button>
          </div>
        </>
      )}

      {/* ExpressionBuilder modal for byCondition mappings */}
      {editingCondIdx != null && (
        <ExpressionBuilder
          rule={editingRule}
          availableFields={availableFields}
          onSave={rule => { updateMapping(editingCondIdx, { rule }); setEditingCondIdx(null); }}
          onClose={() => setEditingCondIdx(null)}
        />
      )}
    </>
  );
}

// ── Tab Avanzado ──────────────────────────────────────────────────────────────

function TabAvanzado({ asset, onChange }) {
  const props = asset.properties ?? {};
  function setProp(changes) { onChange({ properties: { ...props, ...changes } }); }

  return (
    <>
      <div className="pp-field">
        <label className="pp-field__label">Alt text</label>
        <input className="pp-field__input" value={props.altText ?? ''}
          onChange={e => setProp({ altText: e.target.value })}
          placeholder="Descripción para lectores de pantalla" />
      </div>
      <p className="pp-section-title">Color</p>
      <div className="pp-toggle-row">
        <span className="pp-toggle-row__label">Usar canal alpha (transparencia)</span>
        <input type="checkbox" checked={props.useAlphaChannel ?? true}
          onChange={e => setProp({ useAlphaChannel: e.target.checked })} />
      </div>
      <p className="iae__hint iae__hint--pad">
        Color space, transparencia RGB/CMYK y opciones avanzadas disponibles en fases siguientes.
      </p>
    </>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ImageAssetEditor({ asset, onChange, availableFields = [], allAssets = [], onPromoteToVariable }) {
  const [tab, setTab] = useState('imagen');

  if (!asset) return null;

  const varAsset = isVariableAsset(asset);

  // Tabs según tipo de asset
  const TABS = varAsset
    ? [{ id: 'variable', label: 'Variable', Icon: Braces }, { id: 'avanzado', label: 'Avanzado', Icon: Settings2 }]
    : [{ id: 'imagen',   label: 'Imagen',   Icon: ImageIcon }, { id: 'avanzado', label: 'Avanzado', Icon: Settings2 }];

  // Resetear a primer tab cuando cambia el tipo de asset
  const firstTabId = TABS[0].id;
  const safeTab = TABS.some(t => t.id === tab) ? tab : firstTabId;

  function handleChange(changes) {
    onChange({ ...asset, ...changes });
  }

  return (
    <div className="iae">
      {/* Tabs */}
      <div className="iae__tabs">
        {TABS.map(t => (
          <button key={t.id}
            className={`iae__tab${safeTab === t.id ? ' iae__tab--active' : ''}`}
            onClick={() => setTab(t.id)}>
            <t.Icon size={11} />
            {t.label}
          </button>
        ))}
        {varAsset && (
          <span className="iae__var-indicator">
            <Braces size={10} /> imagen variable
          </span>
        )}
      </div>

      {/* Contenido */}
      <div className="iae__body">
        {safeTab === 'imagen' && !varAsset && (
          <TabImagen asset={asset} onChange={handleChange} allAssets={allAssets} onPromoteToVariable={onPromoteToVariable} />
        )}
        {safeTab === 'variable' && varAsset && (
          <TabVariable asset={asset} onChange={handleChange} availableFields={availableFields} allAssets={allAssets} />
        )}
        {safeTab === 'avanzado' && (
          <TabAvanzado asset={asset} onChange={handleChange} />
        )}
      </div>
    </div>
  );
}
