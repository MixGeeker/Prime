<template>
  <div>
    <div class="row" style="margin-bottom: 10px">
      <el-button type="primary" @click="openCreate">新增 entrypoint</el-button>
      <el-button :disabled="!selectedNodeId" @click="setMainToSelected">main 指向选中节点</el-button>
      <div class="muted">入口决定从哪个 exec 输出端口触发执行（UE 风格事件节点），并声明 params（读取自 inputs.params）。</div>
    </div>

    <el-table :data="graph.entrypoints" size="small" height="320px" stripe>
      <el-table-column prop="key" label="key" width="160" />
      <el-table-column label="params" width="90">
        <template #default="{ row }">
          <el-tag type="info">{{ row.params?.length ?? 0 }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="from" min-width="220">
        <template #default="{ row }">
          <span class="mono muted">
            <template v-if="row.from">{{ row.from?.nodeId }} · {{ row.from?.port }}</template>
            <template v-else>{{ row.to?.nodeId }} · {{ row.to?.port }} (legacy)</template>
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ $index }">
          <el-button text @click="openEdit($index)">编辑</el-button>
          <el-button text type="danger" @click="removeAt($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogOpen"
      :title="editingIndex === null ? '新增 entrypoint' : '编辑 entrypoint'"
      width="720px"
    >
      <el-form label-position="top" :model="form">
        <el-form-item label="key">
          <el-input v-model="form.key" placeholder="例如：main / onPriceFix" />
        </el-form-item>

        <el-form-item label="from.nodeId（入口事件节点）">
          <el-select v-model="form.fromNodeId" filterable style="width: 100%">
            <el-option v-for="n in execSourceNodeOptions" :key="n.nodeId" :label="n.nodeId" :value="n.nodeId">
              <div class="opt">
                <div class="opt-title">{{ n.nodeId }}</div>
                <div class="opt-sub muted">{{ n.nodeType }}</div>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="from.port（exec 输出端口）">
          <el-select v-model="form.fromPort" style="width: 100%">
            <el-option v-for="p in availableExecPorts" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>

        <el-form-item label="params（强类型入参契约）">
          <div class="row" style="margin-bottom: 10px">
            <el-button type="primary" :disabled="isBusinessMode" @click="openCreateParam">新增 param</el-button>
            <el-button :disabled="!inputsCatalogParams.length" @click="openImportParams">从 Provider 目录导入</el-button>
            <span v-if="isBusinessMode" class="muted">业务模式下建议从目录导入，避免手写 key。</span>
          </div>

          <el-table :data="form.params" size="small" height="260px" stripe style="width: 100%">
            <el-table-column prop="name" label="name" width="160" />
            <el-table-column prop="valueType" label="valueType" width="110" />
            <el-table-column label="required" width="90">
              <template #default="{ row }">
                <el-tag v-if="row.required" type="success">true</el-tag>
                <el-tag v-else type="info">false</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="default" min-width="160">
              <template #default="{ row }">
                <span class="mono muted">{{ formatDefault(row.default) }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="description" min-width="200" />
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ $index }">
                <el-button text @click="openEditParam($index)">编辑</el-button>
                <el-button text type="danger" @click="removeParamAt($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <InputDefEditorDialog
      v-model="paramDialogOpen"
      :title="paramEditingIndex === null ? '新增 param' : '编辑 param'"
      :value="paramEditingValue"
      :disable-name="isBusinessMode"
      :disable-type="isBusinessMode"
      @save="saveParam"
    />

    <el-dialog v-model="importDialogOpen" title="从 Provider Inputs Catalog 导入 params" width="760px">
      <el-input v-model="importQuery" placeholder="搜索 name/description..." clearable />

      <el-table
        :data="filteredCatalogParams"
        size="small"
        height="360px"
        stripe
        style="margin-top: 10px"
        @selection-change="onImportSelectionChange"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="name" label="name" width="180" />
        <el-table-column prop="valueType" label="valueType" width="110" />
        <el-table-column prop="description" label="description" min-width="260" />
      </el-table>

      <template #footer>
        <el-button @click="importDialogOpen = false">取消</el-button>
        <el-button type="primary" :disabled="importSelection.length === 0" @click="importSelectedParams">
          导入 {{ importSelection.length }} 项
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { GraphEntrypoint, GraphInputDef, GraphJsonV1, InputsCatalogV1, NodeCatalog } from '@/engine/types';
import { useSettingsStore } from '@/stores/settings';
import InputDefEditorDialog from './InputDefEditorDialog.vue';

