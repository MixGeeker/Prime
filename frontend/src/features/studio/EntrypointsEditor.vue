<template>
  <div>
    <div class="row" style="margin-bottom: 10px">
      <el-button type="primary" @click="openCreate">新增 entrypoint</el-button>
      <el-button :disabled="!selectedNodeId" @click="setMainToSelected">main 指向选中节点</el-button>
      <div class="muted">入口决定从哪个 exec 输入端口开始执行，并声明 params（读取自 inputs.params）。</div>
    </div>

    <el-table :data="graph.entrypoints" size="small" height="320px" stripe>
      <el-table-column prop="key" label="key" width="160" />
      <el-table-column label="params" width="90">
        <template #default="{ row }">
          <el-tag type="info">{{ row.params?.length ?? 0 }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="to" min-width="220">
        <template #default="{ row }">
          <span class="mono muted">{{ row.to?.nodeId }} · {{ row.to?.port }}</span>
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

        <el-form-item label="to.nodeId（起点节点）">
          <el-select v-model="form.toNodeId" filterable style="width: 100%">
            <el-option v-for="n in execInputNodeOptions" :key="n.nodeId" :label="n.nodeId" :value="n.nodeId">
              <div class="opt">
                <div class="opt-title">{{ n.nodeId }}</div>
                <div class="opt-sub muted">{{ n.nodeType }}</div>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="to.port（exec 输入端口）">
          <el-select v-model="form.toPort" style="width: 100%">
            <el-option v-for="p in availableExecPorts" :key="p" :label="p" :value="p" />
          </el-select>
        </el-form-item>

        <el-form-item label="params（JSON 数组）">
          <el-input v-model="form.paramsJson" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" class="mono" />
          <div v-if="paramsError" class="err">{{ paramsError }}</div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { GraphEntrypoint, GraphInputDef, GraphJsonV1, NodeCatalog } from '@/engine/types';

const props = defineProps<{
  graph: GraphJsonV1;
  catalog: NodeCatalog | null;
  selectedNodeId?: string | null;
}>();
const emit = defineEmits<{ (e: 'dirty'): void }>();

const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);
const paramsError = ref<string | null>(null);

const form = ref<{
  key: string;
  toNodeId: string;
  toPort: string;
  paramsJson: string;
}>({
  key: 'main',
  toNodeId: 'n_start',
  toPort: 'in',
  paramsJson: '[]',
});

const execInputNodeOptions = computed(() => {
  const catalog = props.catalog;
  if (!catalog) return [];
  const result: Array<{ nodeId: string; nodeType: string; ports: string[] }> = [];
  for (const n of props.graph.nodes) {
    const def = catalog.nodes.find((d) => d.nodeType === n.nodeType);
    const ports = (def?.execInputs ?? []).map((p) => p.name);
    if (ports.length === 0) continue;
    result.push({ nodeId: n.id, nodeType: n.nodeType, ports });
  }
  return result;
});

const availableExecPorts = computed(() => {
  const found = execInputNodeOptions.value.find((x) => x.nodeId === form.value.toNodeId);
  return found?.ports ?? [];
});

function openCreate() {
  editingIndex.value = null;
  paramsError.value = null;
  form.value = {
    key: 'main',
    toNodeId: execInputNodeOptions.value[0]?.nodeId ?? 'n_start',
    toPort: execInputNodeOptions.value[0]?.ports?.[0] ?? 'in',
    paramsJson: '[]',
  };
  dialogOpen.value = true;
}

function openEdit(index: number) {
  const ep = props.graph.entrypoints[index];
  if (!ep) return;
  editingIndex.value = index;
  paramsError.value = null;
  form.value = {
    key: ep.key,
    toNodeId: ep.to.nodeId,
    toPort: ep.to.port,
    paramsJson: JSON.stringify(ep.params ?? [], null, 2),
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

function parseParams(): GraphInputDef[] | null {
  paramsError.value = null;
  try {
    const parsed = JSON.parse(form.value.paramsJson) as unknown;
    if (!Array.isArray(parsed)) {
      paramsError.value = 'params 必须是数组';
      return null;
    }
    return parsed as GraphInputDef[];
  } catch (e) {
    paramsError.value = `params JSON 解析失败：${String(e)}`;
    return null;
  }
}

function save() {
  const key = form.value.key.trim();
  if (!key) {
    ElMessage.warning('key 不能为空');
    return;
  }
  if (!form.value.toNodeId) {
    ElMessage.warning('to.nodeId 不能为空');
    return;
  }
  if (!form.value.toPort) {
    ElMessage.warning('to.port 不能为空');
    return;
  }

  const params = parseParams();
  if (!params) return;

  const next: GraphEntrypoint = {
    key,
    params,
    to: { nodeId: form.value.toNodeId, port: form.value.toPort },
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
  const port = def?.execInputs?.[0]?.name;
  if (!port) {
    ElMessage.warning('选中节点没有 execInputs');
    return;
  }

  const main = props.graph.entrypoints.find((e) => e.key === 'main');
  if (!main) {
    props.graph.entrypoints.push({ key: 'main', params: [], to: { nodeId, port } });
  } else {
    main.to = { nodeId, port };
  }
  emit('dirty');
  ElMessage.success('已更新 main 入口');
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
.err {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}
.opt-title {
  font-weight: 600;
}
.opt-sub {
  font-size: 12px;
}
</style>

