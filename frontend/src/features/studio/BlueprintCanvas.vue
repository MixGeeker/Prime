<template>
  <div ref="container" class="canvas"></div>
</template>

<script setup lang="ts">
import { createApp, onBeforeUnmount, onMounted, ref } from 'vue';
import { ClassicPreset, NodeEditor, type GetSchemes } from 'rete';
import { AreaExtensions, AreaPlugin } from 'rete-area-plugin';
import { ConnectionPlugin, Presets as ConnectionPresets } from 'rete-connection-plugin';
import { VuePlugin, Presets as VuePresets } from 'rete-vue-plugin';
import { HistoryExtensions, HistoryPlugin, Presets as HistoryPresets } from 'rete-history-plugin';

import type { GraphEdge, GraphJsonV1, GraphNode, NodeCatalog, NodeDef, ValueType } from '@/engine/types';
import {
  getUiNodePositionMap,
  removeEdgesForNode,
  setUiNodePosition,
  wouldCreateValueCycle,
} from './graph';

type Connection = ClassicPreset.Connection<ClassicPreset.Node, ClassicPreset.Node> & {
  isLoop?: boolean;
};
type Schemes = GetSchemes<ClassicPreset.Node, Connection>;

const props = defineProps<{
  catalog: NodeCatalog;
  graph: GraphJsonV1;
}>();

const emit = defineEmits<{
  (e: 'select-node', nodeId: string | null): void;
  (e: 'dirty'): void;
}>();

const container = ref<HTMLElement | null>(null);

let editor: NodeEditor<Schemes> | null = null;
let area: AreaPlugin<Schemes, any> | null = null;

const sockets: Record<ValueType | 'exec', ClassicPreset.Socket> = {
  exec: new ClassicPreset.Socket('exec'),
  Decimal: new ClassicPreset.Socket('Decimal'),
  Ratio: new ClassicPreset.Socket('Ratio'),
  String: new ClassicPreset.Socket('String'),
  Boolean: new ClassicPreset.Socket('Boolean'),
  DateTime: new ClassicPreset.Socket('DateTime'),
  Json: new ClassicPreset.Socket('Json'),
};

function portKey(kind: 'in' | 'out' | 'exec_in' | 'exec_out', name: string): string {
  return `${kind}:${name}`;
}

function isExecKey(key: string): boolean {
  return key.startsWith('exec_in:') || key.startsWith('exec_out:');
}

function stripKeyPrefix(key: string): string {
  const idx = key.indexOf(':');
  return idx >= 0 ? key.slice(idx + 1) : key;
}

