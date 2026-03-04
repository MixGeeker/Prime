<template>
  <div class="studio">
    <!-- 左侧：Definition + 节点面板 -->
    <div class="left">
      <el-card class="card">
        <template #header>
          <div class="hdr">
            <div>Definition</div>
            <el-tag v-if="dirty" type="warning">未保存</el-tag>
          </div>
        </template>

        <el-form label-position="top" :model="{}">
          <el-form-item label="打开（已有）">
            <el-select
              v-model="selectedDefinitionId"
              filterable
              remote
              clearable
              placeholder="搜索 definitionId..."
              :remote-method="searchDefinitions"
              :loading="defsLoading"
              style="width: 100%"
              @change="onSelectDefinition"
            >
              <el-option
                v-for="d in definitionOptions"
                :key="d.definitionId"
                :value="d.definitionId"
                :label="d.definitionId"
              >
                <div class="opt">
                  <div class="opt-title">{{ d.definitionId }}</div>
                  <div class="opt-sub">
                    <span v-if="d.latestDefinitionHash" class="muted">latest: {{ d.latestDefinitionHash.slice(0, 10) }}…</span>
                    <span v-else class="muted">未发布</span>
                    <span v-if="d.draftRevisionId" class="muted"> · 有草稿</span>
                  </div>
                </div>
              </el-option>
            </el-select>
          </el-form-item>

          <el-form-item label="新建（创建草稿）">
            <div class="row">
              <el-input v-model="newDefinitionId" placeholder="例如：price.fix.v1" />
              <el-button type="primary" :loading="draftLoading" @click="createDraft">创建</el-button>
            </div>
          </el-form-item>
        </el-form>

        <div class="actions">
          <el-button :disabled="!canSave" :loading="draftSaving" @click="saveDraft">保存草稿</el-button>
          <el-button :disabled="!hasGraph" :loading="validateLoading" type="success" @click="validate">
            校验
          </el-button>
          <el-button :disabled="!canPublish" :loading="publishLoading" type="primary" @click="publish">
            发布
          </el-button>
        </div>

        <div v-if="currentDraftInfo" class="info">
          <div class="muted">draftRevisionId: {{ currentDraftInfo.draftRevisionId }}</div>
          <div class="muted">updatedAt: {{ currentDraftInfo.updatedAt }}</div>
        </div>
      </el-card>

      <el-card class="card">
        <template #header>
          <div class="hdr">
            <div>节点库（Node Catalog）</div>
            <el-tag v-if="catalog" type="info">{{ catalog.nodes.length }}</el-tag>
          </div>
        </template>

        <div class="row" style="margin-bottom: 10px">
          <el-input v-model="paletteQuery" placeholder="搜索 nodeType / title..." clearable />
          <el-switch v-model="showInternalNodes" active-text="显示内部节点" />
        </div>
        <div class="palette">
          <el-collapse v-model="openCategories">
            <el-collapse-item v-for="c in paletteCategories" :key="c.category" :name="c.category">
              <template #title>
                <span class="cat">{{ c.category }}</span>
                <span class="muted"> · {{ c.nodes.length }}</span>
              </template>
              <div class="node-list">
                <el-button v-for="n in c.nodes" :key="n.nodeType" text class="node-btn" @click="addNode(n.nodeType)">
                  <div class="node-title">{{ n.title }}</div>
                  <div class="node-sub">{{ n.nodeType }}</div>
                </el-button>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </el-card>
    </div>

    <!-- 中间：画布 -->
    <div class="center">
      <el-card class="card canvas-card" :body-style="{ padding: '10px' }">
        <template #header>
          <div class="hdr">
            <div>画布</div>
            <div class="row">
              <el-button :disabled="!selectedNodeId" @click="focusSelected">定位选中</el-button>
              <el-button :disabled="!selectedNodeId" type="danger" @click="removeSelected">删除节点</el-button>
            </div>
          </div>
        </template>

        <div class="canvas-wrap">
          <div v-if="!catalog" class="muted" style="padding: 10px">正在加载 Node Catalog...</div>
          <BlueprintCanvas
            v-else
            :key="canvasKey"
            ref="canvasRef"
            :catalog="catalog"
            :graph="graph"
            @select-node="(id) => (selectedNodeId = id)"
            @dirty="() => (dirty = true)"
          />
        </div>
      </el-card>
    </div>

    <!-- 右侧：检查器 / 校验 / 预览 -->
    <div class="right">
      <el-card class="card" :body-style="{ padding: '12px' }">
        <template #header>检查器</template>

        <el-tabs v-model="rightTab">
          <el-tab-pane label="节点" name="node">
            <div v-if="!selectedNode" class="muted">选择一个节点以编辑 params。</div>
            <div v-else>
              <div class="node-head">
                <div class="node-title">{{ selectedNodeDef?.title ?? selectedNode.nodeType }}</div>
                <div class="node-sub">{{ selectedNode.id }} · {{ selectedNode.nodeType }}</div>
              </div>

              <ParamsForm
                :schema="(selectedNodeDef?.paramsSchema as any) ?? null"
                :model-value="(selectedNode.params as any) ?? {}"
                @update:model-value="onSelectedNodeParamsUpdate"
              />
              <el-alert
                v-if="nodeParamsError"
                type="error"
                :closable="false"
                show-icon
                style="margin-top: 10px"
                :title="nodeParamsError"
              />
            </div>
          </el-tab-pane>

          <el-tab-pane label="图" name="graph">
            <el-tabs v-model="graphTab">
              <el-tab-pane label="locals" name="locals">
                <LocalsEditor :graph="graph" @dirty="() => (dirty = true)" />
              </el-tab-pane>
              <el-tab-pane label="runner" name="runner">
                <el-form label-position="top" :model="{}">
                  <el-form-item label="runnerConfig（参与 definitionHash）">
                    <el-input
                      v-model="runnerConfigText"
                      type="textarea"
                      :autosize="{ minRows: 8, maxRows: 14 }"
                      placeholder="{ }"
                      class="mono"
                    />
                    <div v-if="runnerConfigError" class="err">{{ runnerConfigError }}</div>
                  </el-form-item>

                  <el-form-item label="outputSchema（可选）">
                    <el-input
                      v-model="outputSchemaText"
                      type="textarea"
                      :autosize="{ minRows: 6, maxRows: 12 }"
                      placeholder="{ }"
                      class="mono"
                    />
                    <div v-if="outputSchemaError" class="err">{{ outputSchemaError }}</div>
                  </el-form-item>
                </el-form>
              </el-tab-pane>
            </el-tabs>
          </el-tab-pane>

          <el-tab-pane label="校验" name="validate">
            <div class="row" style="margin-bottom: 10px">
              <el-button type="success" :loading="validateLoading" @click="validate">校验</el-button>
              <el-tag v-if="definitionHash" type="info">hash: {{ definitionHash.slice(0, 10) }}…</el-tag>
            </div>

            <div v-if="issues.length === 0" class="muted">暂无校验结果。</div>
            <el-scrollbar v-else height="420px">
              <el-alert
                v-for="(it, idx) in issues"
                :key="idx"
                :type="it.severity === 'error' ? 'error' : 'warning'"
                :title="`${it.code}`"
                :description="formatIssue(it)"
                show-icon
                style="margin-bottom: 10px"
                @click="focusIssue(it)"
              />
            </el-scrollbar>
          </el-tab-pane>

          <el-tab-pane label="预览" name="preview">
            <el-form label-position="top" :model="{}">
              <el-form-item label="inputs（JSON）">
                <el-input
                  v-model="previewInputsText"
                  type="textarea"
                  :autosize="{ minRows: 8, maxRows: 14 }"
                  placeholder='{ }'
                  class="mono"
                />
                <div v-if="previewInputsError" class="err">{{ previewInputsError }}</div>
              </el-form-item>

              <el-form-item label="options（JSON，可选）">
                <el-input
                  v-model="previewOptionsText"
                  type="textarea"
                  :autosize="{ minRows: 4, maxRows: 10 }"
                  placeholder="{ }"
                  class="mono"
                />
                <div v-if="previewOptionsError" class="err">{{ previewOptionsError }}</div>
              </el-form-item>

              <div class="row">
                <el-button type="primary" :loading="dryRunLoading" @click="dryRun">dry-run</el-button>
                <el-button @click="loadPreviewTemplate">填充模板</el-button>
              </div>

              <div v-if="dryRunResult" class="result">
                <pre class="mono">{{ JSON.stringify(dryRunResult, null, 2) }}</pre>
              </div>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { backendApi, normalizeHttpError } from '@/api/backend';
