import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, addEdge, useNodesState,
  useEdgesState, Handle, Position, MarkerType, useReactFlow,
} from '@xyflow/react';
import type { Node, Edge, Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box, Stack, Typography, useTheme } from '@mui/material';
import EmailIcon from '@mui/icons-material/Email';
import SmsIcon from '@mui/icons-material/Sms';
import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import type { CascadeChannel, CascadeStep } from '../../services/cascadeService';
import type { MessageTemplate } from '../../services/messageTemplatesService';

/**
 * Editor de la CASCADA como FLUJO (tipo React Flow): nodos personalizados (Inicio → canales →
 * Confirmado), aristas ANIMADAS con dirección, y arrastrar-y-soltar desde la paleta. Produce el
 * MISMO `steps[]` (orden de canales) que el modo básico — solo cambia la forma de definirlo.
 */

const CHANNELS: { ch: CascadeChannel; label: string; color: string; Icon: typeof EmailIcon }[] = [
  { ch: 'EM', label: 'Correo', color: '#0075be', Icon: EmailIcon },
  { ch: 'WSP', label: 'WhatsApp', color: '#25D366', Icon: WhatsAppIcon },
  { ch: 'SMS', label: 'SMS', color: '#7a5cff', Icon: SmsIcon },
  { ch: 'VOZ', label: 'Voz', color: '#ff9d2e', Icon: RecordVoiceOverIcon },
];
const CH_META: Record<string, (typeof CHANNELS)[number]> = Object.fromEntries(CHANNELS.map((c) => [c.ch, c]));
const DND_MIME = 'application/mc-cascade-channel';

/** Plantillas vigentes (para los selects dentro de los nodos, sin datos "stale"). */
const TemplatesCtx = createContext<{ sms: MessageTemplate[]; wsp: MessageTemplate[] }>({ sms: [], wsp: [] });
/** Acciones sobre los nodos (estables), para no meter callbacks en node.data. */
const ActionsCtx = createContext<{ update: (id: string, patch: Partial<CascadeStep>) => void; remove: (id: string) => void }>({
  update: () => {}, remove: () => {},
});

const handleStyle = (color: string) => ({ width: 11, height: 11, background: color, border: '2px solid #fff' });

/* --------------------------- Nodos personalizados --------------------------- */
const InicioNode = () => {
  const t = useTheme();
  return (
    <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: t.palette.mode === 'dark' ? '#12203a' : '#0075be', color: '#fff', minWidth: 150, boxShadow: 3 }}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <PlayArrowIcon fontSize="small" />
        <Typography variant="caption" fontWeight={800}>Base de contactos</Typography>
      </Stack>
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
      <Stack direction="row" spacing={0.5} alignItems="center">
        <CheckCircleIcon fontSize="small" />
        <Typography variant="caption" fontWeight={800}>Confirmado</Typography>
      </Stack>
      <Typography variant="caption" sx={{ opacity: 0.85, fontSize: 10 }}>entrega lograda</Typography>
    </Box>
  );
};

