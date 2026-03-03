<template>
  <div>
    <div class="row" style="margin-bottom: 10px">
      <el-button type="primary" @click="openCreate">新增 output</el-button>
      <div class="muted">
        outputs 声明会参与 outputsHash，并可选择 rounding；实际输出必须由 `outputs.set.*` 节点写入。
      </div>
    </div>

    <el-alert
      v-if="graph.outputs.length === 0"
      type="info"
      show-icon
      title="还没有 outputs 声明"
      description="建议先声明 outputs（key/valueType/rounding），然后为每个 output 插入一个 `outputs.set.*` 节点并接入控制流。"
      style="margin-bottom: 10px"
    />

    <el-table :data="graph.outputs" size="small" height="320px" stripe>
      <el-table-column prop="key" label="key" width="180" />
      <el-table-column prop="valueType" label="valueType" width="110" />
      <el-table-column label="set 节点" min-width="220">
        <template #default="{ row }">
          <template v-if="(setStatsByKey.get(row.key)?.okCount ?? 0) > 0">
            <el-tag size="small" type="success" effect="plain">
              已设置 × {{ setStatsByKey.get(row.key)?.okCount }}
            </el-tag>
          </template>
          <template v-else>
            <el-tag size="small" type="warning" effect="plain">未设置</el-tag>
          </template>

          <span
            v-if="(setStatsByKey.get(row.key)?.mismatchCount ?? 0) > 0"
            class="muted"
            style="margin-left: 8px"
          >
            （类型不匹配 × {{ setStatsByKey.get(row.key)?.mismatchCount }}）
          </span>
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
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ $index }">
          <el-button text @click="openEdit($index)">编辑</el-button>
          <el-button text type="primary" @click="insertSetNode($index)">插入设置节点</el-button>
          <el-button text type="danger" @click="removeAt($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogOpen" :title="editingIndex === null ? '新增 output' : '编辑 output'" width="720px">
      <el-form label-position="top" :model="form">
        <el-form-item label="key">
          <el-input v-model="form.key" placeholder="例如：selling_price" />
        </el-form-item>

        <el-form-item label="valueType">
          <el-select v-model="form.valueType" style="width: 100%">
            <el-option v-for="t in valueTypes" :key="t" :label="t" :value="t" />
          </el-select>
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

        <el-form-item label="自动插入 outputs.set 节点（推荐）">
          <el-switch v-model="form.autoInsertSetNode" active-text="启用" inactive-text="关闭" />
          <div class="muted" style="margin-top: 6px">
            会把 `outputs.set.&lt;type&gt;` 插入到 `flow.return` 前（串联到控制流），你只需再把 value 连到它的 value 输入即可。
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
import type { GraphJsonV1, GraphNode, RoundingMode, ValueType } from '@/engine/types';

const props = defineProps<{ graph: GraphJsonV1 }>();
const emit = defineEmits<{
  (e: 'dirty'): void;
  (e: 'insert-set-node', payload: { key: string; valueType: ValueType }): void;
}>();

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

const valueTypes: ValueType[] = ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'];

function getStringParam(node: GraphNode, key: string): string | null {
  const v = node.params?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function valueTypeToOutputsSetNodeType(vt: ValueType): string {
  switch (vt) {
    case 'Decimal':
      return 'outputs.set.decimal';
    case 'Ratio':
      return 'outputs.set.ratio';
    case 'String':
      return 'outputs.set.string';
    case 'Boolean':
      return 'outputs.set.boolean';
    case 'DateTime':
      return 'outputs.set.datetime';
    case 'Json':
      return 'outputs.set.json';
    default: {
      const _exhaustive: never = vt;
      return String(_exhaustive);
    }
  }
}

type SetStats = { okCount: number; mismatchCount: number };

const setStatsByKey = computed<Map<string, SetStats>>(() => {
  const map = new Map<string, SetStats>();

  for (const out of props.graph.outputs) {
    const expectedType = valueTypeToOutputsSetNodeType(out.valueType);
    let okCount = 0;
    let mismatchCount = 0;

    for (const n of props.graph.nodes) {
      if (!String(n.nodeType).startsWith('outputs.set.')) continue;
      const key = getStringParam(n, 'key');
      if (!key || key !== out.key) continue;
      if (n.nodeType === expectedType) okCount++;
      else mismatchCount++;
    }

    map.set(out.key, { okCount, mismatchCount });
  }

  return map;
});

function hasExpectedSetNode(key: string, vt: ValueType): boolean {
  const expectedType = valueTypeToOutputsSetNodeType(vt);
  return props.graph.nodes.some((n) => n.nodeType === expectedType && getStringParam(n, 'key') === key);
}

const form = ref<{
  key: string;
  valueType: ValueType;
  roundingEnabled: boolean;
  roundingScale: number;
  roundingMode: RoundingMode;
  autoInsertSetNode: boolean;
}>({
  key: '',
  valueType: 'Decimal',
  roundingEnabled: false,
  roundingScale: 2,
  roundingMode: 'HALF_UP',
  autoInsertSetNode: true,
});

const canRounding = computed(() => {
  const vt = form.value.valueType;
  return vt === 'Decimal' || vt === 'Ratio';
});

function openCreate() {
  editingIndex.value = null;
  form.value = {
    key: '',
    valueType: 'Decimal',
    roundingEnabled: false,
    roundingScale: 2,
    roundingMode: 'HALF_UP',
    autoInsertSetNode: true,
  };
  dialogOpen.value = true;
}

function openEdit(index: number) {
  const item = props.graph.outputs[index];
  if (!item) return;
  editingIndex.value = index;
  form.value = {
    key: item.key,
    valueType: item.valueType,
    roundingEnabled: Boolean(item.rounding),
    roundingScale: item.rounding?.scale ?? 2,
    roundingMode: item.rounding?.mode ?? 'HALF_UP',
    autoInsertSetNode: false,
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

function insertSetNode(index: number) {
  const item = props.graph.outputs[index];
  if (!item) return;
  emit('insert-set-node', { key: item.key, valueType: item.valueType });
}

function save() {
  const key = form.value.key.trim();
  if (!key) {
    ElMessage.warning('key 不能为空');
    return;
  }
  const valueType = form.value.valueType;
  const next = {
    key,
    valueType,
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

  if (form.value.autoInsertSetNode && !hasExpectedSetNode(key, valueType)) {
    emit('insert-set-node', { key, valueType });
  }
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
</style>