import type {
  DefinitionDraft,
  DefinitionSummary,
  NodeCatalog,
  GraphJsonV2,
  ValidationIssue,
} from '@/engine/types';
import { createEmptyGraph } from '@/features/studio/graph';
import BlueprintCanvas from '@/features/studio/BlueprintCanvas.vue';
import LocalsEditor from '@/features/studio/LocalsEditor.vue';
import ParamsForm from '@/features/studio/ParamsForm.vue';

const catalog = ref<NodeCatalog | null>(null);
const catalogLoading = ref(false);
const route = useRoute();

const definitionOptions = ref<DefinitionSummary[]>([]);
const defsLoading = ref(false);
const selectedDefinitionId = ref<string | null>(null);
const newDefinitionId = ref('');

const currentDraftInfo = ref<{ draftRevisionId: string; updatedAt: string } | null>(null);
const draftLoading = ref(false);
const draftSaving = ref(false);
const publishLoading = ref(false);

const canvasRef = ref<InstanceType<typeof BlueprintCanvas> | null>(null);
const canvasKey = ref(0);

const graph = ref<GraphJsonV2>(createEmptyGraph());
const dirty = ref(false);

const selectedNodeId = ref<string | null>(null);
const rightTab = ref<'node' | 'graph' | 'validate' | 'preview'>('node');
const graphTab = ref<'locals' | 'runner'>('locals');

