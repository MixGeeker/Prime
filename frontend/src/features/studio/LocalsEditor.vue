<template>
  <div>
    <div class="row" style="margin-bottom: 10px">
      <el-button type="primary" @click="openCreate">新增 local</el-button>
      <div class="muted">locals 是图内可变状态（用于循环/状态机），读写通过内置节点完成。</div>
    </div>

    <el-table :data="graph.locals" size="small" height="320px" stripe>
      <el-table-column prop="name" label="name" width="160" />
      <el-table-column prop="valueType" label="valueType" width="110" />
      <el-table-column label="default" min-width="200">
        <template #default="{ row }">
          <span class="mono muted">{{ formatDefault(row.default) }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="description" min-width="220" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ $index }">
          <el-button text @click="openEdit($index)">编辑</el-button>
          <el-button text type="danger" @click="removeAt($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogOpen" :title="editingIndex === null ? '新增 local' : '编辑 local'" width="640px">
      <el-form label-position="top" :model="form">
        <el-form-item label="name">
          <el-input v-model="form.name" placeholder="例如：acc" />
        </el-form-item>

        <el-form-item label="valueType">
          <el-select v-model="form.valueType" style="width: 100%">
            <el-option v-for="t in valueTypes" :key="t" :label="t" :value="t" />
          </el-select>
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
import type { GraphJsonV2, GraphLocalDef, ValueType } from '@/engine/types';

const props = defineProps<{ graph: GraphJsonV2 }>();
const emit = defineEmits<{ (e: 'dirty'): void }>();

const valueTypes: ValueType[] = ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'];

const dialogOpen = ref(false);
const editingIndex = ref<number | null>(null);
const defaultError = ref<string | null>(null);

const form = ref<{
  name: string;
  valueType: ValueType;
  defaultText: string;
  defaultBool: boolean;
  description: string;
}>({
  name: '',
  valueType: 'Decimal',
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
    defaultText: '',
    defaultBool: false,
    description: '',
  };
  dialogOpen.value = true;
}

function openEdit(index: number) {
  const item = props.graph.locals[index];
  if (!item) return;
  editingIndex.value = index;
  defaultError.value = null;
  form.value = {
    name: item.name,
    valueType: item.valueType,
    defaultText:
      item.valueType === 'Json' ? JSON.stringify(item.default ?? {}, null, 2) : String(item.default ?? ''),
    defaultBool: Boolean(item.default),
    description: item.description ?? '',
  };
  dialogOpen.value = true;
}

async function removeAt(index: number) {
  const item = props.graph.locals[index];
  if (!item) return;
  try {
    await ElMessageBox.confirm(`确认删除 local: ${item.name} ?`, '确认', { type: 'warning' });
    props.graph.locals.splice(index, 1);
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

  return text;
}

function save() {
  const name = form.value.name.trim();
  if (!name) {
    ElMessage.warning('name 不能为空');
    return;
  }

  const next: GraphLocalDef = {
    name,
    valueType: form.value.valueType,
  };

  const d = buildDefault();
  if (defaultError.value) return;
  if (typeof d !== 'undefined') next.default = d;

  const desc = form.value.description.trim();
  if (desc) next.description = desc;

  if (editingIndex.value === null) {
    props.graph.locals.push(next);
  } else {
    props.graph.locals.splice(editingIndex.value, 1, next);
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

