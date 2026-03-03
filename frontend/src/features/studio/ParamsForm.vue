<template>
  <div class="root">
    <div v-if="!schema" class="muted">该节点无 paramsSchema（不建议携带 params）。</div>

    <div v-else>
      <div class="toolbar">
        <el-switch v-model="advanced" active-text="高级(JSON)" inactive-text="表单" />
      </div>

      <div v-if="advanced">
        <el-input
          v-model="jsonText"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 20 }"
          placeholder="{ }"
          class="mono"
        />
        <div v-if="jsonError" class="error">{{ jsonError }}</div>
      </div>

      <div v-else>
        <el-form label-position="top" class="form">
          <template v-for="field in fields" :key="field.key">
            <el-form-item :label="field.label" :required="field.required">
              <el-select
                v-if="field.enum && field.type === 'string'"
                :model-value="getValue(field.key) as any"
                placeholder="请选择"
                filterable
                clearable
                @update:model-value="setValue(field.key, $event)"
              >
                <el-option v-for="opt in field.enum" :key="opt" :value="opt" :label="opt" />
              </el-select>

              <el-switch
                v-else-if="field.type === 'boolean'"
                :model-value="Boolean(getValue(field.key))"
                @update:model-value="setValue(field.key, $event)"
              />

              <el-input-number
                v-else-if="field.type === 'number' || field.type === 'integer'"
                :model-value="(getValue(field.key) as any) ?? null"
                :step="field.type === 'integer' ? 1 : 0.01"
                :precision="field.type === 'integer' ? 0 : undefined"
                controls-position="right"
                style="width: 100%"
                @update:model-value="setValue(field.key, $event)"
              />

              <el-input
                v-else
                :model-value="(getValue(field.key) as any) ?? ''"
                :placeholder="field.placeholder"
                @update:model-value="setValue(field.key, $event)"
              />

              <div v-if="field.description" class="desc">{{ field.description }}</div>
            </el-form-item>
          </template>
        </el-form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';

type JsonSchema = Record<string, any>;

const props = defineProps<{
  schema?: JsonSchema | null;
  modelValue: Record<string, unknown> | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: Record<string, unknown> | null): void;
}>();

const advanced = ref(false);
const jsonError = ref<string | null>(null);

type Field = {
  key: string;
  label: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'unknown';
  enum?: string[];
  required: boolean;
  description?: string;
  placeholder?: string;
};

const fields = computed<Field[]>(() => {
  const s = props.schema;
  if (!s || s.type !== 'object') return [];
  const propsObj = s.properties && typeof s.properties === 'object' ? s.properties : {};
  const requiredList = Array.isArray(s.required) ? (s.required as string[]) : [];

  const result: Field[] = [];
  for (const key of Object.keys(propsObj)) {
    const def = propsObj[key] ?? {};
    const type = (def.type as Field['type']) ?? 'unknown';
    const field: Field = {
      key,
      label: typeof def.title === 'string' ? def.title : key,
      type,
      required: requiredList.includes(key),
      description: typeof def.description === 'string' ? def.description : undefined,
      placeholder: typeof def.default !== 'undefined' ? String(def.default) : undefined,
    };
    if (Array.isArray(def.enum) && def.enum.every((v: any) => typeof v === 'string')) {
      field.enum = def.enum as string[];
    }
    result.push(field);
  }
  return result;
});

function getValue(key: string): unknown {
  return props.modelValue ? props.modelValue[key] : undefined;
}

function setValue(key: string, value: unknown) {
  const next = { ...(props.modelValue ?? {}) };
  if (value === '' || typeof value === 'undefined') {
    delete next[key];
  } else {
    next[key] = value as any;
  }
  emit('update:modelValue', next);
}

const jsonText = computed({
  get() {
    return JSON.stringify(props.modelValue ?? {}, null, 2);
  },
  set(v: string) {
    try {
      jsonError.value = null;
      const parsed = JSON.parse(v) as unknown;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        jsonError.value = 'params 必须是 object';
        return;
      }
      emit('update:modelValue', parsed as Record<string, unknown>);
    } catch (e) {
      jsonError.value = `JSON 解析失败：${String(e)}`;
    }
  },
});

watch(
  () => props.modelValue,
  () => {
    jsonError.value = null;
  },
  { deep: true },
);
</script>

<style scoped>
.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}
.muted {
  opacity: 0.75;
}
.desc {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.75;
}
.error {
  margin-top: 8px;
  font-size: 12px;
  color: var(--el-color-danger);
}
.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
</style>
