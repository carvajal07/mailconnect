import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState,
  useEdgesState, Handle, Position, MarkerType, useReactFlow, BaseEdge, EdgeLabelRenderer, getBezierPath,
} from '@xyflow/react';
import type { Node, Edge, Connection, EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Box, Stack, Typography, useTheme, Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, MenuItem,
} from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SettingsIcon from '@mui/icons-material/Settings';
import ScheduleIcon from '@mui/icons-material/Schedule';
import type { CascadeChannel, CascadeStep, SuccessCriterion } from '../../services/cascadeService';
import type { MessageTemplate } from '../../services/messageTemplatesService';

/**
 * Editor de la CASCADA como FLUJO (React Flow). Reglas del grafo:
 *  - Canal FIJO por nodo (se elige al arrastrarlo; no se cambia dentro).
 *  - UNA conexión por handle (una salida por nodo, una entrada por nodo) → cadena limpia.
 *  - SIN loops (isValidConnection rechaza ciclos) → orden topológico correcto.
 *  - Aristas ELIMINABLES (botón ✕ en la arista + tecla Supr).
 *  - Doble clic en un nodo → configura plantilla, tiempo de espera y criterio de confirmación.
 * Produce `steps[]` (con waitMinutes/successCriterion por paso) que el backend ya entiende.
 */

const CHANNELS: { ch: CascadeChannel; label: string; color: string; Icon: typeof EmailIcon }[] = [
  { ch: 'EM', label: 'Correo', color: '#0075be', Icon: EmailIcon },
  { ch: 'WSP', label: 'WhatsApp', color: '#25D366', Icon: WhatsAppIcon },
  { ch: 'SMS', label: 'SMS', color: '#7a5cff', Icon: SmsIcon },
  { ch: 'VOZ', label: 'Voz', color: '#ff9d2e', Icon: RecordVoiceOverIcon },
];
const CH_META: Record<string, (typeof CHANNELS)[number]> = Object.fromEntries(CHANNELS.map((c) => [c.ch, c]));
const CRITERION_LABEL: Record<SuccessCriterion, string> = { sent: 'Enviado', delivered: 'Entregado', read: 'Leído' };
const DND_MIME = 'application/mc-cascade-channel';

interface CanalData { channel: CascadeChannel; content: string; waitMinutes?: number; successCriterion?: SuccessCriterion }

/* --------------------------- Tiempo de espera con unidad (item 1) ---------------------------
 * El backend siempre recibe MINUTOS (waitMinutes); en la UI el usuario elige la unidad
 * (minutos/horas/días) y escribe el número. Convertimos en ambos sentidos. */
export type WaitUnit = 'min' | 'hora' | 'dia';
const UNIT_FACTOR: Record<WaitUnit, number> = { min: 1, hora: 60, dia: 1440 };
/** minutos -> {valor, unidad} eligiendo la unidad "entera" más grande (1440→1 día, 60→1 h). */
export function splitWait(mins?: number): { value: string; unit: WaitUnit } {
  if (!mins || mins <= 0) return { value: '', unit: 'hora' };
  if (mins % 1440 === 0) return { value: String(mins / 1440), unit: 'dia' };
  if (mins % 60 === 0) return { value: String(mins / 60), unit: 'hora' };
  return { value: String(mins), unit: 'min' };
}
/** {valor, unidad} -> minutos (o undefined si está vacío/ inválido → usa la espera del run). */
export function toMinutes(value: string, unit: WaitUnit): number | undefined {
  const n = parseFloat(value);
  if (!value || isNaN(n) || n <= 0) return undefined;
  return Math.max(1, Math.round(n * UNIT_FACTOR[unit]));
}
/** Etiqueta corta para el nodo (2 días · 1 h · 30 min · espera del run). */
function waitLabel(mins?: number): string {
  if (!mins || mins <= 0) return 'espera del run';
  if (mins % 1440 === 0) { const d = mins / 1440; return `${d} día${d === 1 ? '' : 's'}`; }
  if (mins % 60 === 0) { const h = mins / 60; return `${h} h`; }
  return `${mins} min`;
}