const paletteQuery = ref('');
const openCategories = ref<string[]>([]);
const showInternalNodes = ref(false);

const runnerConfigText = ref('{}');
const runnerConfigError = ref<string | null>(null);
const outputSchemaText = ref('{}');
const outputSchemaError = ref<string | null>(null);

const issues = ref<ValidationIssue[]>([]);
const validateLoading = ref(false);
const definitionHash = ref<string | null>(null);

const previewInputsText = ref(JSON.stringify({}, null, 2));
const previewOptionsText = ref('{}');
const previewInputsError = ref<string | null>(null);
const previewOptionsError = ref<string | null>(null);
const dryRunLoading = ref(false);
const dryRunResult = ref<any | null>(null);
const nodeParamsError = ref<string | null>(null);

const callDefSyncing = new Set<string>();
const callDefSyncedKeyByNodeId = new Map<string, string>();
const callDefSyncTimers = new Map<string, number>();


const hasGraph = computed(() => Boolean(graph.value));
const canSave = computed(() => Boolean(selectedDefinitionId.value && currentDraftInfo.value?.draftRevisionId));
const canPublish = computed(() => canSave.value);

const selectedNode = computed(() => {
  const id = selectedNodeId.value;
  if (!id) return null;
  return graph.value.nodes.find((n) => n.id === id) ?? null;
});

const selectedNodeDef = computed(() => {
  const n = selectedNode.value;
  if (!n || !catalog.value) return null;
  return (catalog.value.nodes as any[]).find((d) => d.nodeType === n.nodeType) ?? null;
});

