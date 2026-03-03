<template>
  <div class="root">
    <div class="hdr">
      <div class="title">变量（Inputs）</div>
      <el-select v-model="epKey" size="small" style="width: 160px">
        <el-option v-for="k in entrypointKeys" :key="k" :label="k" :value="k" />
      </el-select>
    </div>

    <el-input v-model="q" placeholder="搜索 name/description..." clearable size="small" />

    <el-divider content-position="left">globals</el-divider>
    <div v-if="globalsFiltered.length === 0" class="muted">暂无 globals 声明</div>
    <div v-else class="list">
      <el-button
        v-for="g in globalsFiltered"
        :key="`g:${g.name}`"
        size="small"
        class="item"
        @click="emitPick('globals', g)"
      >
        <span class="mono">{{ g.name }}</span>
        <el-tag size="small" effect="plain">{{ g.valueType }}</el-tag>
      </el-button>
    </div>

    <el-divider content-position="left">params ({{ epKey }})</el-divider>
    <div v-if="paramsFiltered.length === 0" class="muted">暂无 params 声明</div>
    <div v-else class="list">
      <el-button
        v-for="p in paramsFiltered"
        :key="`p:${p.name}`"
        size="small"
        class="item"
        @click="emitPick('params', p)"
      >
        <span class="mono">{{ p.name }}</span>
        <el-tag size="small" effect="plain">{{ p.valueType }}</el-tag>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GraphInputDef, GraphJsonV1 } from '@/engine/types';

const props = defineProps<{
  graph: GraphJsonV1;
  entrypointKey: string;
}>();

const emit = defineEmits<{
  (e: 'update:entrypointKey', value: string): void;
  (e: 'pick', payload: { scope: 'globals' | 'params'; input: GraphInputDef }): void;
}>();

const q = ref('');

const entrypointKeys = computed(() => props.graph.entrypoints.map((e) => e.key));

const epKey = computed({
  get() {
    return props.entrypointKey;
  },
  set(v: string) {
    emit('update:entrypointKey', v);
  },
});

const activeEntrypoint = computed(() => props.graph.entrypoints.find((e) => e.key === epKey.value) ?? null);

function matchesQuery(it: GraphInputDef): boolean {
  const qq = q.value.trim().toLowerCase();
  if (!qq) return true;
  return (
    it.name.toLowerCase().includes(qq) ||
    String(it.description ?? '').toLowerCase().includes(qq)
  );
}

const globalsFiltered = computed(() => props.graph.globals.filter(matchesQuery));
const paramsFiltered = computed(() => (activeEntrypoint.value?.params ?? []).filter(matchesQuery));

function emitPick(scope: 'globals' | 'params', input: GraphInputDef) {
  emit('pick', { scope, input });
}
</script>

<style scoped>
.root {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.title {
  font-weight: 600;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.item {
  justify-content: space-between;
  width: 100%;
  padding: 8px 10px;
  height: auto;
}
.muted {
  opacity: 0.75;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
</style>

