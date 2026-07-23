import { useEffect, useRef, useState } from 'react';
import { Undo2, Redo2, FileDown, FolderOpen, FileOutput } from 'lucide-react';
import { useDocumentHistory, useDocumentStore } from '@/store/documentStore';
import { serializeToJson, deserializeFromJson } from '@/json/documentJson';
import { downloadBlob } from '@/api/export';
import { useUIStore } from '@/store/uiStore';

const OTHER_MENUS = ['Editar', 'Ver', 'Insertar', 'Formato', 'Datos', 'Ayuda'];

export default function MenuBar() {
  const history = useDocumentHistory();
  const doc = useDocumentStore((s) => s.doc);
  const setDoc = useDocumentStore((s) => s.setDoc);
  const setPreviewOpen = useUIStore((s) => s.setPreviewOpen);

  const [archivoOpen, setArchivoOpen] = useState(false);
  const archivoRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cerrar dropdown al hacer click fuera
  useEffect(() => {
    if (!archivoOpen) return;
    function close(e: MouseEvent) {
      if (archivoRef.current && !archivoRef.current.contains(e.target as Node)) {
        setArchivoOpen(false);
      }
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [archivoOpen]);

  function handleExportJson() {
    const json = serializeToJson(doc);
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `${doc.name || 'documento'}.json`);
    setArchivoOpen(false);
  }

  function handleImportJson() {
    fileInputRef.current?.click();
    setArchivoOpen(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const newDoc = deserializeFromJson(text);
        setDoc(newDoc);
      } catch (err) {
        console.error('Error al importar JSON:', err);
        alert('El archivo JSON no es válido o no pudo leerse correctamente.');
      }
    };
    reader.readAsText(file);
    // Resetear para permitir reimportar el mismo archivo
    e.target.value = '';
  }

  return (
    <div className="h-full bg-bg-1 flex items-center px-2 gap-1 text-11">

      {/* Menú Archivo con dropdown */}
      <div ref={archivoRef} className="relative">
        <button
          className="h-[24px] px-2 rounded-3 hover:bg-bg-3 text-ink"
          type="button"
          onClick={() => setArchivoOpen((v) => !v)}
        >
          Archivo
        </button>

        {archivoOpen && (
          <div
            className="absolute top-[28px] left-0 z-50 rounded-3 shadow-lg py-1"
            style={{
              background: 'var(--bg-1)',
              border: '1px solid var(--bg-3)',
              minWidth: 170,
            }}
          >
            <button
              className="w-full h-[30px] px-3 flex items-center gap-2 hover:bg-bg-3 text-ink text-11 text-left"
              type="button"
              onClick={handleImportJson}
            >
              <FolderOpen size={13} />
              Importar JSON
            </button>
            <button
              className="w-full h-[30px] px-3 flex items-center gap-2 hover:bg-bg-3 text-ink text-11 text-left"
              type="button"
              onClick={handleExportJson}
            >
              <FileOutput size={13} />
              Exportar JSON
            </button>
          </div>
        )}
      </div>

      {/* Resto de menús (sin funcionalidad aún) */}
      {OTHER_MENUS.map((it) => (
        <button
          key={it}
          className="h-[24px] px-2 rounded-3 hover:bg-bg-3 text-ink"
          type="button"
        >
          {it}
        </button>
      ))}

      {/* Deshacer / Rehacer */}
      <div className="ml-3 flex items-center gap-1">
        <button
          className="h-[24px] px-2 rounded-3 hover:bg-bg-3 flex items-center gap-1.5 text-ink-2 disabled:opacity-40"
          onClick={() => history.getState().undo()}
          title="Deshacer (⌘Z)"
          type="button"
        >
          <Undo2 size={13} />
          <span className="font-mono text-[10px]">⌘Z</span>
        </button>
        <button
          className="h-[24px] px-2 rounded-3 hover:bg-bg-3 flex items-center gap-1.5 text-ink-2 disabled:opacity-40"
          onClick={() => history.getState().redo()}
          title="Rehacer (⌘⇧Z)"
          type="button"
        >
          <Redo2 size={13} />
          <span className="font-mono text-[10px]">⌘⇧Z</span>
        </button>
      </div>

      {/* Input oculto para seleccionar archivo JSON */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Exportar PDF */}
      <div className="ml-auto">
        <button
          className="h-[24px] px-3 rounded-3 flex items-center gap-1.5 font-semibold"
          style={{ background: 'var(--accent)', color: '#0b1a10' }}
          type="button"
          onClick={() => setPreviewOpen(true)}
        >
          <FileDown size={13} />
          Exportar PDF
        </button>
      </div>
    </div>
  );
}
