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

import type { GraphEdge, GraphJsonV2, GraphNode, NodeCatalog, NodeDef, ValueType } from '@/engine/types';
import AddPinControl from './AddPinControl.vue';
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
  graph: GraphJsonV2;
  templateLocked?: boolean;
}>();

const emit = defineEmits<{
  (e: 'select-node', nodeId: string | null): void;
  (e: 'dirty'): void;
}>();

const container = ref<HTMLElement | null>(null);

let editor: NodeEditor<Schemes> | null = null;
let area: AreaPlugin<Schemes, any> | null = null;
let isProgrammaticUpdate = false;

type SocketMeta = {
  element: HTMLElement;
  nodeId: string;
  side: 'input' | 'output';
  key: string;
  socketName: string;
};
const socketMetaByKey = new Map<string, SocketMeta>();

type NodeVisualGroup =
  | 'flow'
  | 'input'
  | 'output'
  | 'local'
  | 'math'
  | 'compare'
  | 'json'
  | 'text'
  | 'logic'
  | 'default';

function socketMetaKey(nodeId: string, side: 'input' | 'output', key: string): string {
  return `${nodeId}::${side}::${key}`;
}

function clearDragHint() {
  for (const it of socketMetaByKey.values()) {
    it.element.classList.remove('ce-socket-compatible', 'ce-socket-incompatible', 'ce-socket-source');
  }
}

function isCompatibleValueType(sourceType: string, targetType: string): boolean {
  // exec 与 value 互斥；value 允许子类型赋值（Ratio ⊂ Decimal）
  if (sourceType === 'exec') return targetType === 'exec';
  if (targetType === 'exec') return false;
  return sourceType === targetType || (sourceType === 'Ratio' && targetType === 'Decimal');
}

function applyDragHint(params: { initial: SocketMeta }) {
  const { initial } = params;
  const targetSide: SocketMeta['side'] = initial.side === 'output' ? 'input' : 'output';

  for (const it of socketMetaByKey.values()) {
    // 标记源端口
    if (it.nodeId === initial.nodeId && it.side === initial.side && it.key === initial.key) {
      it.element.classList.add('ce-socket-source');
      continue;
    }

    if (it.side !== targetSide) {
      it.element.classList.add('ce-socket-incompatible');
      continue;
    }

    const ok =
      initial.side === 'output'
        ? isCompatibleValueType(initial.socketName, it.socketName)
        : isCompatibleValueType(it.socketName, initial.socketName);

    it.element.classList.add(ok ? 'ce-socket-compatible' : 'ce-socket-incompatible');
  }
}

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

const VALUE_TYPES: ValueType[] = ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'];

function isValueType(value: unknown): value is ValueType {
  return typeof value === 'string' && VALUE_TYPES.includes(value as ValueType);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function readDynamicPorts(value: unknown): Array<{ name: string; label?: string; valueType: ValueType }> {
  if (!Array.isArray(value)) return [];
  const ports: Array<{ name: string; label?: string; valueType: ValueType }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = item['name'];
    const label = item['label'];
    const valueType = item['valueType'];
    if (typeof name !== 'string' || !name.trim()) continue;
    if (!isValueType(valueType)) continue;
    const normalizedName = name.trim();
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    ports.push({
      name: normalizedName,
      label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
      valueType,
    });
  }
  return ports;
}

