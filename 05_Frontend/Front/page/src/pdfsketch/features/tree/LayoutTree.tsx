import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist';
import {
  ChevronDown,
  ChevronRight,
  Circle,
  Edit3,
  FileText,
  Folder,
  Image as ImageIcon,
  LayoutTemplate,
  Layers,
  Minus,
  QrCode,
  Square,
  Table2,
  Type,
  Variable,
} from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import type { DocumentModel, ElementModel } from '@/types/document';

interface TreeNode {
  id: string;
  name: string;
  kind: 'group' | 'page' | 'element' | 'asset' | 'variable';
  elementType?: ElementModel['type'];
  elementId?: string;
  pageId?: string;
  children?: TreeNode[];
}

interface RenameCtx {
  renamingId: string | null;
  renamingKind: 'element' | 'page' | null;
  startRename: (id: string, kind: 'element' | 'page') => void;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
}

const RenameContext = createContext<RenameCtx>({
  renamingId: null,
  renamingKind: null,
  startRename: () => {},
  commitRename: () => {},
  cancelRename: () => {},
});

export default function LayoutTree() {
  const doc = useDocumentStore((s) => s.doc);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const setCurrentPage = useDocumentStore((s) => s.setCurrentPage);
  const updateElement = useDocumentStore((s) => s.updateElement);
  const updatePage = useDocumentStore((s) => s.updatePage);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const setSelection = useSelectionStore((s) => s.select);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingKind, setRenamingKind] = useState<'element' | 'page' | null>(null);

  const data = useMemo(() => buildTree(doc), [doc]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 240, h: 400 });
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, Math.floor(r.width)), h: Math.max(1, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const treeRef = useRef<TreeApi<TreeNode> | null>(null);
  useEffect(() => {
    const first = selectedIds[0];
    const tree = treeRef.current;
    if (!tree || !first) return;
    const nodeId = `el:${first}`;
    if (tree.focusedNode?.id === nodeId) return;
    tree.select(nodeId);
  }, [selectedIds]);

  function onSelect(nodes: NodeApi<TreeNode>[]) {
    const elementIds = nodes
      .filter((n) => n.data.kind === 'element' && n.data.elementId)
      .map((n) => n.data.elementId!);
    if (elementIds.length > 0) {
      const current = useSelectionStore.getState().selectedIds;
      if (!arraysEqual(elementIds, current)) setSelection(elementIds);
      const first = elementIds[0];
      const containing = doc.pages.find((p) => p.elements.some((e) => e.id === first));
      if (containing && containing.id !== currentPageId) setCurrentPage(containing.id);
      return;
    }
    const pageNode = nodes.find((n) => n.data.kind === 'page' && n.data.pageId);
    if (pageNode?.data.pageId) {
      setCurrentPage(pageNode.data.pageId);
      const current = useSelectionStore.getState().selectedIds;
      if (current.length > 0) setSelection([]);
    }
  }

  const renameCtx: RenameCtx = {
    renamingId,
    renamingKind,
    startRename: (id, kind) => {
      setRenamingId(id);
      setRenamingKind(kind);
    },
    commitRename: (id, name) => {
      const trimmed = name.trim();
      if (renamingKind === 'page') {
        if (trimmed) updatePage(id, { name: trimmed });
      } else {
        updateElement(id, { name: trimmed || undefined });
      }
      setRenamingId(null);
      setRenamingKind(null);
    },
    cancelRename: () => {
      setRenamingId(null);
      setRenamingKind(null);
    },
  };

  return (
    <RenameContext.Provider value={renameCtx}>
      <div ref={containerRef} className="h-full w-full overflow-hidden">
        <Tree<TreeNode>
          ref={treeRef}
          data={data}
          width={size.w}
          height={size.h}
          rowHeight={22}
          indent={14}
          openByDefault={false}
          disableDrag
          disableDrop
          onSelect={onSelect}
        >
          {Node}
        </Tree>
      </div>
    </RenameContext.Provider>
  );
}