const props = defineProps<{
  graph: GraphJsonV1;
  catalog: NodeCatalog | null;
  selectedNodeId?: string | null;
  inputsCatalog?: InputsCatalogV1 | null;
}>();
const emit = defineEmits<{ (e: 'dirty'): void }>();

const settings = useSettingsStore();
const isBusinessMode = computed(() => settings.studioMode === 'business');

const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);

const form = ref<{
  key: string;
  fromNodeId: string;
  fromPort: string;
  params: GraphInputDef[];
}>({
  key: 'main',
  fromNodeId: 'n_start',
  fromPort: 'out',
  params: [],
});

const execSourceNodeOptions = computed(() => {
  const catalog = props.catalog;
  if (!catalog) return [];
  const result: Array<{ nodeId: string; nodeType: string; ports: string[] }> = [];
  for (const n of props.graph.nodes) {
    const def = catalog.nodes.find((d) => d.nodeType === n.nodeType);
    const hasExecInputs = (def?.execInputs ?? []).length > 0;
    if (hasExecInputs) continue;
    const ports = (def?.execOutputs ?? []).map((p) => p.name);
    if (ports.length === 0) continue;
    result.push({ nodeId: n.id, nodeType: n.nodeType, ports });
  }
  return result;
});

const availableExecPorts = computed(() => {
  const found = execSourceNodeOptions.value.find((x) => x.nodeId === form.value.fromNodeId);
  return found?.ports ?? [];
});

function openCreate() {
  editingIndex.value = null;
  form.value = {
    key: 'main',
    fromNodeId: execSourceNodeOptions.value[0]?.nodeId ?? 'n_start',
    fromPort: execSourceNodeOptions.value[0]?.ports?.[0] ?? 'out',
    params: [],
  };
  dialogOpen.value = true;
}

function openEdit(index: number) {
  const ep = props.graph.entrypoints[index];
  if (!ep) return;
  editingIndex.value = index;
  const from = ep.from ?? null;
  const to = ep.to ?? null;
  form.value = {
    key: ep.key,
    fromNodeId: from?.nodeId ?? to?.nodeId ?? 'n_start',
    fromPort: from?.port ?? 'out',
    params: structuredClone(ep.params ?? []),
  };
  dialogOpen.value = true;
}

async function removeAt(index: number) {
  const ep = props.graph.entrypoints[index];
  if (!ep) return;
  try {
    await ElMessageBox.confirm(`确认删除 entrypoint: ${ep.key} ?`, '确认', { type: 'warning' });
    props.graph.entrypoints.splice(index, 1);
    emit('dirty');
    ElMessage.success('已删除');
  } catch {
    // cancel
  }
}

