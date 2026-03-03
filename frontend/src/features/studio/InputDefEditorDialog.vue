<template>
  <el-dialog v-model="open" :title="title" width="640px">
    <el-form label-position="top" :model="form">
      <el-form-item label="name">
        <el-input v-model="form.name" placeholder="例如：fxRate" :disabled="disableName" />
      </el-form-item>

      <el-form-item label="valueType">
        <el-select v-model="form.valueType" style="width: 100%" :disabled="disableType">
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
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import type { GraphInputDef, ValueType } from '@/engine/types';

const props = defineProps<{
  modelValue: boolean;
  title: string;
  value?: GraphInputDef | null;
  disableName?: boolean;
  disableType?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'save', value: GraphInputDef): void;
}>();

const valueTypes: ValueType[] = ['Decimal', 'Ratio', 'String', 'Boolean', 'DateTime', 'Json'];

const open = computed({
  get() {
    return props.modelValue;
  },
  set(v: boolean) {
    emit('update:modelValue', v);
  },
});

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

  emit('save', next);
  open.value = false;
}

watch(
  () => props.value,
  (v) => {
    defaultError.value = null;
    if (!v) {
      form.value = {
        name: '',
        valueType: 'Decimal',
        required: true,
        defaultText: '',
        defaultBool: false,
        description: '',
      };
      return;
    }
    form.value = {
      name: v.name,
      valueType: v.valueType,
      required: Boolean(v.required),
      defaultText: v.valueType === 'Json' ? JSON.stringify(v.default ?? {}, null, 2) : String(v.default ?? ''),
      defaultBool: Boolean(v.default),
      description: v.description ?? '',
    };
  },
  { immediate: true },
);
</script>

<style scoped>
.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
.err {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>