function Node({ node, style, dragHandle }: NodeRendererProps<TreeNode>) {
  const d = node.data;
  const hasChildren = (d.children?.length ?? 0) > 0;
  const Icon = iconFor(d);
  const { renamingId, startRename, commitRename, cancelRename } = useContext(RenameContext);

  const isRenamingEl = d.kind === 'element' && d.elementId != null && renamingId === d.elementId;
  const isRenamingPage = d.kind === 'page' && d.pageId != null && renamingId === d.pageId;
  const isRenaming = isRenamingEl || isRenamingPage;

  const renameId = isRenamingEl ? d.elementId! : d.pageId!;

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  return (
    <div
      ref={dragHandle}
      style={style}
      className="flex items-center h-[22px] text-11 select-none cursor-default hover:bg-bg-3"
      onClick={() => {
        if (hasChildren && !isRenaming) node.toggle();
      }}
    >
      <button
        type="button"
        aria-label={node.isOpen ? 'Colapsar' : 'Expandir'}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) node.toggle();
        }}
        className="w-4 h-full flex items-center justify-center text-muted"
      >
        {hasChildren ? (
          node.isOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />
        ) : null}
      </button>
      <span className="w-4 flex items-center justify-center text-muted">
        <Icon size={12} />
      </span>

      {isRenaming ? (
        <input
          ref={inputRef}
          defaultValue={d.name}
          className="flex-1 text-11 px-1 outline-none rounded"
          style={{ background: 'var(--bg-2)', color: 'var(--ink)', border: '1px solid var(--accent)' }}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => commitRename(renameId, e.currentTarget.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename(renameId, e.currentTarget.value);
            if (e.key === 'Escape') cancelRename();
          }}
        />
      ) : (
        <span
          className="flex-1 truncate px-1"
          style={node.isSelected ? { color: 'var(--accent)' } : { color: 'var(--ink)' }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (d.kind === 'element' && d.elementId) {
              startRename(d.elementId, 'element');
            } else if (d.kind === 'page' && d.pageId) {
              startRename(d.pageId, 'page');
            }
          }}
        >
          {d.name}
        </span>
      )}

      {hasChildren && !isRenaming && (
        <span className="font-mono text-[10px] text-muted px-2">{d.children!.length}</span>
      )}
    </div>
  );
}

function iconFor(n: TreeNode) {
  if (n.kind === 'element' && n.elementType) {
    switch (n.elementType) {
      case 'text': return Type;
      case 'rect': return Square;
      case 'circle': return Circle;
      case 'line': return Minus;
      case 'pen': return Edit3;
      case 'image': return ImageIcon;
      case 'table': return Table2;
      case 'qr': return QrCode;
      case 'dataField': return Variable;
      case 'frame': return LayoutTemplate;
      case 'flowable': return Layers;
    }
  }
  if (n.kind === 'page') return FileText;
  if (n.kind === 'variable') return Variable;
  return Folder;
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Texto', rect: 'Rectángulo', circle: 'Círculo', line: 'Línea',
  pen: 'Lápiz', image: 'Imagen', table: 'Tabla', qr: 'QR',
  dataField: 'Campo', frame: 'Área', flowable: 'Sub-área',
};

function buildTree(doc: DocumentModel): TreeNode[] {
  const a = doc.assets;

  const elementNode = (e: ElementModel, pageId?: string): TreeNode => ({
    id: `el:${e.id}`,
    name: e.name ?? (TYPE_LABELS[e.type] ?? e.type),
    kind: 'element',
    elementType: e.type,
    elementId: e.id,
    pageId,
  });

  const group = (id: string, name: string, children: TreeNode[]): TreeNode => ({
    id, name, kind: 'group', children,
  });

  const assetNodes = (prefix: string, items: { id: string; name: string }[]): TreeNode[] =>
    items.map((i) => ({ id: `${prefix}:${i.id}`, name: i.name, kind: 'asset' as const }));

  const imageElements: TreeNode[] = doc.pages.flatMap((p) =>
    p.elements
      .filter((e) => e.type === 'image')
      .map((e) => ({
        id: `imgfolder:${e.id}`,
        name: e.name ?? 'Imagen',
        kind: 'element' as const,
        elementType: 'image' as const,
        elementId: e.id,
        pageId: p.id,
      })),
  );

  return [
    group('g:pages', 'Páginas',
      doc.pages.map((p): TreeNode => ({
        id: `page:${p.id}`,
        name: p.name,
        kind: 'page',
        pageId: p.id,
        children: p.elements
          .filter((e) => e.type !== 'flowable')
          .map((e) => {
            if (e.type === 'frame') {
              const flowables = p.elements.filter(
                (f) => f.type === 'flowable' && (f as { frameId?: string }).frameId === e.id,
              );
              return { ...elementNode(e, p.id), children: flowables.map((f) => elementNode(f, p.id)) };
            }
            return elementNode(e, p.id);
          }),
      })),
    ),
    group('g:elements', 'Elementos',
      doc.pages.flatMap((p) => p.elements.filter((e) => e.type !== 'flowable').map((e) => elementNode(e, p.id))),
    ),
    group('g:flows', 'Flujos', assetNodes('flow', doc.flows)),
    group('g:fonts', 'Fuentes', assetNodes('font', a.fonts)),
    group('g:colors', 'Colores', assetNodes('color', a.colors)),
    group('g:images', 'Imágenes', [...assetNodes('img', a.images), ...imageElements]),
    group('g:tables', 'Tablas', assetNodes('tbl', a.tables)),
    group('g:rowSets', 'Filas', assetNodes('rs', a.rowSets)),
    group('g:cells', 'Celdas', assetNodes('cell', a.cells)),
  ];
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