const TemplatesCtx = createContext<{ sms: MessageTemplate[]; wsp: MessageTemplate[] }>({ sms: [], wsp: [] });
const ActionsCtx = createContext<{ remove: (id: string) => void; removeEdge: (id: string) => void }>({
  remove: () => {}, removeEdge: () => {},
});

const handleStyle = (color: string) => ({ width: 11, height: 11, background: color, border: '2px solid #fff' });

/** Nombre legible del contenido elegido (plantilla) para mostrar en el nodo. */
function contentLabel(channel: CascadeChannel, content: string, sms: MessageTemplate[], wsp: MessageTemplate[]): string {
  if (!content) return 'Sin configurar';
  if (channel === 'SMS') return sms.find((t) => (t.body ?? '') === content)?.name ?? content.slice(0, 24);
  if (channel === 'WSP') return wsp.find((t) => (t.hsmName ?? '') === content)?.name ?? content;
  return content.length > 26 ? content.slice(0, 26) + '…' : content;
}

/* --------------------------- Nodos --------------------------- */
const InicioNode = () => {
  const t = useTheme();
  return (
    <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: t.palette.mode === 'dark' ? '#12203a' : '#0075be', color: '#fff', minWidth: 150, boxShadow: 3 }}>
      <Stack direction="row" spacing={0.5} alignItems="center"><PlayArrowIcon fontSize="small" /><Typography variant="caption" fontWeight={800}>Base de contactos</Typography></Stack>
      <Typography variant="caption" sx={{ opacity: 0.8, fontSize: 10 }}>inicio del flujo</Typography>
      <Handle type="source" position={Position.Right} style={handleStyle('#00c3ff')} />
    </Box>
  );
};

const FinNode = () => {
  const t = useTheme();
  return (
    <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: t.palette.mode === 'dark' ? '#123524' : '#159467', color: '#fff', minWidth: 140, boxShadow: 3 }}>
      <Handle type="target" position={Position.Left} style={handleStyle('#2ba862')} />
      <Stack direction="row" spacing={0.5} alignItems="center"><CheckCircleIcon fontSize="small" /><Typography variant="caption" fontWeight={800}>Confirmado</Typography></Stack>
      <Typography variant="caption" sx={{ opacity: 0.85, fontSize: 10 }}>entrega lograda</Typography>
    </Box>
  );
};

const CanalNode = ({ id, data }: { id: string; data: CanalData }) => {
  const t = useTheme();
  const { sms, wsp } = useContext(TemplatesCtx);
  const { remove } = useContext(ActionsCtx);
  const meta = CH_META[data.channel];
  const Icon = meta.Icon;
  const label = contentLabel(data.channel, data.content, sms, wsp);
  const configured = !!data.content;
  return (
    <Box sx={{
      width: 210, borderRadius: 2, bgcolor: t.palette.background.paper, color: t.palette.text.primary,
      border: `1px solid ${configured ? t.palette.divider : t.palette.warning.main}`, borderTop: `3px solid ${meta.color}`,
      boxShadow: 4, p: 1.25, cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Left} style={handleStyle(meta.color)} />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        {/* Canal FIJO (item 5): no hay selector; se define al arrastrar. */}
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Icon sx={{ fontSize: 16, color: meta.color }} /><Typography variant="caption" fontWeight={800}>{meta.label}</Typography>
        </Stack>
        <button className="nodrag" onClick={(e) => { e.stopPropagation(); remove(id); }} title="Quitar"
          style={{ border: 'none', background: 'transparent', color: t.palette.text.secondary, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
      </Stack>
      <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600, color: configured ? 'text.primary' : 'warning.main', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, color: 'text.secondary' }}>
        <ScheduleIcon sx={{ fontSize: 13 }} />
        <Typography variant="caption">{waitLabel(data.waitMinutes)} · {data.successCriterion ? CRITERION_LABEL[data.successCriterion] : 'criterio del run'}</Typography>
      </Stack>
      <Stack direction="row" spacing={0.3} alignItems="center" sx={{ mt: 0.5, color: 'primary.main' }}>
        <SettingsIcon sx={{ fontSize: 12 }} /><Typography variant="caption" sx={{ fontSize: 10 }}>doble clic para configurar</Typography>
      </Stack>
      <Handle type="source" position={Position.Right} style={handleStyle(meta.color)} />
    </Box>
  );
};

/* --------------------------- Arista eliminable (item 1) --------------------------- */
const DeletableEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd }: EdgeProps) => {
  const { removeEdge } = useContext(ActionsCtx);
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ strokeWidth: 2 }} />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan"
          onClick={() => removeEdge(id)}
          title="Eliminar conexión"
          style={{
            position: 'absolute', transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all', width: 20, height: 20, borderRadius: '50%', border: '1px solid #cfd6e0',
            background: '#fff', color: '#d14343', cursor: 'pointer', fontSize: 12, lineHeight: 1, boxShadow: '0 1px 3px rgba(0,0,0,.2)',
          }}
        >✕</button>
      </EdgeLabelRenderer>
    </>
  );
};

