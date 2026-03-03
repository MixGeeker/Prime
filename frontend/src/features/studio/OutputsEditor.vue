<template>
  <div>
    <div class="row" style="margin-bottom: 10px">
      <el-button type="primary" @click="openCreate">新增 output</el-button>
      <div class="muted">outputs 声明会参与 outputsHash，并可选择 rounding。</div>
    </div>

    <el-table :data="graph.outputs" size="small" height="320px" stripe>
      <el-table-column prop="key" label="key" width="180" />
      <el-table-column prop="valueType" label="valueType" width="110" />
      <el-table-column label="from" min-width="220">
        <template #default="{ row }">
          <span class="mono muted">{{ row.from?.nodeId }} · {{ row.from?.port }}</span>
        </template>
      </el-table-column>
      <el-table-column label="rounding" min-width="180">
        <template #default="{ row }">
          <span class="mono muted">
            <template v-if="row.rounding">{{ row.rounding.mode }} @ {{ row.rounding.scale }}</template>
            <template v-else>-</template>
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

    <el-dialog v-model="dialogOpen" :title="editingIndex === null ? '新增 output' : '编辑 output'" width="720px">
      <el-form label-position="top" :model="form">
        <el-form-item label="key">
          <el-input v-model="form.key" placeholder="例如：selling_price" />
        </el-form-item>

        <el-form-item label="from（选择一个 value 输出端口）">
          <el-select v-model="form.fromId" filterable style="width: 100%">
            <el-option
              v-for="o in outputPortOptions"
              :key="o.id"
              :label="`${o.nodeId}.${o.port} (${o.valueType})`"
              :value="o.id"
            >
              <div class="opt">
                <div class="opt-title">{{ o.nodeId }} · {{ o.port }}</div>
                <div class="opt-sub muted">{{ o.nodeType }} · {{ o.valueType }}</div>
              </div>
            </el-option>
          </el-select>
        </el-form-item>

        <el-form-item label="valueType（由 from 自动决定）">
          <el-input :model-value="selectedPort?.valueType ?? ''" disabled />
        </el-form-item>

        <el-form-item v-if="canRounding" label="rounding（仅 Decimal/Ratio）">
          <div class="row">
            <el-switch v-model="form.roundingEnabled" active-text="启用" inactive-text="关闭" />
            <el-input-number v-model="form.roundingScale" :min="0" :max="18" :step="1" :disabled="!form.roundingEnabled" />
            <el-select v-model="form.roundingMode" :disabled="!form.roundingEnabled" style="flex: 1">
              <el-option v-for="m in roundingModes" :key="m" :label="m" :value="m" />
            </el-select>
          </div>
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
import type { GraphJsonV1, NodeCatalog, RoundingMode, ValueType } from '@/engine/types';

const props = defineProps<{ graph: GraphJsonV1; catalog: NodeCatalog | null }>();
const emit = defineEmits<{ (e: 'dirty'): void }>();

const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);

const roundingModes: RoundingMode[] = [
  'UP',
  'DOWN',
  'CEIL',
  'FLOOR',
  'HALF_UP',
  'HALF_DOWN',
  'HALF_EVEN',
  'HALF_CEIL',
  'HALF_FLOOR',
];

type PortOption = {
  id: string;
  nodeId: string;
  nodeType: string;
  port: string;
  valueType: ValueType;
};

const outputPortOptions = computed<PortOption[]>(() => {
  const catalog = props.catalog;
  if (!catalog) return [];
  const result: PortOption[] = [];

  for (const n of props.graph.nodes) {
    const def = catalog.nodes.find((d) => d.nodeType === n.nodeType);
    if (!def) continue;
    for (const out of def.outputs) {
      result.push({
        id: `${n.id}::${out.name}`,
        nodeId: n.id,
        nodeType: n.nodeType,
        port: out.name,
        valueType: out.valueType,
      });
    }
  }
  return result;
});

const form = ref<{
  key: string;
  fromId: string;
  roundingEnabled: boolean;
  roundingScale: number;
  roundingMode: RoundingMode;
}>({
  key: '',
  fromId: '',
  roundingEnabled: false,
  roundingScale: 2,
  roundingMode: 'HALF_UP',
});

const selectedPort = computed(() => outputPortOptions.value.find((o) => o.id === form.value.fromId) ?? null);
const canRounding = computed(() => {
  const vt = selectedPort.value?.valueType;
  return vt === 'Decimal' || vt === 'Ratio';
});

function openCreate() {
  editingIndex.value = null;
  form.value = {
    key: '',
    fromId: outputPortOptions.value[0]?.id ?? '',
    roundingEnabled: false,
    roundingScale: 2,
    roundingMode: 'HALF_UP',
  };
  dialogOpen.value = true;
}

function openEdit(index: number) {
  const item = props.graph.outputs[index];
  if (!item) return;
  editingIndex.value = index;
  form.value = {
    key: item.key,
    fromId: `${item.from.nodeId}::${item.from.port}`,
    roundingEnabled: Boolean(item.rounding),
    roundingScale: item.rounding?.scale ?? 2,
    roundingMode: item.rounding?.mode ?? 'HALF_UP',
  };
  dialogOpen.value = true;
}

async function removeAt(index: number) {
  const item = props.graph.outputs[index];
  if (!item) return;
  try {
    await ElMessageBox.confirm(`确认删除 output: ${item.key} ?`, '确认', { type: 'warning' });
    props.graph.outputs.splice(index, 1);
    emit('dirty');
    ElMessage.success('已删除');
  } catch {
    // cancel
  }
}

function save() {
  const key = form.value.key.trim();
  if (!key) {
    ElMessage.warning('key 不能为空');
    return;
  }
  const port = selectedPort.value;
  if (!port) {
    ElMessage.warning('请选择 from 端口');
    return;
  }

  const valueType = port.valueType;
  const next = {
    key,
    valueType,
    from: { nodeId: port.nodeId, port: port.port },
  } as any;

  if (canRounding.value && form.value.roundingEnabled) {
    next.rounding = {
      scale: form.value.roundingScale,
      mode: form.value.roundingMode,
    };
  }

  if (editingIndex.value === null) {
    props.graph.outputs.push(next);
  } else {
    props.graph.outputs.splice(editingIndex.value, 1, next);
  }

  dialogOpen.value = false;
  emit('dirty');
  ElMessage.success('已保存');
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

