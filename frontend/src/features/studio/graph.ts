import type { GraphEdge, GraphJsonV1 } from '@/engine/types';

export function createEmptyGraph(): GraphJsonV1 {
  return {
    globals: [],
    entrypoints: [
      {
        key: 'main',
        params: [],
        from: { nodeId: 'n_start', port: 'out' },
      },
    ],
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start' },
      { id: 'n_return', nodeType: 'flow.return' },
    ],
    edges: [],
    execEdges: [
      { from: { nodeId: 'n_start', port: 'out' }, to: { nodeId: 'n_return', port: 'in' } },
    ],
    outputs: [],
    metadata: {
      ui: {
        nodes: {
          n_start: { x: 0, y: 0 },
          n_return: { x: 320, y: 0 },
        },
      },
    },
  };
}

export function getUiNodePositionMap(graph: GraphJsonV1): Record<string, { x: number; y: number }> {
  const meta = graph.metadata as any;
  if (!meta || typeof meta !== 'object') return {};
  const ui = meta.ui;
  if (!ui || typeof ui !== 'object') return {};
  const nodes = ui.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  return nodes as Record<string, { x: number; y: number }>;
}

export function setUiNodePosition(graph: GraphJsonV1, nodeId: string, pos: { x: number; y: number }) {
  if (!graph.metadata || typeof graph.metadata !== 'object') {
    graph.metadata = { ui: { nodes: {} } };
  }

  const meta = graph.metadata as any;
  if (!meta.ui || typeof meta.ui !== 'object') meta.ui = {};
  if (!meta.ui.nodes || typeof meta.ui.nodes !== 'object') meta.ui.nodes = {};

  meta.ui.nodes[nodeId] = { x: pos.x, y: pos.y };
}

export function removeEdgesForNode(edges: GraphEdge[], nodeId: string): GraphEdge[] {
  return edges.filter((e) => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
}

export function wouldCreateValueCycle(existing: GraphEdge[], next: GraphEdge): boolean {
  // 简单 DFS：从 next.to.nodeId 出发，若能回到 next.from.nodeId，则形成环
  const from = next.from.nodeId;
  const to = next.to.nodeId;

  const adjacency = new Map<string, string[]>();
  for (const e of [...existing, next]) {
    const arr = adjacency.get(e.from.nodeId) ?? [];
    arr.push(e.to.nodeId);
    adjacency.set(e.from.nodeId, arr);
  }

  const visited = new Set<string>();
  const stack: string[] = [to];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const n of adjacency.get(current) ?? []) {
      if (!visited.has(n)) stack.push(n);
    }
  }
  return false;
}

function safeIdPart(raw: string): string {
  return raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .slice(0, 32);
}

function valueTypeToOutputsSetSuffix(vt: unknown): string | null {
  switch (vt) {
    case 'Decimal':
      return 'decimal';
    case 'Ratio':
      return 'ratio';
    case 'String':
      return 'string';
    case 'Boolean':
      return 'boolean';
    case 'DateTime':
      return 'datetime';
    case 'Json':
      return 'json';
    default:
      return null;
  }
}

/**
 * 兼容迁移：旧版 outputs 结构可能包含 `from` 绑定（纯映射输出）。
 * 当前版本改为：outputs 仅声明；实际输出由 `outputs.set.*` 节点写入。
 *
 * 迁移策略（尽量不破坏用户意图）：
 * - outputs: { key, valueType, from, rounding } → { key, valueType, rounding }
 * - 自动创建 outputs.set.<type> 节点，并把旧 from 连到该节点的 value 输入
 * - 自动把 outputs.set 节点插入到 flow.return 前（串联到控制流）
 */