const nodeTypes = { inicio: InicioNode, fin: FinNode, canal: CanalNode };
const edgeTypes = { deletable: DeletableEdge };

/* --------------------------- Derivar steps (orden topológico) --------------------------- */
export function deriveSteps(nodes: Node[], edges: Edge[]): CascadeStep[] {
  const byId: Record<string, Node> = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const out: Record<string, string[]> = {};
  edges.forEach((e) => { (out[e.source] ||= []).push(e.target); });
  const inicio = nodes.find((n) => n.type === 'inicio');
  if (!inicio) return [];
  const steps: CascadeStep[] = [];
  const seen = new Set<string>();
  let current = inicio.id;
  for (let guard = 0; guard < 50; guard++) {
    const next = (out[current] || []).find((tid) => byId[tid] && byId[tid].type === 'canal' && !seen.has(tid));
    if (!next) break;
    seen.add(next);
    const d = byId[next].data as unknown as CanalData;
    steps.push({ channel: d.channel, content: d.content || '', waitMinutes: d.waitMinutes, successCriterion: d.successCriterion });
    current = next;
  }
  return steps;
}

let idSeq = 1;
const newId = () => `n${idSeq++}`;
const EDGE = { type: 'deletable', animated: true, markerEnd: { type: MarkerType.ArrowClosed } } as const;

function buildInitial(initialSteps: CascadeStep[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{ id: 'inicio', type: 'inicio', position: { x: 0, y: 120 }, data: {}, deletable: false }];
  const edges: Edge[] = [];
  let prev = 'inicio';
  initialSteps.forEach((st, i) => {
    const nid = newId();
    nodes.push({ id: nid, type: 'canal', position: { x: 250 * (i + 1), y: 80 }, data: { channel: st.channel, content: st.content, waitMinutes: st.waitMinutes, successCriterion: st.successCriterion } });
    edges.push({ id: `e-${prev}-${nid}`, source: prev, target: nid, ...EDGE });
    prev = nid;
  });
  nodes.push({ id: 'fin', type: 'fin', position: { x: 250 * (initialSteps.length + 1), y: 120 }, data: {}, deletable: false });
  edges.push({ id: `e-${prev}-fin`, source: prev, target: 'fin', ...EDGE });
  return { nodes, edges };
}

