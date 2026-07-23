// PageManager.jsx — Barra inferior de páginas (planas)
import { useState } from 'react';
import {
  Plus, Settings, Copy, Trash2, MoreHorizontal,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import PageConfigModal from './PageConfigModal.jsx';
import './PageManager.css';

export default function PageManager({ state }) {
  const {
    pages, currentPageIndex, setCurrentPageIndex,
    addPage, removePage, duplicatePage,
    updatePageById,
  } = state;

  const [configPageId, setConfigPageId] = useState(null);
  const [menuPageId,   setMenuPageId]   = useState(null);

  const configPage = configPageId ? pages.find(p => p.id === configPageId) : null;

  return (
    <>
      <div className="pm" onClick={() => setMenuPageId(null)}>

        {/* ── Páginas ── */}
        <div className="pm__pages">
          {pages.map((page, idx) => {
            const isActive = idx === currentPageIndex;
            return (
              <div
                key={page.id}
                className={`pm__page${isActive ? ' pm__page--active' : ''}${!page.visible ? ' pm__page--hidden' : ''}`}
                onClick={e => { e.stopPropagation(); setCurrentPageIndex(idx); }}
                onDoubleClick={e => { e.stopPropagation(); setConfigPageId(page.id); }}
                title={page.name}
              >
                <span className="pm__page-num">{idx + 1}</span>
                <span className="pm__page-name">{page.name}</span>
                <button
                  className="pm__page-menu-btn"
                  onClick={e => { e.stopPropagation(); setMenuPageId(menuPageId === page.id ? null : page.id); }}
                >
                  <MoreHorizontal size={9} />
                </button>
                {menuPageId === page.id && (
                  <div className="pm__page-menu" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { setConfigPageId(page.id); setMenuPageId(null); }}>
                      <Settings size={11} /> Configurar
                    </button>
                    <button onClick={() => { duplicatePage(page.id); setMenuPageId(null); }}>
                      <Copy size={11} /> Duplicar
                    </button>
                    <button
                      className="pm__page-menu-danger"
                      disabled={pages.length <= 1}
                      onClick={() => { removePage(page.id); setMenuPageId(null); }}
                    >
                      <Trash2 size={11} /> Eliminar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <button className="pm__add" onClick={() => addPage()} title="Nueva página">
            <Plus size={13} />
          </button>
        </div>

        {/* ── Spacer ── */}
        <div className="pm__spacer" />

        {/* ── Nav ── */}
        <div className="pm__nav">
          <button className="pm__nav-btn" onClick={() => setCurrentPageIndex(0)} disabled={currentPageIndex === 0} title="Primera">
            <ChevronsLeft size={12} />
          </button>
          <button className="pm__nav-btn" onClick={() => setCurrentPageIndex(i => Math.max(0, i - 1))} disabled={currentPageIndex === 0} title="Anterior">
            <ChevronLeft size={12} />
          </button>
          <span className="pm__nav-label">{currentPageIndex + 1} / {pages.length}</span>
          <button className="pm__nav-btn" onClick={() => setCurrentPageIndex(i => Math.min(pages.length - 1, i + 1))} disabled={currentPageIndex >= pages.length - 1} title="Siguiente">
            <ChevronRight size={12} />
          </button>
          <button className="pm__nav-btn" onClick={() => setCurrentPageIndex(pages.length - 1)} disabled={currentPageIndex >= pages.length - 1} title="Última">
            <ChevronsRight size={12} />
          </button>
        </div>
      </div>

      {configPage && (
        <PageConfigModal
          page={configPage}
          allPages={pages}
          onSave={(changes) => { updatePageById(configPage.id, changes); setConfigPageId(null); }}
          onClose={() => setConfigPageId(null)}
        />
      )}
    </>
  );
}
