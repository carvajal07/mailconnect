import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from 'react-arborist';
import {
  ALargeSmall,
  ChevronDown,
  ChevronRight,
  Circle,
  Edit3,
  FileText,
  Files,
  Folder,
  GitBranch,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  Layers,
  Minus,
  Palette,
  QrCode,
  Rows3,
  Shapes,
  Square,
  Table2,
  Type,
  Variable,
} from 'lucide-react';
import { useDocumentStore } from '@/store/documentStore';
import { useSelectionStore } from '@/store/selectionStore';
import { useUIStore } from '@/store/uiStore';
import type { DocumentModel, ElementModel } from '@/types/document';
import { Triangle as TriangleIcon } from 'lucide-react';

type AssetList = 'colors' | 'fonts' | 'images' | 'tables' | 'rowSets' | 'cells';

interface TreeNode {
  id: string;
  name: string;
  kind: 'group' | 'page' | 'element' | 'asset' | 'variable';
  elementType?: ElementModel['type'];
  elementId?: string;
  pageId?: string;
  /** Para assets renombrables: lista de assets + id del item. */
  assetList?: AssetList;
  assetId?: string;
  children?: TreeNode[];
}

interface RenameCtx {
  renamingId: string | null;
  renamingKind: 'element' | 'page' | 'asset' | null;
  renamingAssetList: AssetList | null;
  startRename: (id: string, kind: 'element' | 'page' | 'asset', assetList?: AssetList) => void;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
}