const paletteCategories = computed(() => {
  const nodes = (catalog.value?.nodes ?? []) as any[];
  const q = paletteQuery.value.trim().toLowerCase();
  const visibleNodes = nodes.filter((n) => {
    const t = String(n.nodeType);
    if (t === 'flow.return') return false;
    if (t.startsWith('inputs.')) return false;
    if (t.startsWith('outputs.set.')) return false;
    return true;
  });

  const filtered = q
    ? visibleNodes.filter(
        (n) =>
          String(n.nodeType).toLowerCase().includes(q) || String(n.title).toLowerCase().includes(q),
      )
    : visibleNodes;

  const map = new Map<string, any[]>();
  for (const n of filtered) {
    const cat = n.category ?? 'uncategorized';
    map.set(cat, [...(map.get(cat) ?? []), n]);
  }
  const categories = Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, nodes]) => ({
      category,
      nodes: nodes.sort((a, b) => String(a.title).localeCompare(String(b.title))),
    }));
  return categories;
});

watch(
  paletteCategories,
  (categories) => {
    if (openCategories.value.length === 0) {
      openCategories.value = categories.slice(0, 3).map((c) => c.category);
    }
  },
  { immediate: true },
);

function safeParseJson(text: string, field: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: `${field} 必须是 object` };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: `${field} JSON 解析失败：${String(e)}` };
  }
}

function buildCallDefinitionRefKey(params: Record<string, unknown> | undefined): string | null {
  if (!isPlainObject(params)) return null;
  const definitionId = typeof params.definitionId === 'string' ? params.definitionId.trim() : '';
  const definitionHash = typeof params.definitionHash === 'string' ? params.definitionHash.trim() : '';
  if (!definitionId || !definitionHash) return null;
  return `${definitionId}@${definitionHash}`;
}

function hasCallDefinitionPins(params: Record<string, unknown> | undefined): boolean {
  if (!isPlainObject(params)) return false;
  return Array.isArray((params as any).calleeInputPins) && Array.isArray((params as any).calleeOutputPins);
}

function resetCallDefinitionSyncState() {
  for (const timer of callDefSyncTimers.values()) {
    window.clearTimeout(timer);
  }
  callDefSyncTimers.clear();
  callDefSyncing.clear();
  callDefSyncedKeyByNodeId.clear();
}

function seedCallDefinitionSyncStateFromGraph() {
  for (const node of graph.value.nodes) {
    if (node.nodeType !== 'flow.call_definition') continue;
    const params = isPlainObject(node.params) ? node.params : undefined;
    const key = buildCallDefinitionRefKey(params);
    if (!key || !hasCallDefinitionPins(params)) continue;
    callDefSyncedKeyByNodeId.set(node.id, key);
  }
}

async function loadCatalog() {
  catalogLoading.value = true;
  try {
    catalog.value = await backendApi.getNodeCatalog();
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    catalogLoading.value = false;
  }
}

async function searchDefinitions(q: string) {
  defsLoading.value = true;
  try {
    const res = await backendApi.listDefinitions({ q, limit: 50 });
    definitionOptions.value = res.items;
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    defsLoading.value = false;
  }
}

async function refreshDefinitions() {
  await searchDefinitions('');
}

async function onSelectDefinition() {
  if (!selectedDefinitionId.value) return;
  await openDraft(selectedDefinitionId.value);
}

async function openDraft(definitionId: string) {
  draftLoading.value = true;
  try {
    const draft = await backendApi.getDraft(definitionId);
    applyDraft(draft);
    ElMessage.success('已加载草稿');
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    draftLoading.value = false;
  }
}

