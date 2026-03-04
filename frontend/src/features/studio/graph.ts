import type { GraphEdge, GraphJsonV2 } from '@/engine/types';

export function createEmptyGraph(): GraphJsonV2 {
  return {
    schemaVersion: 2,
    locals: [],
    nodes: [
      { id: 'n_start', nodeType: 'flow.start', params: { dynamicOutputs: [] } },
      { id: 'n_end', nodeType: 'flow.end', params: { dynamicInputs: [] } },
    ],
    edges: [],
    execEdges: [
      { from: { nodeId: 'n_start', port: 'out' }, to: { nodeId: 'n_end', port: 'in' } },
    ],
    metadata: {
      ui: {
        nodes: {
          n_start: { x: 0, y: 0 },
          n_end: { x: 320, y: 0 },
        },
      },
    },
  };
}

export function getUiNodePositionMap(graph: GraphJsonV2): Record<string, { x: number; y: number }> {
  const meta = graph.metadata as any;
  if (!meta || typeof meta !== 'object') return {};
  const ui = meta.ui;
  if (!ui || typeof ui !== 'object') return {};
  const nodes = ui.nodes;
  if (!nodes || typeof nodes !== 'object') return {};
  return nodes as Record<string, { x: number; y: number }>;
}

export function setUiNodePosition(graph: GraphJsonV2, nodeId: string, pos: { x: number; y: number }) {
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