/* --------------------------- Diálogo de configuración (item 6) --------------------------- */
const NodeConfigDialog = ({ node, onClose, onSave }: { node: Node | null; onClose: () => void; onSave: (id: string, patch: Partial<CanalData>) => void }) => {
  const { sms, wsp } = useContext(TemplatesCtx);
  const data = (node?.data ?? {}) as unknown as CanalData;
  const [content, setContent] = useState('');
  const [wait, setWait] = useState('');
  const [waitUnit, setWaitUnit] = useState<WaitUnit>('hora');
  const [criterion, setCriterion] = useState<SuccessCriterion | ''>('');
  useEffect(() => {
    if (node) {
      setContent(data.content || '');
      const s = splitWait(data.waitMinutes);
      setWait(s.value); setWaitUnit(s.unit);
      setCriterion(data.successCriterion || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);
  if (!node) return null;
  const ch = data.channel;
  const meta = CH_META[ch];
  const save = () => {
    onSave(node.id, {
      content,
      waitMinutes: toMinutes(wait, waitUnit),
      successCriterion: criterion || undefined,
    });
    onClose();
  };
  return (
    <Dialog open={!!node} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Configurar módulo · {meta.label}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {ch === 'SMS' ? (
            <TextField select fullWidth size="small" label="Plantilla SMS" value={content} onChange={(e) => setContent(e.target.value)}>
              <MenuItem value="">— Elige una —</MenuItem>
              {sms.map((t) => <MenuItem key={t.messageTemplateId} value={t.body ?? ''}>{t.name}</MenuItem>)}
            </TextField>
          ) : ch === 'WSP' ? (
            <TextField select fullWidth size="small" label="Plantilla WhatsApp (HSM)" value={content} onChange={(e) => setContent(e.target.value)}>
              <MenuItem value="">— Elige una —</MenuItem>
              {wsp.map((t) => <MenuItem key={t.messageTemplateId} value={t.hsmName ?? ''}>{t.name} · {t.hsmName}</MenuItem>)}
            </TextField>
          ) : ch === 'EM' ? (
            <TextField fullWidth size="small" label="Plantilla de correo (nombre SES)" value={content} onChange={(e) => setContent(e.target.value)} placeholder="empresa_0001_bienvenida" />
          ) : (
            <TextField fullWidth size="small" multiline minRows={2} label="Mensaje de voz (texto a voz)" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Hola {{Nombre}}…" />
          )}
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Tiempo de espera antes de escalar
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField size="small" type="number" label="Cantidad" value={wait} onChange={(e) => setWait(e.target.value)} placeholder="Run" inputProps={{ min: 1, step: 1 }} sx={{ flex: 1 }} />
              <TextField select size="small" label="Unidad" value={waitUnit} onChange={(e) => setWaitUnit(e.target.value as WaitUnit)} sx={{ width: 130 }}>
                <MenuItem value="min">Minutos</MenuItem>
                <MenuItem value="hora">Horas</MenuItem>
                <MenuItem value="dia">Días</MenuItem>
              </TextField>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Vacío = usa la espera del run.
            </Typography>
          </Box>
          <TextField select fullWidth size="small" label="Confirmar cuando esté" value={criterion} onChange={(e) => setCriterion(e.target.value as SuccessCriterion | '')}>
            <MenuItem value="">Usar el criterio del run</MenuItem>
            <MenuItem value="sent">Enviado</MenuItem>
            <MenuItem value="delivered">Entregado</MenuItem>
            <MenuItem value="read">Leído / abierto</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={save}>Guardar</Button>
      </DialogActions>
    </Dialog>
  );
};

/* --------------------------- Lienzo interno --------------------------- */
const Inner = ({ initialSteps, onStepsChange }: { initialSteps: CascadeStep[]; onStepsChange: (s: CascadeStep[]) => void }) => {
  const { screenToFlowPosition } = useReactFlow();
  const initial = useMemo(() => buildInitial(initialSteps), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [configNode, setConfigNode] = useState<Node | null>(null);

  const remove = useCallback((nid: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nid));
    setEdges((eds) => eds.filter((e) => e.source !== nid && e.target !== nid));
  }, [setNodes, setEdges]);
  const removeEdge = useCallback((eid: string) => setEdges((eds) => eds.filter((e) => e.id !== eid)), [setEdges]);
  const updateNodeData = useCallback((nid: string, patch: Partial<CanalData>) => {
    setNodes((nds) => nds.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);
  const actions = useMemo(() => ({ remove, removeEdge }), [remove, removeEdge]);

  useEffect(() => { onStepsChange(deriveSteps(nodes, edges)); }, [nodes, edges, onStepsChange]);

  // item 2: UNA conexión por handle (quita la salida previa del source y la entrada previa del target).
  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => {
      const filtered = eds.filter((e) => e.source !== params.source && e.target !== params.target);
      return addEdge({ ...params, ...EDGE }, filtered);
    });
  }, [setEdges]);

  // item 3: sin loops (rechaza self y ciclos) — el resto del orden lo garantiza el single-in/out.
  const isValidConnection = useCallback((conn: Connection | Edge) => {
    if (conn.source === conn.target) return false;
    const adj: Record<string, string[]> = {};
    edges.forEach((e) => { (adj[e.source] ||= []).push(e.target); });
    const stack = [conn.target as string];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop() as string;
      if (cur === conn.source) return false; // target ya alcanza a source → ciclo
      if (seen.has(cur)) continue;
      seen.add(cur);
      (adj[cur] || []).forEach((n) => stack.push(n));
    }
    return true;
  }, [edges]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const ch = e.dataTransfer.getData(DND_MIME) as CascadeChannel;
    if (!ch) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((nds) => nds.concat({ id: newId(), type: 'canal', position, data: { channel: ch, content: '' } }));
  }, [screenToFlowPosition, setNodes]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'canal') setConfigNode(node);
  }, []);

  return (
    <ActionsCtx.Provider value={actions}>
      <Box>
        <Stack direction="row" spacing={1} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" color="text.secondary">Arrastra un canal al lienzo →</Typography>
          {CHANNELS.map((c) => (
            <Box key={c.ch} draggable
              onDragStart={(e) => { e.dataTransfer.setData(DND_MIME, c.ch); e.dataTransfer.effectAllowed = 'move'; }}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.5, borderRadius: 1.5, cursor: 'grab',
                border: '1px solid', borderColor: 'divider', borderLeft: `3px solid ${c.color}`, bgcolor: 'background.paper', fontSize: 12, fontWeight: 700 }}>
              <c.Icon sx={{ fontSize: 15, color: c.color }} /> {c.label}
            </Box>
          ))}
        </Stack>

        <Box onDrop={onDrop} onDragOver={onDragOver}
          sx={{ height: 460, border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden',
            '& .react-flow__attribution': { display: 'none' } }}>
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            isValidConnection={isValidConnection} onNodeDoubleClick={onNodeDoubleClick}
            deleteKeyCode={['Backspace', 'Delete']} fitView proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={EDGE}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ height: 80, width: 120 }} />
          </ReactFlow>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Conecta del punto derecho al izquierdo (una sola conexión por nodo, sin ciclos). <strong>Doble clic</strong> en
          un módulo para elegir plantilla, tiempo de espera y criterio. La <strong>✕</strong> sobre una conexión la elimina.
        </Typography>
      </Box>
      <NodeConfigDialog node={configNode} onClose={() => setConfigNode(null)} onSave={updateNodeData} />
    </ActionsCtx.Provider>
  );
};

export const CascadaFlowBuilder = ({ initialSteps, onStepsChange, smsTemplates, wspTemplates }: {
  initialSteps: CascadeStep[];
  onStepsChange: (s: CascadeStep[]) => void;
  smsTemplates: MessageTemplate[];
  wspTemplates: MessageTemplate[];
}) => (
  <TemplatesCtx.Provider value={{ sms: smsTemplates, wsp: wspTemplates }}>
    <ReactFlowProvider>
      <Inner initialSteps={initialSteps} onStepsChange={onStepsChange} />
    </ReactFlowProvider>
  </TemplatesCtx.Provider>
);