function applyDraft(draft: DefinitionDraft) {
  resetCallDefinitionSyncState();
  selectedDefinitionId.value = draft.definitionId;
  currentDraftInfo.value = {
    draftRevisionId: draft.draftRevisionId,
    updatedAt: draft.updatedAt,
  };

  const content: any = draft.content as any;
  if (!content || typeof content !== 'object' || content.schemaVersion !== 2) {
    ElMessage.error('该草稿不是 Graph v2（schemaVersion=2），无法在新版编辑器打开');
    graph.value = createEmptyGraph();
    dirty.value = false;
  } else {
    graph.value = content as GraphJsonV2;
    seedCallDefinitionSyncStateFromGraph();
    dirty.value = false;
  }
  runnerConfigText.value = JSON.stringify(draft.runnerConfig ?? {}, null, 2);
  outputSchemaText.value = JSON.stringify(draft.outputSchema ?? {}, null, 2);

  issues.value = [];
  definitionHash.value = null;
  dryRunResult.value = null;
  canvasKey.value += 1; // 强制重建画布
}

async function createDraft() {
  const id = newDefinitionId.value.trim();
  if (!id) {
    ElMessage.warning('请输入 definitionId');
    return;
  }

  draftLoading.value = true;
  try {
    await backendApi.createDraft({
      definitionId: id,
      contentType: 'graph_json',
      content: createEmptyGraph() as any,
      outputSchema: null,
      runnerConfig: null,
    });
    await openDraft(id);
    await refreshDefinitions();
    newDefinitionId.value = '';
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    draftLoading.value = false;
  }
}

async function saveDraft() {
  if (!selectedDefinitionId.value || !currentDraftInfo.value) return;

  const rc = safeParseJson(runnerConfigText.value, 'runnerConfig');
  runnerConfigError.value = rc.ok ? null : rc.error;
  const os = safeParseJson(outputSchemaText.value, 'outputSchema');
  outputSchemaError.value = os.ok ? null : os.error;
  if (!rc.ok || !os.ok) return;

  draftSaving.value = true;
  try {
    const res = await backendApi.updateDraft(selectedDefinitionId.value, {
      draftRevisionId: currentDraftInfo.value.draftRevisionId,
      contentType: 'graph_json',
      content: graph.value as any,
      outputSchema: os.value,
      runnerConfig: rc.value,
    });
    currentDraftInfo.value = { draftRevisionId: res.draftRevisionId, updatedAt: res.updatedAt };
    dirty.value = false;
    ElMessage.success('已保存');
    await refreshDefinitions();
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    draftSaving.value = false;
  }
}

function updateNodeParams(nodeId: string, params: Record<string, unknown>) {
  const node = graph.value.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  node.params = params;
  dirty.value = true;
  const paramsError = nodePinNameValidationError(node.nodeType, params);
  if (selectedNodeId.value === nodeId) {
    nodeParamsError.value = paramsError;
  }
  if (node.nodeType === 'flow.start' || node.nodeType === 'flow.end' || node.nodeType === 'flow.call_definition') {
    if (!paramsError) {
      void canvasRef.value?.rebuildNode(nodeId);
    }
  } else {
    void canvasRef.value?.refreshNodeTitle(nodeId);
  }

  if (node.nodeType === 'flow.call_definition' && !callDefSyncing.has(nodeId)) {
    const key = buildCallDefinitionRefKey(params);
    const syncedKey = callDefSyncedKeyByNodeId.get(nodeId) ?? null;
    const shouldSync = Boolean(key) && (!hasCallDefinitionPins(params) || syncedKey !== key);
    if (shouldSync) {
      scheduleCallDefinitionPinsSync(nodeId);
    }
  }
}

function scheduleCallDefinitionPinsSync(nodeId: string) {
  const prev = callDefSyncTimers.get(nodeId);
  if (prev) {
    window.clearTimeout(prev);
  }
  const timer = window.setTimeout(() => {
    void syncCallDefinitionPinsIfNeeded(nodeId);
  }, 500);
  callDefSyncTimers.set(nodeId, timer);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function normalizePinDefs(value: unknown): any[] {
  const VALUE_TYPES = ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'] as const;
  if (!Array.isArray(value)) return [];
  const pins: any[] = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const valueType = typeof item.valueType === 'string' ? item.valueType : '';
    if (!name) continue;
    if (!(VALUE_TYPES as readonly string[]).includes(valueType)) continue;

    const pin: any = { name, valueType };
    if (typeof item.label === 'string') pin.label = item.label;
    if (typeof item.required === 'boolean') pin.required = item.required;
    if (Object.prototype.hasOwnProperty.call(item, 'defaultValue')) pin.defaultValue = item.defaultValue;
    const rounding = item.rounding;
    if (isPlainObject(rounding)) {
      const scale = rounding.scale;
      const mode = rounding.mode;
      if (typeof scale === 'number' && Number.isInteger(scale) && scale >= 0 && typeof mode === 'string') {
        pin.rounding = { scale, mode };
      }
    }
    pins.push(pin);
  }
  return pins;
}