function resolveNodeDefForGraphNode(def: NodeDef, graphNode: GraphNode): NodeDef {
  const params = (graphNode.params ?? {}) as Record<string, unknown>;

  if (graphNode.nodeType === 'flow.start') {
    const dynamic = readDynamicPorts(params['dynamicOutputs']);
    if (dynamic.length === 0) return def;
    return {
      ...def,
      outputs: [...def.outputs, ...dynamic],
    };
  }

  if (graphNode.nodeType === 'flow.end') {
    const dynamic = readDynamicPorts(params['dynamicInputs']);
    if (dynamic.length === 0) return def;
    return {
      ...def,
      inputs: [...def.inputs, ...dynamic],
    };
  }

  if (graphNode.nodeType === 'flow.call_definition') {
    const dynamicInputs = readDynamicPorts(params['calleeInputPins']);
    const dynamicOutputs = readDynamicPorts(params['calleeOutputPins']);
    if (dynamicInputs.length === 0 && dynamicOutputs.length === 0) return def;

    const inputNames = new Set(def.inputs.map((p) => p.name));
    const outputNames = new Set(def.outputs.map((p) => p.name));
    return {
      ...def,
      inputs: [...def.inputs, ...dynamicInputs.filter((p) => !inputNames.has(p.name))],
      outputs: [...def.outputs, ...dynamicOutputs.filter((p) => !outputNames.has(p.name))],
    };
  }

  return def;
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

function classifyNodeGroup(nodeType: string): NodeVisualGroup {
  if (nodeType.startsWith('flow.')) return 'flow';
  if (nodeType.startsWith('inputs.')) return 'input';
  if (nodeType.startsWith('outputs.')) return 'output';
  if (nodeType.startsWith('locals.')) return 'local';
  if (nodeType.startsWith('math.')) return 'math';
  if (nodeType.startsWith('compare.')) return 'compare';
  if (nodeType.startsWith('json.')) return 'json';
  if (nodeType.startsWith('string.') || nodeType.startsWith('text.')) return 'text';
  if (nodeType.startsWith('boolean.') || nodeType.startsWith('logic.')) return 'logic';
  return 'default';
}

function getNodeAccent(group: NodeVisualGroup) {
  switch (group) {
    case 'flow':
      return 'var(--el-color-danger)';
    case 'input':
    case 'output':
      return 'var(--el-color-primary)';
    case 'local':
      return 'var(--el-color-warning)';
    case 'math':
      return 'var(--el-color-success)';
    case 'compare':
    case 'logic':
      return 'var(--el-color-info)';
    case 'json':
    case 'text':
      return 'var(--el-color-primary-light-3)';
    default:
      return 'var(--el-text-color-secondary)';
  }
}

function getSocketAccent(socketName: string) {
  switch (socketName) {
    case 'exec':
      return 'var(--el-text-color-primary)';
    case 'Decimal':
    case 'Ratio':
      return 'var(--el-color-success)';
    case 'String':
      return 'var(--el-color-warning)';
    case 'Boolean':
      return 'var(--el-color-danger)';
    case 'DateTime':
      return 'var(--el-color-primary)';
    case 'Json':
      return 'var(--el-color-info)';
    default:
      return 'var(--el-text-color-secondary)';
  }
}

function applyNodePresentation(element: HTMLElement, graphNode: GraphNode) {
  const group = classifyNodeGroup(graphNode.nodeType);
  const accent = getNodeAccent(group);
  element.dataset.nodeGroup = group;
  element.dataset.nodeType = graphNode.nodeType;
  element.style.setProperty('--ce-node-accent', accent);
}

function applySocketPresentation(element: HTMLElement, socketName: string, side: SocketMeta['side']) {
  element.dataset.socketType = socketName;
  element.dataset.socketSide = side;
  element.style.setProperty('--ce-socket-accent', getSocketAccent(socketName));
}

function applyConnectionPresentation(element: HTMLElement, conn: Connection) {
  const kind = isExecKey(String(conn.sourceOutput)) || isExecKey(String(conn.targetInput)) ? 'exec' : 'value';
  element.dataset.connectionKind = kind;
  element.style.setProperty(
    '--ce-connection-stroke',
    kind === 'exec' ? 'var(--el-text-color-primary)' : 'var(--el-color-info)',
  );
}

function buildReteNode(def: NodeDef, graphNode: GraphNode) {
  const resolvedDef = resolveNodeDefForGraphNode(def, graphNode);
  const node = new ClassicPreset.Node(buildNodeLabel(def, graphNode));
  node.id = graphNode.id;

  // value inputs/outputs
  for (const input of resolvedDef.inputs) {
    node.addInput(
      portKey('in', input.name) as any,
      new ClassicPreset.Input(sockets[input.valueType], input.label ?? input.name, false),
    );
  }
  for (const output of resolvedDef.outputs) {
    node.addOutput(
      portKey('out', output.name) as any,
      new ClassicPreset.Output(sockets[output.valueType], output.label ?? output.name, true),
    );
  }

  // exec inputs/outputs（控制流）
  for (const input of resolvedDef.execInputs ?? []) {
    node.addInput(
      portKey('exec_in', input.name) as any,
      new ClassicPreset.Input(sockets.exec, input.name, false),
    );
  }
  for (const output of resolvedDef.execOutputs ?? []) {
    // exec 输出端口最多 1 条出边（图层约束），因此 output.multipleConnections=false
    node.addOutput(
      portKey('exec_out', output.name) as any,
      new ClassicPreset.Output(sockets.exec, output.name, false),
    );
  }

  if (!props.templateLocked && (graphNode.nodeType === 'flow.start' || graphNode.nodeType === 'flow.end')) {
    node.addControl(
      'add_pin' as any,
      {
        __kind: 'add_pin',
        label: '+ Add Pin',
        onClick: () => {
          void addPinForNode(graphNode.id);
        },
      } as any,
    );
  }

  return node;
}

function uniqueName(existing: string[], prefix = 'pin'): string {
  let i = 1;
  while (true) {
    const name = `${prefix}${i}`;
    if (!existing.includes(name)) return name;
    i++;
  }
}

async function addPinForNode(nodeId: string) {
  const node = props.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  if (node.nodeType !== 'flow.start' && node.nodeType !== 'flow.end') return;

  const key = node.nodeType === 'flow.start' ? 'dynamicOutputs' : 'dynamicInputs';
  const params = isPlainObject(node.params) ? node.params : {};
  const listRaw = params[key];
  const list: any[] = Array.isArray(listRaw) ? [...listRaw] : [];

  const existingNames = list
    .map((it) => (isPlainObject(it) && typeof it.name === 'string' ? it.name.trim() : null))
    .filter((v): v is string => Boolean(v));

  list.push({
    name: uniqueName(existingNames),
    valueType: 'Decimal',
    required: true,
  });

  node.params = { ...params, [key]: list };
  emit('dirty');
  await rebuildNode(nodeId);
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
  render.addPreset(
    VuePresets.classic.setup({
      customize: {
        control(context) {
          const payload = context.payload as any;
          if (payload && payload.__kind === 'add_pin') {
            return AddPinControl as any;
          }
          if (context.payload instanceof (ClassicPreset as any).InputControl) {
            return (VuePresets as any).classic.Control;
          }
          return undefined;
        },
      },
    }),
  );
  history.addPreset(HistoryPresets.classic.setup());
  HistoryExtensions.keyboard(history);

  editor.use(area);
  area.use(connection);
  area.use(render);
  area.use(history);

  // 记录 socket 元信息（用于拖线时的类型兼容提示）
  area.addPipe((context) => {
    if (context.type === 'render' || context.type === 'rendered') {
      const d = context.data as any;
      if (d?.type === 'node') {
        const graphNode = props.graph.nodes.find((n) => n.id === String(d.payload?.id));
        if (graphNode) {
          applyNodePresentation(d.element as HTMLElement, graphNode);
        }
      }
      if (d?.type === 'connection') {
        applyConnectionPresentation(d.element as HTMLElement, d.payload as Connection);
      }
      if (d?.type === 'socket') {
        const meta: SocketMeta = {
          element: d.element as HTMLElement,
          nodeId: String(d.nodeId),
          side: d.side as SocketMeta['side'],
          key: String(d.key),
          socketName: String(d.payload?.name ?? ''),
        };
        socketMetaByKey.set(socketMetaKey(meta.nodeId, meta.side, meta.key), meta);
        applySocketPresentation(meta.element, meta.socketName, meta.side);
      }
    }
    return context;
  });

  // 拖线开始/结束：高亮可连接端口、灰化不兼容端口
  (connection as any).addPipe((context: any) => {
    if (context.type === 'connectionpick') {
      clearDragHint();
      const s = context.data?.socket;
      if (s && s.nodeId && s.side && s.key) {
        const key = socketMetaKey(String(s.nodeId), s.side, String(s.key));
        const initial =
          socketMetaByKey.get(key) ??
          ({
            element: s.element as HTMLElement,
            nodeId: String(s.nodeId),
            side: s.side as SocketMeta['side'],
            key: String(s.key),
            socketName: '',
          } as SocketMeta);
        applyDragHint({ initial });
      }
    }
    if (context.type === 'connectiondrop') {
      clearDragHint();
    }
    return context;
  });

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
    if (!isProgrammaticUpdate && context.type === 'nodepicked') {
      emit('select-node', String(context.data.id));
    }
    if (!isProgrammaticUpdate && context.type === 'nodetranslated') {
      setUiNodePosition(props.graph, String(context.data.id), {
        x: context.data.position.x,
        y: context.data.position.y,
      });
      emit('dirty');
    }
    return context;
  });

  editor.addPipe((context) => {
    if (!isProgrammaticUpdate && context.type === 'connectioncreated') {
      const mapped = toGraphEdgeFromConnection(context.data);
      if (mapped) upsertGraphEdge(mapped.kind, mapped.edge);
    }
    if (!isProgrammaticUpdate && context.type === 'connectionremoved') {
      const mapped = toGraphEdgeFromConnection(context.data);
      if (mapped) removeGraphEdge(mapped.kind, mapped.edge);
    }
    if (!isProgrammaticUpdate && context.type === 'noderemoved') {
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

async function addConnection(edge: GraphEdge, kind: 'value' | 'exec'): Promise<boolean> {
  if (!editor) return false;
  const sourceNode = editor.getNode(edge.from.nodeId);
  const targetNode = editor.getNode(edge.to.nodeId);
  if (!sourceNode || !targetNode) return false;

  const sourceKey = portKey(kind === 'exec' ? 'exec_out' : 'out', edge.from.port);
  const targetKey = portKey(kind === 'exec' ? 'exec_in' : 'in', edge.to.port);

  const sourcePort = (sourceNode.outputs as any)[String(sourceKey)];
  const targetPort = (targetNode.inputs as any)[String(targetKey)];
  if (!sourcePort || !targetPort) return false;

  const conn = new ClassicPreset.Connection(sourceNode, sourceKey as any, targetNode, targetKey as any);
  await editor.addConnection(conn as any);
  return true;
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

function pruneEdgesForNode(params: {
  nodeId: string;
  valueInputs: Set<string>;
  valueOutputs: Set<string>;
  execInputs: Set<string>;
  execOutputs: Set<string>;
}): { pruned: boolean } {
  const { nodeId, valueInputs, valueOutputs, execInputs, execOutputs } = params;
  let pruned = false;

  // value edges
  for (let i = props.graph.edges.length - 1; i >= 0; i--) {
    const e = props.graph.edges[i]!;
    if (e.from.nodeId === nodeId && !valueOutputs.has(e.from.port)) {
      props.graph.edges.splice(i, 1);
      pruned = true;
      continue;
    }
    if (e.to.nodeId === nodeId && !valueInputs.has(e.to.port)) {
      props.graph.edges.splice(i, 1);
      pruned = true;
      continue;
    }
  }

  // exec edges
  for (let i = props.graph.execEdges.length - 1; i >= 0; i--) {
    const e = props.graph.execEdges[i]!;
    if (e.from.nodeId === nodeId && !execOutputs.has(e.from.port)) {
      props.graph.execEdges.splice(i, 1);
      pruned = true;
      continue;
    }
    if (e.to.nodeId === nodeId && !execInputs.has(e.to.port)) {
      props.graph.execEdges.splice(i, 1);
      pruned = true;
      continue;
    }
  }

  return { pruned };
}

async function rebuildNode(nodeId: string) {
  if (!editor || !area) return;
  const graphNode = props.graph.nodes.find((n) => n.id === nodeId) ?? null;
  if (!graphNode) return;
  const def = findNodeDef(graphNode.nodeType);
  if (!def) return;

  const resolvedDef = resolveNodeDefForGraphNode(def, graphNode);
  const valueInputs = new Set(resolvedDef.inputs.map((p) => p.name));
  const valueOutputs = new Set(resolvedDef.outputs.map((p) => p.name));
  const execInputs = new Set((resolvedDef.execInputs ?? []).map((p) => p.name));
  const execOutputs = new Set((resolvedDef.execOutputs ?? []).map((p) => p.name));

  const { pruned } = pruneEdgesForNode({ nodeId, valueInputs, valueOutputs, execInputs, execOutputs });
  if (pruned) {
    emit('dirty');
  }

  const positions = getUiNodePositionMap(props.graph);
  const pos = positions[nodeId];

  isProgrammaticUpdate = true;
  try {
    // 1) 移除该节点相关的连接（仅 UI 层，不触碰 graph 数据）
    for (const c of editor.getConnections() as any[]) {
      if (String(c.source) === nodeId || String(c.target) === nodeId) {
        await (editor as any).removeConnection(c.id);
      }
    }

    // 2) 删除并重建节点（以刷新 ports）
    const existing = editor.getNode(nodeId);
    if (existing) {
      await editor.removeNode(nodeId);
    }

    const node = buildReteNode(def, graphNode);
    await editor.addNode(node);

    if (pos) {
      await area.translate(node.id, pos);
    }

    // 3) 仅重建与该节点相关的边（有效的才会被 addConnection 成功加入）
    for (let i = props.graph.edges.length - 1; i >= 0; i--) {
      const e = props.graph.edges[i]!;
      if (e.from.nodeId !== nodeId && e.to.nodeId !== nodeId) continue;
      const ok = await addConnection(e, 'value');
      if (!ok) {
        props.graph.edges.splice(i, 1);
        emit('dirty');
      }
    }
    for (let i = props.graph.execEdges.length - 1; i >= 0; i--) {
      const e = props.graph.execEdges[i]!;
      if (e.from.nodeId !== nodeId && e.to.nodeId !== nodeId) continue;
      const ok = await addConnection(e, 'exec');
      if (!ok) {
        props.graph.execEdges.splice(i, 1);
        emit('dirty');
      }
    }
  } finally {
    isProgrammaticUpdate = false;
  }
}

defineExpose({
  addNode,
  connectValueEdge,
  connectExecEdge,
  removeExecEdge,
  refreshNodeTitle,
  rebuildNode,
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
  position: relative;
  overflow: hidden;
  background-color: var(--el-bg-color-page);
  background-image:
    linear-gradient(var(--el-border-color-lighter) 1px, transparent 1px),
    linear-gradient(90deg, var(--el-border-color-lighter) 1px, transparent 1px),
    linear-gradient(var(--el-border-color-dark) 1px, transparent 1px),
    linear-gradient(90deg, var(--el-border-color-dark) 1px, transparent 1px);
  background-size: 20px 20px, 20px 20px, 100px 100px, 100px 100px;
  background-position: -1px -1px;
}

:deep(.node) {
  width: 220px !important;
  padding: 0 !important;
  border-radius: 6px !important;
  border: 1px solid var(--el-border-color-darker) !important;
  background: var(--el-bg-color-overlay) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
  transition: border-color 0.1s, box-shadow 0.1s !important;
}

:deep(.node:hover) {
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15) !important;
}

:deep(.node.selected) {
  border-color: var(--el-color-primary) !important;
  box-shadow:
    0 0 0 1px var(--el-color-primary),
    0 6px 16px rgba(0, 0, 0, 0.15) !important;
}

:deep(.node .title) {
  margin: 0 !important;
  padding: 6px 12px !important;
  background: var(--ce-node-accent, var(--el-color-info)) !important;
  color: #ffffff !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  line-height: 1.2 !important;
  border-bottom: 1px solid var(--el-border-color-darker);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

:deep(.node .input),
:deep(.node .output) {
  display: flex !important;
  align-items: center;
  margin: 0 !important;
  padding: 4px 8px !important;
  min-height: 28px;
  background: transparent !important;
}

:deep(.node .input:hover),
:deep(.node .output:hover) {
  background: var(--el-fill-color-light) !important;
}

:deep(.node .output) {
  justify-content: flex-end;
}

:deep(.node .input-title),
:deep(.node .output-title) {
  margin: 0 !important;
  color: var(--el-text-color-regular) !important;
  font-size: 12px !important;
  font-weight: 500 !important;
  line-height: 1 !important;
}

:deep(.node .input-socket) {
  margin-left: -14px !important;
  margin-right: 8px !important;
}

:deep(.node .output-socket) {
  margin-right: -14px !important;
  margin-left: 8px !important;
}

:deep(.node .control) {
  padding: 4px !important;
}

:deep(.socket) {
  width: 12px !important;
  height: 12px !important;
  margin: 0 !important;
  border: 1px solid var(--el-border-color-darker) !important;
  background: var(--ce-socket-accent, var(--el-color-primary)) !important;
  box-shadow: none !important;
  transition: transform 0.1s !important;
  border-radius: 50% !important;
}

:deep(.socket:hover) {
  transform: scale(1.2);
}

:deep(.socket[data-socket-type='exec']) {
  border-radius: 2px !important;
  transform: rotate(45deg);
}

:deep(.socket[data-socket-type='exec']:hover) {
  transform: rotate(45deg) scale(1.2);
}

:deep(svg[data-testid='connection'] path) {
  stroke: var(--ce-connection-stroke, var(--el-color-info)) !important;
  stroke-width: 3px !important;
  stroke-linecap: round;
  stroke-linejoin: round;
  fill: none !important;
  filter: none !important;
  transition:
    stroke 0.1s,
    stroke-width 0.1s;
}

:deep(svg[data-connection-kind='exec'] path) {
  stroke-width: 4px !important;
}

:deep(svg[data-testid='connection']:hover path) {
  stroke-width: 5px !important;
}

:deep(.socket.ce-socket-incompatible) {
  opacity: 0.3;
}

:deep(.socket.ce-socket-compatible) {
  opacity: 1;
  border-color: var(--el-color-success) !important;
  box-shadow: 0 0 0 2px var(--el-color-success-light-5) !important;
}

:deep(.socket.ce-socket-source) {
  opacity: 1;
  border-color: var(--el-color-primary) !important;
  box-shadow: 0 0 0 2px var(--el-color-primary-light-5) !important;
}
</style>