function findNodeDef(nodeType: string): NodeDef | undefined {
  return props.catalog.nodes.find((n) => n.nodeType === nodeType);
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function getStringParam(params: Record<string, unknown> | undefined, key: string): string | null {
  const v = params?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function buildNodeLabel(def: NodeDef, graphNode: GraphNode): string {
  const nodeType = graphNode.nodeType;
  const params = (graphNode.params ?? {}) as Record<string, unknown>;

  if (nodeType.startsWith('outputs.set.')) {
    const key = getStringParam(params, 'key');
    return key ? `${def.title}: ${truncateText(key, 24)}` : def.title;
  }

  if (nodeType.startsWith('inputs.params.') || nodeType.startsWith('inputs.globals.')) {
    const name = getStringParam(params, 'name');
    return name ? `${def.title}: ${truncateText(name, 24)}` : def.title;
  }

  if (nodeType.startsWith('locals.get.') || nodeType.startsWith('locals.set.')) {
    const name = getStringParam(params, 'name');
    return name ? `${def.title}: ${truncateText(name, 24)}` : def.title;
  }

  if (nodeType === 'json.select') {
    const mode = getStringParam(params, 'mode') ?? 'browse';
    if (mode === 'path') {
      const path = getStringParam(params, 'path');
      return path ? `${def.title}: ${truncateText(path, 28)}` : def.title;
    }
    const key = getStringParam(params, 'key');
    return key ? `${def.title}: ${truncateText(key, 28)}` : def.title;
  }

  if (nodeType === 'flow.call_definition') {
    const id = getStringParam(params, 'definitionId');
    return id ? `${def.title}: ${truncateText(id, 28)}` : def.title;
  }

  return def.title;
}

function buildReteNode(def: NodeDef, graphNode: GraphNode) {
  const node = new ClassicPreset.Node(buildNodeLabel(def, graphNode));
  node.id = graphNode.id;

  // value inputs/outputs
  for (const input of def.inputs) {
    node.addInput(
      portKey('in', input.name) as any,
      new ClassicPreset.Input(sockets[input.valueType], input.name, false),
    );
  }
  for (const output of def.outputs) {
    node.addOutput(
      portKey('out', output.name) as any,
      new ClassicPreset.Output(sockets[output.valueType], output.name, true),
    );
  }

  // exec inputs/outputs（控制流）
  for (const input of def.execInputs ?? []) {
    node.addInput(
      portKey('exec_in', input.name) as any,
      new ClassicPreset.Input(sockets.exec, input.name, false),
    );
  }
  for (const output of def.execOutputs ?? []) {
    // exec 输出端口最多 1 条出边（图层约束），因此 output.multipleConnections=false
    node.addOutput(
      portKey('exec_out', output.name) as any,
      new ClassicPreset.Output(sockets.exec, output.name, false),
    );
  }

  return node;
}

function toGraphEdgeFromConnection(conn: Connection): { edge: GraphEdge; kind: 'value' | 'exec' } | null {
  const sourceKey = String(conn.sourceOutput);
  const targetKey = String(conn.targetInput);

  const kind = isExecKey(sourceKey) || isExecKey(targetKey) ? 'exec' : 'value';
  const edge: GraphEdge = {
    from: { nodeId: String(conn.source), port: stripKeyPrefix(sourceKey) },
    to: { nodeId: String(conn.target), port: stripKeyPrefix(targetKey) },
  };
  return { edge, kind };
}

function removeGraphEdge(kind: 'value' | 'exec', edge: GraphEdge) {
  const list = kind === 'exec' ? props.graph.execEdges : props.graph.edges;
  const idx = list.findIndex(
    (e) =>
      e.from.nodeId === edge.from.nodeId &&
      e.from.port === edge.from.port &&
      e.to.nodeId === edge.to.nodeId &&
      e.to.port === edge.to.port,
  );
  if (idx >= 0) {
    list.splice(idx, 1);
    emit('dirty');
  }
}

function upsertGraphEdge(kind: 'value' | 'exec', edge: GraphEdge) {
  const list = kind === 'exec' ? props.graph.execEdges : props.graph.edges;
  const exists = list.some(
    (e) =>
      e.from.nodeId === edge.from.nodeId &&
      e.from.port === edge.from.port &&
      e.to.nodeId === edge.to.nodeId &&
      e.to.port === edge.to.port,
  );
  if (!exists) {
    list.push(edge);
    emit('dirty');
  }
}

function enforceConnectionConstraints(conn: Connection): boolean {
  if (!editor) return true;
  const sourceNode = editor.getNode(conn.source);
  const targetNode = editor.getNode(conn.target);
  if (!sourceNode || !targetNode) return false;

  const sourceKey = String(conn.sourceOutput);
  const targetKey = String(conn.targetInput);
  const sourcePort = (sourceNode.outputs as any)[sourceKey] as ClassicPreset.Output<ClassicPreset.Socket> | undefined;
  const targetPort = (targetNode.inputs as any)[targetKey] as ClassicPreset.Input<ClassicPreset.Socket> | undefined;
  if (!sourcePort || !targetPort) return false;

  // socket type：exec 与 value 互斥；value 允许子类型赋值（Ratio ⊂ Decimal）
  const sourceType = sourcePort.socket.name;
  const targetType = targetPort.socket.name;
  const isExec = sourceType === 'exec';

  if (isExec) {
    if (targetType !== 'exec') return false;
  } else {
    if (targetType === 'exec') return false;
    const ok = sourceType === targetType || (sourceType === 'Ratio' && targetType === 'Decimal');
    if (!ok) return false;
  }

  // 目标 input 端口最多 1 条入边（MVP）
  const hasInputConn = editor
    .getConnections()
    .some((c) => c.target === conn.target && String(c.targetInput) === targetKey);
  if (hasInputConn) return false;

  // exec 输出端口最多 1 条出边（MVP）
  if (isExec) {
    const hasOutputConn = editor
      .getConnections()
      .some((c) => c.source === conn.source && String(c.sourceOutput) === sourceKey);
    if (hasOutputConn) return false;
  }

  // value edges 必须是 DAG：新增连接若导致成环，则拒绝（execEdges 允许环）
  if (!isExec) {
    const next = toGraphEdgeFromConnection(conn);
    if (next?.kind === 'value') {
      if (wouldCreateValueCycle(props.graph.edges, next.edge)) return false;
    }
  }

  return true;
}

async function init() {
  if (!container.value) return;

  editor = new NodeEditor<Schemes>();
  area = new AreaPlugin<Schemes, any>(container.value);
  const connection = new ConnectionPlugin<Schemes, any>();
  const render = new VuePlugin<Schemes, any>({
    setup: (context) => createApp(context),
  });
  const history = new HistoryPlugin<Schemes>({ timing: 200 });

  connection.addPreset(ConnectionPresets.classic.setup());
  render.addPreset(VuePresets.classic.setup());
  history.addPreset(HistoryPresets.classic.setup());
  HistoryExtensions.keyboard(history);

  editor.use(area);
  area.use(connection);
  area.use(render);
  area.use(history);

  // 可选：节点选择（用于右侧参数面板）
  const selector = AreaExtensions.selector();
  AreaExtensions.selectableNodes(area, selector, { accumulating: AreaExtensions.accumulateOnCtrl() });

  // 禁止非法连线（在 addConnection 之前拦截）
  editor.addPipe((context) => {
    if (context.type === 'connectioncreate') {
      const ok = enforceConnectionConstraints(context.data);
      return ok ? context : undefined;
    }
    return context;
  });

  // 同步：节点选择/移动、节点/连线增删
  area.addPipe((context) => {
    if (context.type === 'nodepicked') {
      emit('select-node', String(context.data.id));
    }
    if (context.type === 'nodetranslated') {
      setUiNodePosition(props.graph, String(context.data.id), {
        x: context.data.position.x,
        y: context.data.position.y,
      });
      emit('dirty');
    }
    return context;
  });

  editor.addPipe((context) => {
    if (context.type === 'connectioncreated') {
      const mapped = toGraphEdgeFromConnection(context.data);
      if (mapped) upsertGraphEdge(mapped.kind, mapped.edge);
    }
    if (context.type === 'connectionremoved') {
      const mapped = toGraphEdgeFromConnection(context.data);
      if (mapped) removeGraphEdge(mapped.kind, mapped.edge);
    }
    if (context.type === 'noderemoved') {
      const nodeId = String(context.data.id);
      props.graph.nodes = props.graph.nodes.filter((n) => n.id !== nodeId);
      props.graph.edges = removeEdgesForNode(props.graph.edges, nodeId);
      props.graph.execEdges = removeEdgesForNode(props.graph.execEdges, nodeId);

      const meta = props.graph.metadata as any;
      if (meta?.ui?.nodes && typeof meta.ui.nodes === 'object') {
        delete meta.ui.nodes[nodeId];
      }

      emit('dirty');
      emit('select-node', null);
    }
    return context;
  });

  // 1) 加载 nodes
  const positions = getUiNodePositionMap(props.graph);
  for (const n of props.graph.nodes) {
    const def = findNodeDef(n.nodeType);
    if (!def) continue;
    const reteNode = buildReteNode(def, n);
    await editor.addNode(reteNode);

    const pos = positions[n.id];
    if (pos) {
      await area.translate(reteNode.id, pos);
    }
  }

  // 2) 加载 connections（value + exec）
  for (const e of props.graph.edges) {
    await addConnection(e, 'value');
  }
  for (const e of props.graph.execEdges) {
    await addConnection(e, 'exec');
  }

  // 3) 缩放到合适视野
  await AreaExtensions.zoomAt(area, editor.getNodes());
}

async function addConnection(edge: GraphEdge, kind: 'value' | 'exec') {
  if (!editor) return;
  const sourceNode = editor.getNode(edge.from.nodeId);
  const targetNode = editor.getNode(edge.to.nodeId);
  if (!sourceNode || !targetNode) return;

  const sourceKey = portKey(kind === 'exec' ? 'exec_out' : 'out', edge.from.port);
  const targetKey = portKey(kind === 'exec' ? 'exec_in' : 'in', edge.to.port);

  const conn = new ClassicPreset.Connection(sourceNode, sourceKey as any, targetNode, targetKey as any);
  await editor.addConnection(conn as any);
}

async function removeConnection(edge: GraphEdge, kind: 'value' | 'exec') {
  if (!editor) return;

  const sourceKey = portKey(kind === 'exec' ? 'exec_out' : 'out', edge.from.port);
  const targetKey = portKey(kind === 'exec' ? 'exec_in' : 'in', edge.to.port);

  const conn = editor
    .getConnections()
    .find(
      (c) =>
        String(c.source) === edge.from.nodeId &&
        String(c.sourceOutput) === sourceKey &&
        String(c.target) === edge.to.nodeId &&
        String(c.targetInput) === targetKey,
    ) as any;

  if (!conn) return;

  await (editor as any).removeConnection(conn.id);
}

type AddNodeOptions = {
  id?: string;
  params?: Record<string, unknown>;
  position?: { x: number; y: number };
};

async function addNode(nodeType: string, options?: AddNodeOptions): Promise<string | null> {
  const def = findNodeDef(nodeType);
  if (!def || !editor || !area) return null;

  const id = options?.id ?? `n_${crypto.randomUUID().slice(0, 8)}`;
  const graphNode: GraphNode = { id, nodeType, params: options?.params ?? {} };
  props.graph.nodes.push(graphNode);

  const node = buildReteNode(def, graphNode);
  await editor.addNode(node);

  // 放在视野中心附近（简单策略：按当前节点数量做偏移）
  const offset = props.graph.nodes.length * 20;
  const pos = options?.position ?? { x: offset, y: offset };
  await area.translate(node.id, pos);
  setUiNodePosition(props.graph, id, pos);

  emit('dirty');
  await AreaExtensions.zoomAt(area, editor.getNodes());
  return id;
}

async function focusNode(nodeId: string) {
  if (!editor || !area) return;
  const node = editor.getNode(nodeId);
  if (!node) return;
  await AreaExtensions.zoomAt(area, [node], { scale: 1 });
}

async function removeNode(nodeId: string) {
  if (!editor) return;
  const node = editor.getNode(nodeId);
  if (!node) return;
  await editor.removeNode(nodeId);
}

async function connectValueEdge(edge: GraphEdge) {
  await addConnection(edge, 'value');
}

async function connectExecEdge(edge: GraphEdge) {
  await addConnection(edge, 'exec');
}

async function removeExecEdge(edge: GraphEdge) {
  await removeConnection(edge, 'exec');
}

async function refreshNodeTitle(nodeId: string) {
  if (!editor || !area) return;
  const graphNode = props.graph.nodes.find((n) => n.id === nodeId) ?? null;
  if (!graphNode) return;
  const def = findNodeDef(graphNode.nodeType);
  if (!def) return;

  const reteNode = editor.getNode(nodeId) as any;
  if (!reteNode) return;

  reteNode.label = buildNodeLabel(def, graphNode);
  await area.update('node' as any, String(nodeId));
}

defineExpose({
  addNode,
  connectValueEdge,
  connectExecEdge,
  removeExecEdge,
  refreshNodeTitle,
  focusNode,
  removeNode,
  findNodeDef,
});

onMounted(() => {
  void init();
});

onBeforeUnmount(() => {
  area?.destroy();
  editor = null;
  area = null;
});
</script>

<style scoped>
.canvas {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
}
</style>