function pinSnapshotSignature(pins: unknown): string {
  return JSON.stringify(normalizePinDefs(pins));
}

function findDuplicatePinName(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

function nodePinNameValidationError(nodeType: string, params: Record<string, unknown>): string | null {
  if (nodeType === 'flow.start') {
    const dup = findDuplicatePinName((params as any).dynamicOutputs);
    return dup ? `输入 pins 存在重复 name：${dup}` : null;
  }
  if (nodeType === 'flow.end') {
    const dup = findDuplicatePinName((params as any).dynamicInputs);
    return dup ? `输出 pins 存在重复 name：${dup}` : null;
  }
  if (nodeType === 'flow.call_definition') {
    const inDup = findDuplicatePinName((params as any).calleeInputPins);
    if (inDup) return `calleeInputPins 存在重复 name：${inDup}`;
    const outDup = findDuplicatePinName((params as any).calleeOutputPins);
    if (outDup) return `calleeOutputPins 存在重复 name：${outDup}`;
  }
  return null;
}

async function syncCallDefinitionPinsIfNeeded(nodeId: string) {
  const node = graph.value.nodes.find((n) => n.id === nodeId);
  if (!node || node.nodeType !== 'flow.call_definition') return;
  if (!isPlainObject(node.params)) return;

  const definitionId = typeof node.params.definitionId === 'string' ? node.params.definitionId.trim() : '';
  const definitionHash = typeof node.params.definitionHash === 'string' ? node.params.definitionHash.trim() : '';
  const key = buildCallDefinitionRefKey(node.params);
  if (!key || !definitionId || !definitionHash) return;

  const alreadySyncedKey = callDefSyncedKeyByNodeId.get(nodeId);
  const hasPins = hasCallDefinitionPins(node.params);
  if (alreadySyncedKey === key && hasPins) {
    return;
  }

  callDefSyncing.add(nodeId);
  try {
    const release: any = await backendApi.getRelease(definitionId, definitionHash);
    const content: any = release?.content;
    if (!content || content.schemaVersion !== 2 || !Array.isArray(content.nodes)) {
      ElMessage.error('子蓝图不是 Graph v2（schemaVersion=2），无法生成动态 pins');
      return;
    }

    const startNode = content.nodes.find((n: any) => n?.nodeType === 'flow.start') as any;
    const endNode = content.nodes.find((n: any) => n?.nodeType === 'flow.end') as any;
    const calleeInputPins = normalizePinDefs(startNode?.params?.dynamicOutputs);
    const calleeOutputPins = normalizePinDefs(endNode?.params?.dynamicInputs);

    const nextParams: Record<string, unknown> = {
      ...node.params,
      calleeInputPins,
      calleeOutputPins,
    };

    const curSig =
      pinSnapshotSignature((node.params as any).calleeInputPins) +
      '|' +
      pinSnapshotSignature((node.params as any).calleeOutputPins);
    const nextSig = pinSnapshotSignature(calleeInputPins) + '|' + pinSnapshotSignature(calleeOutputPins);
    if (curSig !== nextSig) {
      updateNodeParams(nodeId, nextParams);
    }

    callDefSyncedKeyByNodeId.set(nodeId, key);
  } catch (e) {
    ElMessage.error(`获取子蓝图失败：${normalizeHttpError(e)}`);
  } finally {
    callDefSyncing.delete(nodeId);
  }
}

function onSelectedNodeParamsUpdate(v: Record<string, unknown> | null) {
  const node = selectedNode.value;
  if (!node) return;
  const nextParams = v ?? {};
  nodeParamsError.value = nodePinNameValidationError(node.nodeType, nextParams);
  updateNodeParams(node.id, nextParams);
}

watch(
  selectedNode,
  (node) => {
    if (!node || !isPlainObject(node.params)) {
      nodeParamsError.value = null;
      return;
    }
    nodeParamsError.value = nodePinNameValidationError(node.nodeType, node.params);
  },
  { immediate: true },
);

async function addNode(nodeType: string) {
  if (!catalog.value) {
    ElMessage.warning('Node Catalog 未加载');
    return;
  }
  await canvasRef.value?.addNode(nodeType);
}

async function focusSelected() {
  if (!selectedNodeId.value) return;
  await canvasRef.value?.focusNode(selectedNodeId.value);
}

async function removeSelected() {
  if (!selectedNodeId.value) return;
  await canvasRef.value?.removeNode(selectedNodeId.value);
  selectedNodeId.value = null;
}

async function validate() {
  validateLoading.value = true;
  try {
    const rc = safeParseJson(runnerConfigText.value, 'runnerConfig');
    runnerConfigError.value = rc.ok ? null : rc.error;
    const os = safeParseJson(outputSchemaText.value, 'outputSchema');
    outputSchemaError.value = os.ok ? null : os.error;
    if (!rc.ok || !os.ok) return;

    const res = await backendApi.validateDefinition({
      definition: {
        contentType: 'graph_json',
        content: graph.value as any,
        outputSchema: os.value,
        runnerConfig: rc.value,
      },
    });
    issues.value = res.errors ?? [];
    definitionHash.value = res.definitionHash ?? null;
    if (res.ok) ElMessage.success('校验通过');
    else ElMessage.warning('校验未通过');
    rightTab.value = 'validate';
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    validateLoading.value = false;
  }
}

function formatIssue(it: ValidationIssue): string {
  return `${it.message}${it.path ? ` · ${it.path}` : ''}`;
}

function issueNodeId(it: ValidationIssue): string | null {
  if (!it.path) return null;
  const m = it.path.match(/^\/nodes\/(\d+)/);
  if (!m) return null;
  const idx = Number(m[1]);
  const node = graph.value.nodes[idx];
  return node ? node.id : null;
}

async function focusIssue(it: ValidationIssue) {
  const nodeId = issueNodeId(it);
  if (nodeId) {
    await canvasRef.value?.focusNode(nodeId);
    selectedNodeId.value = nodeId;
  }
}

function loadPreviewTemplate() {
  const startNode = graph.value.nodes.find((n) => n.nodeType === 'flow.start') as any;
  const pins: any[] = Array.isArray(startNode?.params?.dynamicOutputs) ? startNode.params.dynamicOutputs : [];
  const tpl: Record<string, unknown> = {};
  for (const p of pins) {
    const name = typeof p?.name === 'string' ? p.name : '';
    const vt = p?.valueType;
    if (!name) continue;
    switch (vt) {
      case 'Decimal':
      case 'Ratio':
        tpl[name] = '0';
        break;
      case 'String':
        tpl[name] = '';
        break;
      case 'Boolean':
        tpl[name] = false;
        break;
      case 'DateTime':
        tpl[name] = new Date().toISOString();
        break;
      case 'Json':
        tpl[name] = null;
        break;
      default:
        tpl[name] = null;
        break;
    }
  }

  previewInputsText.value = JSON.stringify(
    {
      ...tpl,
      _meta: { asOf: new Date().toISOString(), notes: 'extra fields are allowed and ignored by engine by default' },
    },
    null,
    2,
  );
  previewOptionsText.value = JSON.stringify({ timeoutMs: 2000 }, null, 2);
}

async function dryRun() {
  const inputs = safeParseJson(previewInputsText.value, 'inputs');
  previewInputsError.value = inputs.ok ? null : inputs.error;
  const options = safeParseJson(previewOptionsText.value, 'options');
  previewOptionsError.value = options.ok ? null : options.error;
  if (!inputs.ok || !options.ok) return;

  const rc = safeParseJson(runnerConfigText.value, 'runnerConfig');
  runnerConfigError.value = rc.ok ? null : rc.error;
  const os = safeParseJson(outputSchemaText.value, 'outputSchema');
  outputSchemaError.value = os.ok ? null : os.error;
  if (!rc.ok || !os.ok) return;

  dryRunLoading.value = true;
  try {
    const res = await backendApi.dryRun({
      definition: {
        contentType: 'graph_json',
        content: graph.value as any,
        outputSchema: os.value,
        runnerConfig: rc.value,
      },
      inputs: inputs.value,
      options: options.value,
    });
    dryRunResult.value = res;
    rightTab.value = 'preview';
    if (res.ok) ElMessage.success('dry-run 完成');
    else ElMessage.warning('dry-run 返回错误');
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    dryRunLoading.value = false;
  }
}

async function publish() {
  if (!selectedDefinitionId.value || !currentDraftInfo.value) return;

  let changelog: string | undefined;
  try {
    const r = await ElMessageBox.prompt('请输入 changelog（可选，但建议填写）', '发布', {
      confirmButtonText: '发布',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：新增税费规则、修复 rounding 逻辑...',
    });
    changelog = r.value;
  } catch {
    return;
  }

  publishLoading.value = true;
  try {
    const res = await backendApi.publishDefinition(selectedDefinitionId.value, {
      draftRevisionId: currentDraftInfo.value.draftRevisionId,
      changelog: changelog || undefined,
    });
    ElMessage.success(`已发布：${res.definitionHash}`);
    await refreshDefinitions();
  } catch (e) {
    ElMessage.error(normalizeHttpError(e));
  } finally {
    publishLoading.value = false;
  }
}

onMounted(() => {
  void loadCatalog();
  void refreshDefinitions();

  const defFromQuery = route.query['definitionId'];
  if (typeof defFromQuery === 'string' && defFromQuery.trim()) {
    selectedDefinitionId.value = defFromQuery.trim();
    void openDraft(selectedDefinitionId.value);
  }
});
</script>

<style scoped>
.studio {
  display: grid;
  grid-template-columns: 320px 1fr 420px;
  gap: 12px;
  height: calc(100vh - 120px);
}
.left,
.center,
.right {
  min-height: 0;
}
.card {
  height: 100%;
}
.left {
  display: grid;
  grid-template-rows: 360px 1fr;
  gap: 12px;
}
.canvas-card {
  height: 100%;
}
.canvas-wrap {
  height: calc(100% - 10px);
  min-height: 0;
}
.hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.row {
  display: flex;
  gap: 10px;
  align-items: center;
}
.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.info {
  margin-top: 10px;
  font-size: 12px;
}
.muted {
  opacity: 0.8;
}
.palette {
  margin-top: 12px;
  height: calc(100% - 44px);
  overflow: auto;
}
.cat {
  font-weight: 600;
}
.node-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.node-btn {
  justify-content: flex-start;
  padding: 10px 8px;
  height: auto;
}
.node-title {
  font-weight: 600;
}
.node-sub {
  font-size: 12px;
  opacity: 0.75;
}
.opt-title {
  font-weight: 600;
}
.opt-sub {
  font-size: 12px;
  opacity: 0.75;
}
.node-head {
  margin-bottom: 10px;
}
.mono :deep(textarea),
.mono pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
.err {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}
.result {
  margin-top: 10px;
  max-height: 240px;
  overflow: auto;
  padding: 10px;
  border-radius: 10px;
  border: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
</style>
