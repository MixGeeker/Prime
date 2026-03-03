<template>
  <div class="root">
    <el-divider content-position="left">Json 浏览（基于 Preview inputs）</el-divider>

    <el-alert
      v-if="previewInputsParsed.ok === false"
      type="warning"
      show-icon
      title="Preview inputs 不是合法 JSON object"
      :description="previewInputsParsed.error"
      style="margin-bottom: 10px"
    />

    <el-alert
      v-else-if="resolved.ok === false"
      type="info"
      show-icon
      title="当前节点的 Json 输出无法推断"
      :description="resolved.error"
      style="margin-bottom: 10px"
    />

    <div v-else class="box">
      <div class="row" style="margin-bottom: 8px">
        <el-tag type="info" effect="plain">输出预览</el-tag>
        <span class="muted mono">{{ resolved.trace }}</span>
      </div>

      <pre class="mono preview">{{ previewText }}</pre>

      <div class="row" style="margin-top: 10px">
        <el-tag type="info" effect="plain">下一步</el-tag>
        <span class="muted">点 key 自动生成一个 `json.select` 并连线</span>
      </div>

      <div v-if="keys.length > 0" class="keys">
        <el-input v-model="q" placeholder="搜索 key..." clearable size="small" />
        <el-scrollbar height="220px" class="keys-scroll">
          <div class="keys-grid">
            <el-button
              v-for="k in filteredKeys"
              :key="k"
              size="small"
              class="key-btn"
              @click="emitCreateSelect(k)"
            >
              <span class="mono">{{ k }}</span>
            </el-button>
          </div>
        </el-scrollbar>
      </div>

      <div v-else class="muted" style="margin-top: 8px">
        当前输出不是 object/array（或为空），没有可解析的下一层 key。
      </div>

      <div class="row" style="margin-top: 12px">
        <el-tag type="info" effect="plain">直达</el-tag>
        <el-input v-model="path" placeholder="a.b.c（相对当前输出）" size="small" />
        <el-button size="small" :disabled="!path.trim()" @click="emitCreatePath">创建</el-button>
      </div>

      <div class="row" style="margin-top: 12px">
        <el-tag type="info" effect="plain">转类型</el-tag>
        <div class="convert">
          <el-button size="small" @click="emitCreateConvert('decimal')">Decimal</el-button>
          <el-button size="small" @click="emitCreateConvert('ratio')">Ratio</el-button>
          <el-button size="small" @click="emitCreateConvert('string')">String</el-button>
          <el-button size="small" @click="emitCreateConvert('boolean')">Boolean</el-button>
          <el-button size="small" @click="emitCreateConvert('datetime')">DateTime</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GraphEdge, GraphJsonV1, GraphNode } from '@/engine/types';

const props = defineProps<{
  graph: GraphJsonV1;
  node: GraphNode;
  previewInputsText: string;
}>();

const emit = defineEmits<{
  (e: 'create-select', payload: { fromNodeId: string; key: string }): void;
  (e: 'create-path', payload: { fromNodeId: string; path: string }): void;
  (e: 'create-convert', payload: { fromNodeId: string; to: 'decimal' | 'ratio' | 'string' | 'boolean' | 'datetime' }): void;
}>();

const q = ref('');
const path = ref('');

type Parsed =
  | { ok: true; value: Record<string, any> }
  | { ok: false; error: string };

const previewInputsParsed = computed<Parsed>(() => {
  try {
    const value = JSON.parse(props.previewInputsText);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: 'inputs 必须是 object（例如 { "globals": {}, "params": {} }）' };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: `inputs JSON 解析失败：${String(e)}` };
  }
});

function splitPath(rawPath: string): string[] {
  const trimmed = rawPath.trim();
  if (!trimmed) return [];

  const normalized = trimmed.startsWith('value.')
    ? trimmed.slice('value.'.length)
    : trimmed.startsWith('value')
      ? trimmed.slice('value'.length)
      : trimmed;

  return normalized
    .split('.')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function selectFromJson(value: unknown, segments: string[]): unknown {
  let current: unknown = value;

  for (const seg of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        return undefined;
      }
      current = current[idx];
      continue;
    }

    if (typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(obj, seg)) {
        return undefined;
      }
      current = obj[seg];
      continue;
    }

    return undefined;
  }

  return current;
}

type Resolved =
  | { ok: true; value: unknown; trace: string }
  | { ok: false; error: string };

function findIncomingValueEdge(nodeId: string, port: string): GraphEdge | null {
  return props.graph.edges.find((e) => e.to.nodeId === nodeId && e.to.port === port) ?? null;
}