const RenameContext = createContext<RenameCtx>({
  renamingId: null,
  renamingKind: null,
  renamingAssetList: null,
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
  const renameAssetItem = useDocumentStore((s) => s.renameAssetItem);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const setSelection = useSelectionStore((s) => s.select);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingKind, setRenamingKind] = useState<'element' | 'page' | 'asset' | null>(null);
  const [renamingAssetList, setRenamingAssetList] = useState<AssetList | null>(null);

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
    // El nodo canónico del elemento ahora tiene id por-grupo (pel:/pfl:/lel:).
    // Si el nodo enfocado ya corresponde a este elemento, no re-seleccionar.
    if (tree.focusedNode?.data.elementId === first) return;
    const containing = doc.pages.find((p) => p.elements.some((e) => e.id === first));
    const node =
      (containing && tree.get(`pel:${containing.id}:${first}`)) ||
      (containing && tree.get(`pfl:${containing.id}:${first}`)) ||
      tree.get(`lel:${first}`);
    if (node) tree.select(node.id);
  }, [selectedIds, doc.pages]);

  function onSelect(nodes: NodeApi<TreeNode>[]) {
    const elementIds = nodes
      .filter((n) => n.data.kind === 'element' && n.data.elementId)
      .map((n) => n.data.elementId!);
    if (elementIds.length > 0) {
      useUIStore.getState().setStyleTarget(null); // vuelve a propiedades del elemento
      const current = useSelectionStore.getState().selectedIds;
      if (!arraysEqual(elementIds, current)) setSelection(elementIds);
      const first = elementIds[0];
      const containing = doc.pages.find((p) => p.elements.some((e) => e.id === first));
      if (containing && containing.id !== currentPageId) setCurrentPage(containing.id);
      return;
    }
    // Clic en un COLOR del árbol → sus propiedades se editan abajo.
    const colorNode = nodes.find((n) => n.data.assetList === 'colors' && n.data.assetId);
    if (colorNode?.data.assetId) {
      useUIStore.getState().setStyleTarget({ kind: 'color', id: colorNode.data.assetId });
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
    renamingAssetList,
    startRename: (id, kind, assetList) => {
      setRenamingId(id);
      setRenamingKind(kind);
      setRenamingAssetList(assetList ?? null);
    },
    commitRename: (id, name) => {
      const trimmed = name.trim();
      if (renamingKind === 'page') {
        if (trimmed) updatePage(id, { name: trimmed });
      } else if (renamingKind === 'asset') {
        if (trimmed && renamingAssetList) renameAssetItem(renamingAssetList, id, trimmed);
      } else {
        updateElement(id, { name: trimmed || undefined });
      }
      setRenamingId(null);
      setRenamingKind(null);
      setRenamingAssetList(null);
    },
    cancelRename: () => {
      setRenamingId(null);
      setRenamingKind(null);
      setRenamingAssetList(null);
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
  const isRenamingAsset = d.kind === 'asset' && d.assetId != null && renamingId === d.assetId;
  const isRenaming = isRenamingEl || isRenamingPage || isRenamingAsset;

  const renameId = isRenamingEl ? d.elementId! : isRenamingAsset ? d.assetId! : d.pageId!;

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
            } else if (d.kind === 'asset' && d.assetId && d.assetList) {
              startRename(d.assetId, 'asset', d.assetList);
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
      case 'triangle': return TriangleIcon;
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
  // Icono propio por GRUPO del árbol (antes todos usaban la carpeta genérica).
  if (n.kind === 'group') {
    switch (n.id) {
      case 'g:pages': return Files;
      case 'g:elements': return Shapes;
      case 'g:flows': return GitBranch;
      case 'g:fonts': return ALargeSmall;
      case 'g:colors': return Palette;
      case 'g:images': return ImageIcon;
      case 'g:tables': return Table2;
      case 'g:rowSets': return Rows3;
      case 'g:cells': return LayoutGrid;
    }
  }
  // Items dentro de cada grupo (assets) — icono según su lista.
  if (n.kind === 'asset') {
    switch (n.assetList) {
      case 'colors': return Circle;
      case 'fonts': return Type;
      case 'images': return ImageIcon;
      case 'tables': return Table2;
      case 'rowSets': return Rows3;
      case 'cells': return LayoutGrid;
    }
    if (n.id.startsWith('flow:')) return GitBranch;
  }
  return Folder;
}

const TYPE_LABELS: Record<string, string> = {
  text: 'Texto', rect: 'Rectángulo', circle: 'Círculo', triangle: 'Triángulo', line: 'Línea',
  pen: 'Lápiz', image: 'Imagen', table: 'Tabla', qr: 'QR',
  dataField: 'Campo', frame: 'Área', flowable: 'Sub-área',
};

function buildTree(doc: DocumentModel): TreeNode[] {
  const a = doc.assets;

  // ⚠️ Los ids de NODO deben ser ÚNICOS en todo el árbol (react-arborist los usa
  // como key del posicionamiento virtual). El mismo elemento aparece en varios
  // grupos (Páginas y Elementos) → hay que darle un id de nodo DISTINTO en cada
  // grupo (con `key`), aunque el `elementId` real sea el mismo. Duplicar el id de
  // nodo hacía que las filas se solaparan al contraer y que el renombrado fuera
  // intermitente (apuntaba a dos filas a la vez).
  const elementNode = (e: ElementModel, pageId: string | undefined, key: string): TreeNode => ({
    id: `${key}:${e.id}`,
    name: e.name ?? (TYPE_LABELS[e.type] ?? e.type),
    kind: 'element',
    elementType: e.type,
    elementId: e.id,
    pageId,
  });

  const group = (id: string, name: string, children: TreeNode[]): TreeNode => ({
    id, name, kind: 'group', children,
  });

  const assetNodes = (
    prefix: string,
    items: { id: string; name: string }[],
    assetList?: AssetList,
  ): TreeNode[] =>
    items.map((i) => ({
      id: `${prefix}:${i.id}`,
      name: i.name,
      kind: 'asset' as const,
      ...(assetList ? { assetList, assetId: i.id } : {}),
    }));

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
              return {
                ...elementNode(e, p.id, `pel:${p.id}`),
                children: flowables.map((f) => elementNode(f, p.id, `pfl:${p.id}`)),
              };
            }
            return elementNode(e, p.id, `pel:${p.id}`);
          }),
      })),
    ),
    group('g:elements', 'Elementos',
      doc.pages.flatMap((p) => p.elements.filter((e) => e.type !== 'flowable').map((e) => elementNode(e, p.id, 'lel'))),
    ),
    group('g:flows', 'Flujos', assetNodes('flow', doc.flows)),
    group('g:fonts', 'Fuentes', assetNodes('font', a.fonts, 'fonts')),
    group('g:colors', 'Colores', assetNodes('color', a.colors, 'colors')),
    group('g:images', 'Imágenes', [...assetNodes('img', a.images, 'images'), ...imageElements]),
    group('g:tables', 'Tablas', assetNodes('tbl', a.tables, 'tables')),
    group('g:rowSets', 'Filas', assetNodes('rs', a.rowSets, 'rowSets')),
    group('g:cells', 'Celdas', assetNodes('cell', a.cells, 'cells')),
  ];
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
