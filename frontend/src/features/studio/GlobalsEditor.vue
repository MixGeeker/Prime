<template>
  <div>
    <div class="row" style="margin-bottom: 10px">
      <el-button type="primary" @click="openCreate">新增 global</el-button>
      <div class="muted">声明哪些 `inputs.globals.*` 字段可在图内读取（强类型校验 + inputsHash 来源）。</div>
    </div>

    <el-table :data="graph.globals" size="small" height="320px" stripe>
      <el-table-column prop="name" label="name" width="160" />
      <el-table-column prop="valueType" label="valueType" width="110" />
      <el-table-column label="required" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.required" type="success">true</el-tag>
          <el-tag v-else type="info">false</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="default" min-width="180">
        <template #default="{ row }">
          <span class="mono muted">{{ formatDefault(row.default) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="description" min-width="200" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ $index }">
          <el-button text @click="openEdit($index)">编辑</el-button>
          <el-button text type="danger" @click="removeAt($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogOpen" :title="editingIndex === null ? '新增 global' : '编辑 global'" width="640px">
      <el-form label-position="top" :model="form">
        <el-form-item label="name">
          <el-input v-model="form.name" placeholder="例如：fxRate" />
        </el-form-item>

        <el-form-item label="valueType">
          <el-select v-model="form.valueType" style="width: 100%">
            <el-option v-for="t in valueTypes" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>

        <el-form-item label="required">
          <el-switch v-model="form.required" />
        </el-form-item>

        <el-form-item label="default（可选）">
          <template v-if="form.valueType === 'Boolean'">
            <el-switch v-model="form.defaultBool" />
          </template>
          <template v-else-if="form.valueType === 'Json'">
            <el-input v-model="form.defaultText" type="textarea" :autosize="{ minRows: 4, maxRows: 10 }" class="mono" />
            <div v-if="defaultError" class="err">{{ defaultError }}</div>
          </template>
          <template v-else>
            <el-input v-model="form.defaultText" placeholder="留空表示不设置 default" />
          </template>
        </el-form-item>

        <el-form-item label="description（可选）">
          <el-input v-model="form.description" placeholder="说明/提示信息" />
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
import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { GraphInputDef, GraphJsonV1, ValueType } from '@/engine/types';

const props = defineProps<{ graph: GraphJsonV1 }>();
const emit = defineEmits<{ (e: 'dirty'): void }>();

const valueTypes: ValueType[] = ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'];

const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);
const defaultError = ref<string | null>(null);

const form = ref<{
  name: string;
  valueType: ValueType;
  required: boolean;
  defaultText: string;
  defaultBool: boolean;
  description: string;
}>({
  name: '',
  valueType: 'Decimal',
  required: true,
  defaultText: '',
  defaultBool: false,
  description: '',
});

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

function openCreate() {
  editingIndex.value = null;
  defaultError.value = null;
  form.value = {
    name: '',
    valueType: 'Decimal',
    required: true,
    defaultText: '',
    defaultBool: false,
    description: '',
  };
  dialogOpen.value = true;
}

function openEdit(index: number) {
  const item = props.graph.globals[index];
  if (!item) return;
  editingIndex.value = index;
  defaultError.value = null;
  form.value = {
    name: item.name,
    valueType: item.valueType,
    required: Boolean(item.required),
    defaultText:
      item.valueType === 'Json' ? JSON.stringify(item.default ?? {}, null, 2) : String(item.default ?? ''),
    defaultBool: Boolean(item.default),
    description: item.description ?? '',
  };
  dialogOpen.value = true;
}

async function removeAt(index: number) {
  const item = props.graph.globals[index];
  if (!item) return;
  try {
    await ElMessageBox.confirm(`确认删除 global: ${item.name} ?`, '确认', { type: 'warning' });
    props.graph.globals.splice(index, 1);
    emit('dirty');
    ElMessage.success('已删除');
  } catch {
    // cancel
  }
}

function buildDefault(): unknown | undefined {
  defaultError.value = null;

  if (form.value.valueType === 'Boolean') {
    return form.value.defaultBool;
  }

  const text = form.value.defaultText.trim();
  if (!text) return undefined;

  if (form.value.valueType === 'Json') {
    try {
      return JSON.parse(text);
    } catch (e) {
      defaultError.value = `default JSON 解析失败：${String(e)}`;
      return undefined;
    }
  }

  // Decimal/Ratio/String/DateTime：统一按 string 存
  return text;
}

function save() {
  const name = form.value.name.trim();
  if (!name) {
    ElMessage.warning('name 不能为空');
    return;
  }

  const next: GraphInputDef = {
    name,
    valueType: form.value.valueType,
    required: Boolean(form.value.required),
  };

  const d = buildDefault();
  if (defaultError.value) return;
  if (typeof d !== 'undefined') next.default = d;

  const desc = form.value.description.trim();
  if (desc) next.description = desc;

  if (editingIndex.value === null) {
    props.graph.globals.push(next);
  } else {
    props.graph.globals.splice(editingIndex.value, 1, next);
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
</style>