const CanalNode = ({ id, data }: { id: string; data: { channel: CascadeChannel; content: string } }) => {
  const t = useTheme();
  const { sms, wsp } = useContext(TemplatesCtx);
  const { update, remove } = useContext(ActionsCtx);
  const meta = CH_META[data.channel];
  const Icon = meta.Icon;
  const inputSx: React.CSSProperties = {
    width: '100%', marginTop: 6, padding: '6px 8px', borderRadius: 8, fontSize: 12,
    border: `1px solid ${t.palette.divider}`, background: t.palette.background.default, color: t.palette.text.primary,
  };
  return (
    <Box sx={{
      width: 210, borderRadius: 2, bgcolor: t.palette.background.paper, color: t.palette.text.primary,
      border: `1px solid ${t.palette.divider}`, borderTop: `3px solid ${meta.color}`, boxShadow: 4, p: 1.25,
    }}>
      <Handle type="target" position={Position.Left} style={handleStyle(meta.color)} />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Icon sx={{ fontSize: 16, color: meta.color }} />
          <Typography variant="caption" fontWeight={800}>{meta.label}</Typography>
        </Stack>
        <button className="nodrag" onClick={() => remove(id)} title="Quitar"
          style={{ border: 'none', background: 'transparent', color: t.palette.text.secondary, cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
      </Stack>

      <select className="nodrag" value={data.channel} style={inputSx}
        onChange={(e) => update(id, { channel: e.target.value as CascadeChannel, content: '' })}>
        {CHANNELS.map((c) => <option key={c.ch} value={c.ch}>{c.label}</option>)}
      </select>

      {data.channel === 'SMS' ? (
        <select className="nodrag" value={data.content} style={inputSx} onChange={(e) => update(id, { content: e.target.value })}>
          <option value="">— Plantilla SMS —</option>
          {sms.map((tpl) => <option key={tpl.messageTemplateId} value={tpl.body ?? ''}>{tpl.name}</option>)}
        </select>
      ) : data.channel === 'WSP' ? (
        <select className="nodrag" value={data.content} style={inputSx} onChange={(e) => update(id, { content: e.target.value })}>
          <option value="">— Plantilla HSM —</option>
          {wsp.map((tpl) => <option key={tpl.messageTemplateId} value={tpl.hsmName ?? ''}>{tpl.name}</option>)}
        </select>
      ) : (
        <input className="nodrag" value={data.content} style={inputSx}
          placeholder={data.channel === 'EM' ? 'Plantilla SES (nombre)' : 'Mensaje de voz…'}
          onChange={(e) => update(id, { content: e.target.value })} />
      )}
      <Handle type="source" position={Position.Right} style={handleStyle(meta.color)} />
    </Box>
  );
};

const nodeTypes = { inicio: InicioNode, fin: FinNode, canal: CanalNode };

/* --------------------------- Derivar steps del grafo --------------------------- */
/** Sigue la cadena Inicio → canal → canal → … (Fin la termina) y devuelve el orden de canales. */
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
    const d = byId[next].data as { channel: CascadeChannel; content?: string };
    steps.push({ channel: d.channel, content: d.content || '' });
    current = next;
  }
  return steps;
}

let idSeq = 1;
const newId = () => `n${idSeq++}`;

function buildInitial(initialSteps: CascadeStep[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [{ id: 'inicio', type: 'inicio', position: { x: 0, y: 120 }, data: {} }];
  const edges: Edge[] = [];
  let prev = 'inicio';
  initialSteps.forEach((st, i) => {
    const nid = newId();
    nodes.push({ id: nid, type: 'canal', position: { x: 240 * (i + 1), y: 90 }, data: { channel: st.channel, content: st.content } });
    edges.push({ id: `e-${prev}-${nid}`, source: prev, target: nid, animated: true, markerEnd: { type: MarkerType.ArrowClosed } });
    prev = nid;
  });
  nodes.push({ id: 'fin', type: 'fin', position: { x: 240 * (initialSteps.length + 1), y: 120 }, data: {} });
  edges.push({ id: `e-${prev}-fin`, source: prev, target: 'fin', animated: true, markerEnd: { type: MarkerType.ArrowClosed } });
  return { nodes, edges };
}

/* --------------------------- Lienzo interno --------------------------- */
const Inner = ({ initialSteps, onStepsChange }: { initialSteps: CascadeStep[]; onStepsChange: (s: CascadeStep[]) => void }) => {
  const { screenToFlowPosition } = useReactFlow();
  const initial = useMemo(() => buildInitial(initialSteps), []); // solo al montar
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);

  const update = useCallback((nid: string, patch: Partial<CascadeStep>) => {
    setNodes((nds) => nds.map((n) => (n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);
  const remove = useCallback((nid: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nid));
    setEdges((eds) => eds.filter((e) => e.source !== nid && e.target !== nid));
  }, [setNodes, setEdges]);
  const actions = useMemo(() => ({ update, remove }), [update, remove]);

  useEffect(() => { onStepsChange(deriveSteps(nodes, edges)); }, [nodes, edges, onStepsChange]);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
  }, [setEdges]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const ch = e.dataTransfer.getData(DND_MIME) as CascadeChannel;
    if (!ch) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setNodes((nds) => nds.concat({ id: newId(), type: 'canal', position, data: { channel: ch, content: '' } }));
  }, [screenToFlowPosition, setNodes]);

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
            nodes={nodes} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            fitView proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ animated: true, markerEnd: { type: MarkerType.ArrowClosed } }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable style={{ height: 80, width: 120 }} />
          </ReactFlow>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Conecta los nodos del punto derecho al izquierdo. El orden del flujo (Inicio → … → Confirmado)
          define la prioridad de escalamiento.
        </Typography>
      </Box>
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