export function migrateGraphIfNeeded(graph: GraphJsonV1): { changed: boolean; notes: string[] } {
  const notes: string[] = [];

  const anyGraph = graph as any;
  const nodes: any[] = Array.isArray(anyGraph.nodes) ? anyGraph.nodes : [];
  const edges: any[] = Array.isArray(anyGraph.edges) ? anyGraph.edges : [];
  const execEdges: any[] = Array.isArray(anyGraph.execEdges) ? anyGraph.execEdges : [];

  let changed = false;

  // 1) entrypoints：to(exec输入) -> from(exec输出)（必要时插入 flow.start）
  const entrypoints: any[] = Array.isArray(anyGraph.entrypoints) ? anyGraph.entrypoints : [];
  const needsEntrypointsMigration = entrypoints.some(
    (e) => e && typeof e === 'object' && !e.from && e.to && typeof e.to === 'object',
  );
  if (needsEntrypointsMigration) {
    changed = true;
    notes.push('已自动迁移 entrypoints：to(exec输入) → from(exec输出)+flow.start（请保存草稿）');

    const posMap = getUiNodePositionMap(anyGraph as GraphJsonV1);
    let insertedStarts = nodes.filter((n) => n?.nodeType === 'flow.start').length;

    for (const ep of entrypoints) {
      if (!ep || typeof ep !== 'object') continue;
      if (ep.from) continue;
      const to = ep.to;
      if (!to || typeof to !== 'object') continue;
      if (typeof to.nodeId !== 'string' || typeof to.port !== 'string') continue;

      const targetNode = nodes.find((n) => n?.id === to.nodeId) ?? null;
      if (targetNode?.nodeType === 'flow.start' && to.port === 'in') {
        ep.from = { nodeId: to.nodeId, port: 'out' };
        delete ep.to;
        continue;
      }

      const epKey = typeof ep.key === 'string' ? ep.key : 'main';
      const baseId = `n_start_${safeIdPart(epKey) || 'main'}`;
      let id = baseId;
      let i = 2;
      while (nodes.some((n) => n?.id === id)) {
        id = `${baseId}_${i}`;
        i++;
      }

      nodes.push({ id, nodeType: 'flow.start' });

      const targetPos = posMap[to.nodeId] ?? { x: 320, y: insertedStarts * 90 };
      setUiNodePosition(anyGraph as GraphJsonV1, id, {
        x: targetPos.x - 280,
        y: targetPos.y + insertedStarts * 12,
      });
      insertedStarts++;

      execEdges.push({ from: { nodeId: id, port: 'out' }, to: { nodeId: to.nodeId, port: to.port } });

      ep.from = { nodeId: id, port: 'out' };
      delete ep.to;
    }
  }

  // 2) outputs：旧版 outputs.from 绑定 -> outputs.set.* 节点
  const outputs: any[] = Array.isArray(anyGraph.outputs) ? anyGraph.outputs : [];
  const needsOutputsMigration = outputs.some((o) => o && typeof o === 'object' && o.from && typeof o.from === 'object');
  if (!needsOutputsMigration) {
    return { changed, notes };
  }

  changed = true;
  notes.push('已自动迁移 outputs：from 绑定 → outputs.set.* 节点（请保存草稿）');

  const returnNode = nodes.find((n) => n?.nodeType === 'flow.return') ?? nodes.find((n) => n?.id === 'n_return') ?? null;
  const startNode = nodes.find((n) => n?.nodeType === 'flow.start') ?? nodes.find((n) => n?.id === 'n_start') ?? null;

  const posMap = getUiNodePositionMap(anyGraph as GraphJsonV1);
  const returnPos = returnNode?.id ? (posMap[returnNode.id] ?? { x: 320, y: 0 }) : { x: 320, y: 0 };

  let insertedCount = nodes.filter((n) => String(n?.nodeType ?? '').startsWith('outputs.set.')).length;

  const migratedOutputs: any[] = [];

  for (const out of outputs) {
    if (!out || typeof out !== 'object') {
      continue;
    }

    const key = typeof out.key === 'string' ? out.key.trim() : '';
    const valueType = out.valueType;
    const rounding = out.rounding;

    if (!key || typeof valueType !== 'string') {
      continue;
    }

    // 新结构：去掉 from，其它字段保留
    const nextOut: any = { key, valueType };
    if (rounding) nextOut.rounding = rounding;
    migratedOutputs.push(nextOut);

    // 若旧结构没有 from，则认为已经是新结构（或用户手写），无需生成 set 节点
    const from = out.from;
    if (!from || typeof from !== 'object') {
      continue;
    }

    const suffix = valueTypeToOutputsSetSuffix(valueType);
    if (!suffix) {
      continue;
    }

    const setNodeType = `outputs.set.${suffix}`;
    const existingSet = nodes.find((n) => n?.nodeType === setNodeType && n?.params?.key === key) ?? null;
    if (existingSet) {
      continue;
    }

    // 创建 set 节点
    const baseId = `n_out_${safeIdPart(key) || suffix}`;
    let id = baseId;
    let i = 2;
    while (nodes.some((n) => n?.id === id)) {
      id = `${baseId}_${i}`;
      i++;
    }

    nodes.push({ id, nodeType: setNodeType, params: { key } });
    setUiNodePosition(anyGraph as GraphJsonV1, id, {
      x: returnPos.x - 260,
      y: returnPos.y + insertedCount * 90,
    });
    insertedCount++;

    // 连接 value：old from → outputs.set.value
    if (typeof from.nodeId === 'string' && typeof from.port === 'string') {
      edges.push({
        from: { nodeId: from.nodeId, port: from.port },
        to: { nodeId: id, port: 'value' },
      });
    }

    // 插入控制流：... -> (set) -> return
    if (returnNode?.id) {
      const incomingIdx = execEdges.findIndex((e) => e?.to?.nodeId === returnNode.id && e?.to?.port === 'in');
      if (incomingIdx >= 0) {
        const incoming = execEdges.splice(incomingIdx, 1)[0];
        execEdges.push({ from: incoming.from, to: { nodeId: id, port: 'in' } });
        execEdges.push({ from: { nodeId: id, port: 'out' }, to: { nodeId: returnNode.id, port: 'in' } });
      } else if (startNode?.id) {
        execEdges.push({ from: { nodeId: startNode.id, port: 'out' }, to: { nodeId: id, port: 'in' } });
        execEdges.push({ from: { nodeId: id, port: 'out' }, to: { nodeId: returnNode.id, port: 'in' } });
      }
    }
  }

  anyGraph.outputs = migratedOutputs;
  anyGraph.nodes = nodes;
  anyGraph.edges = edges;
  anyGraph.execEdges = execEdges;

  return { changed, notes };
}