function getStringParam(node: GraphNode, key: string): string | null {
  const v = node.params?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function resolveJsonOutput(nodeId: string, visited: Set<string>): Resolved {
  if (visited.has(nodeId)) {
    return { ok: false, error: `检测到循环引用（仅用于编辑器推断）：${nodeId}` };
  }
  visited.add(nodeId);

  const node = props.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, error: `node 不存在：${nodeId}` };

  if (node.nodeType === 'inputs.params.json') {
    if (previewInputsParsed.value.ok === false) return { ok: false, error: previewInputsParsed.value.error };
    const name = getStringParam(node, 'name');
    if (!name) return { ok: false, error: 'inputs.params.json 需要 params.name' };
    const params = previewInputsParsed.value.value['params'];
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      return { ok: false, error: 'preview inputs.params 必须是 object' };
    }
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      return { ok: false, error: `preview inputs.params 缺少字段：${name}` };
    }
    return { ok: true, value: (params as any)[name], trace: `inputs.params.${name}` };
  }

  if (node.nodeType === 'inputs.globals.json') {
    if (previewInputsParsed.value.ok === false) return { ok: false, error: previewInputsParsed.value.error };
    const name = getStringParam(node, 'name');
    if (!name) return { ok: false, error: 'inputs.globals.json 需要 params.name' };
    const globals = previewInputsParsed.value.value['globals'];
    if (globals === null || typeof globals !== 'object' || Array.isArray(globals)) {
      return { ok: false, error: 'preview inputs.globals 必须是 object' };
    }
    if (!Object.prototype.hasOwnProperty.call(globals, name)) {
      return { ok: false, error: `preview inputs.globals 缺少字段：${name}` };
    }
    return { ok: true, value: (globals as any)[name], trace: `inputs.globals.${name}` };
  }

  if (node.nodeType === 'core.const.json') {
    const v = node.params?.['value'];
    return { ok: true, value: v, trace: 'core.const.json.value' };
  }

  if (node.nodeType === 'json.select') {
    const incoming = findIncomingValueEdge(nodeId, 'value');
    if (!incoming) return { ok: false, error: 'json.select 缺少 value 入边（需要先连线）' };
    if (incoming.from.port !== 'value') {
      return { ok: false, error: `暂不支持从非 value 端口推断：${incoming.from.nodeId}.${incoming.from.port}` };
    }

    const parent = resolveJsonOutput(incoming.from.nodeId, visited);
    if (!parent.ok) return parent;

    const mode = getStringParam(node, 'mode') ?? 'browse';
    if (mode === 'path') {
      const rawPath = getStringParam(node, 'path');
      if (!rawPath) return { ok: false, error: 'json.select(mode=path) 需要 params.path' };
      const segments = splitPath(rawPath);
      const selected = selectFromJson(parent.value, segments);
      if (selected === undefined) return { ok: false, error: `path 不存在：${rawPath}` };
      return { ok: true, value: selected, trace: `${parent.trace} -> ${rawPath}` };
    }

    if (mode === 'browse') {
      const key = getStringParam(node, 'key');
      if (!key) return { ok: false, error: 'json.select(mode=browse) 需要 params.key' };
      const selected = selectFromJson(parent.value, [key]);
      if (selected === undefined) return { ok: false, error: `key 不存在：${key}` };
      return { ok: true, value: selected, trace: `${parent.trace} -> ${key}` };
    }

    return { ok: false, error: `未知 mode：${mode}` };
  }

  return {
    ok: false,
    error: `该节点类型暂不支持 Json 浏览：${node.nodeType}（仅支持 inputs.*.json / core.const.json / json.select）`,
  };
}

const resolved = computed<Resolved>(() => resolveJsonOutput(props.node.id, new Set<string>()));

const keys = computed<string[]>(() => {
  if (!resolved.value.ok) return [];
  const v = resolved.value.value;
  if (Array.isArray(v)) {
    const max = Math.min(v.length, 200);
    return Array.from({ length: max }, (_, i) => String(i));
  }
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>).slice(0, 500);
  }
  return [];
});

const filteredKeys = computed(() => {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return keys.value;
  return keys.value.filter((k) => k.toLowerCase().includes(qq));
});

const previewText = computed(() => {
  if (!resolved.value.ok) return '';
  const v = resolved.value.value;
  try {
    const s = JSON.stringify(v, null, 2);
    if (s.length > 6000) return `${s.slice(0, 6000)}\n...（已截断）`;
    return s;
  } catch {
    return String(v);
  }
});

function emitCreateSelect(k: string) {
  emit('create-select', { fromNodeId: props.node.id, key: k });
}

function emitCreatePath() {
  emit('create-path', { fromNodeId: props.node.id, path: path.value.trim() });
  path.value = '';
}

function emitCreateConvert(to: 'decimal' | 'ratio' | 'string' | 'boolean' | 'datetime') {
  emit('create-convert', { fromNodeId: props.node.id, to });
}
</script>

<style scoped>
.root {
  margin-top: 12px;
}
.box {
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-lighter);
  border-radius: 10px;
  padding: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  opacity: 0.8;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
.preview {
  margin: 0;
  padding: 10px;
  border-radius: 8px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  max-height: 220px;
  overflow: auto;
}
.keys {
  margin-top: 8px;
}
.keys-scroll {
  margin-top: 8px;
  border-radius: 8px;
}
.keys-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.key-btn {
  justify-content: flex-start;
  width: 100%;
}
.convert {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
</style>