function formatDefault(v: unknown): string {
  if (typeof v === 'undefined') return '';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function save() {
  const key = form.value.key.trim();
  if (!key) {
    ElMessage.warning('key 不能为空');
    return;
  }
  if (!form.value.fromNodeId) {
    ElMessage.warning('from.nodeId 不能为空');
    return;
  }
  if (!form.value.fromPort) {
    ElMessage.warning('from.port 不能为空');
    return;
  }

  const next: GraphEntrypoint = {
    key,
    params: form.value.params,
    from: { nodeId: form.value.fromNodeId, port: form.value.fromPort },
  };

  if (editingIndex.value === null) {
    props.graph.entrypoints.push(next);
  } else {
    props.graph.entrypoints.splice(editingIndex.value, 1, next);
  }

  dialogOpen.value = false;
  emit('dirty');
  ElMessage.success('已保存');
}

function setMainToSelected() {
  const nodeId = props.selectedNodeId;
  if (!nodeId || !props.catalog) return;
  const node = props.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const def = props.catalog.nodes.find((d) => d.nodeType === node.nodeType);
  const hasExecInputs = (def?.execInputs ?? []).length > 0;
  if (hasExecInputs) {
    ElMessage.warning('选中节点不是入口事件节点（存在 execInputs），请选 flow.start 或其它事件节点');
    return;
  }
  const port = def?.execOutputs?.[0]?.name;
  if (!port) {
    ElMessage.warning('选中节点没有 execOutputs');
    return;
  }

  const main = props.graph.entrypoints.find((e) => e.key === 'main');
  if (!main) {
    props.graph.entrypoints.push({ key: 'main', params: [], from: { nodeId, port } });
  } else {
    main.from = { nodeId, port };
    delete (main as any).to;
  }
  emit('dirty');
  ElMessage.success('已更新 main 入口');
}

// params editor
const paramDialogOpen = ref(false);
const paramEditingIndex = ref<number | null>(null);

const paramEditingValue = computed(() => {
  if (paramEditingIndex.value === null) return null;
  return form.value.params[paramEditingIndex.value] ?? null;
});

function openCreateParam() {
  paramEditingIndex.value = null;
  paramDialogOpen.value = true;
}

function openEditParam(index: number) {
  paramEditingIndex.value = index;
  paramDialogOpen.value = true;
}

function saveParam(v: GraphInputDef) {
  if (paramEditingIndex.value === null) {
    form.value.params.push(v);
  } else {
    form.value.params.splice(paramEditingIndex.value, 1, v);
  }
  emit('dirty');
}

async function removeParamAt(index: number) {
  const item = form.value.params[index];
  if (!item) return;
  try {
    await ElMessageBox.confirm(`确认删除 param: ${item.name} ?`, '确认', { type: 'warning' });
    form.value.params.splice(index, 1);
    emit('dirty');
    ElMessage.success('已删除');
  } catch {
    // cancel
  }
}

// import from catalog
const importDialogOpen = ref(false);
const importQuery = ref('');
const importSelection = ref<Array<{ name: string; valueType: any; description?: string }>>([]);

const inputsCatalogParams = computed(() => props.inputsCatalog?.params ?? []);

const filteredCatalogParams = computed(() => {
  const q = importQuery.value.trim().toLowerCase();
  const all = inputsCatalogParams.value;
  if (!q) return all;
  return all.filter(
    (it) =>
      it.name.toLowerCase().includes(q) ||
      String(it.description ?? '').toLowerCase().includes(q),
  );
});

function openImportParams() {
  if (inputsCatalogParams.value.length === 0) {
    ElMessage.warning('Provider Inputs Catalog 不可用或为空');
    return;
  }
  importSelection.value = [];
  importQuery.value = '';
  importDialogOpen.value = true;
}

function onImportSelectionChange(rows: any[]) {
  importSelection.value = rows ?? [];
}

function importSelectedParams() {
  const existing = new Set(form.value.params.map((p) => p.name));
  let added = 0;
  for (const it of importSelection.value) {
    if (!it?.name) continue;
    if (existing.has(it.name)) continue;
    form.value.params.push({
      name: it.name,
      valueType: it.valueType,
      required: true,
      description: it.description,
    });
    existing.add(it.name);
    added++;
  }
  importDialogOpen.value = false;
  emit('dirty');
  ElMessage.success(`已导入 ${added} 项`);
}
</script>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.muted {
  opacity: 0.75;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
.opt-title {
  font-weight: 600;
}
.opt-sub {
  font-size: 12px;
}
</style>
