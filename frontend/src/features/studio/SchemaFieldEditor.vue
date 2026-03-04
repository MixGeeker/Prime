<template>
  <div class="root">
    <template v-if="isObjectWithProperties">
      <div class="group">
        <div class="group-head">
          <div class="group-title">
            <span>{{ label }}</span>
            <span v-if="required" class="req">*</span>
          </div>
        </div>
        <div v-if="description" class="desc">{{ description }}</div>

        <div class="group-body">
          <SchemaFieldEditor
            v-for="child in objectFields"
            :key="child.key"
            :schema="child.schema"
            :label="child.label"
            :required="child.required"
            :description="child.description"
            :root="root"
            :path="[...path, child.key]"
            @update:root="(v) => emit('update:root', v)"
          />
        </div>
      </div>
    </template>

    <template v-else-if="isArrayOfObjects">
      <div class="group">
        <div class="group-head">
          <div class="group-title">
            <span>{{ label }}</span>
            <span v-if="required" class="req">*</span>
          </div>
          <el-button text type="primary" @click="addItem">+ 添加</el-button>
        </div>
        <div v-if="description" class="desc">{{ description }}</div>

        <div v-if="items.length === 0" class="muted">暂无条目。</div>

        <div v-for="(_, idx) in items" :key="idx" class="item">
          <div class="item-head">
            <div class="muted">#{{ idx + 1 }}</div>
            <el-button text type="danger" @click="removeItem(idx)">删除</el-button>
          </div>
          <div class="item-body">
            <SchemaFieldEditor
              v-for="child in arrayItemFields"
              :key="child.key"
              :schema="child.schema"
              :label="child.label"
              :required="child.required"
              :description="child.description"
              :root="root"
              :path="[...path, idx, child.key]"
              @update:root="(v) => emit('update:root', v)"
            />
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <el-form-item :label="label" :required="required">
        <el-select
          v-if="leafKind === 'string_enum'"
          :model-value="value as any"
          placeholder="请选择"
          filterable
          clearable
          style="width: 100%"
          @update:model-value="updateValue"
        >
          <el-option v-for="opt in enumValues" :key="opt" :value="opt" :label="opt" />
        </el-select>

        <el-switch
          v-else-if="leafKind === 'boolean'"
          :model-value="Boolean(value)"
          @update:model-value="updateValue"
        />

        <el-input-number
          v-else-if="leafKind === 'number' || leafKind === 'integer'"
          :model-value="(value as any) ?? null"
          :step="leafKind === 'integer' ? 1 : 0.01"
          :precision="leafKind === 'integer' ? 0 : undefined"
          controls-position="right"
          style="width: 100%"
          @update:model-value="updateValue"
        />

        <el-input
          v-else-if="leafKind === 'json_textarea'"
          :model-value="jsonText"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 8 }"
          placeholder='可输入 JSON（例如：true / 123 / {"a":1}），或直接输入字符串'
          class="mono"
          @update:model-value="updateJsonText"
        />

        <el-input
          v-else
          :model-value="(value as any) ?? ''"
          :placeholder="placeholder"
          style="width: 100%"
          @update:model-value="updateValue"
        />

        <div v-if="description" class="desc">{{ description }}</div>
      </el-form-item>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

defineOptions({ name: 'SchemaFieldEditor' });

type JsonSchema = Record<string, any>;
type PathPart = string | number;

const props = defineProps<{
  schema: JsonSchema;
  label: string;
  required: boolean;
  description?: string;
  root: Record<string, unknown>;
  path: PathPart[];
}>();

const emit = defineEmits<{
  (e: 'update:root', value: Record<string, unknown>): void;
}>();

function cloneJson<T>(v: T): T {
  // params 约束为 JSON，可安全使用该策略；Proxy（Vue 响应式对象）会导致 structuredClone 抛错，需回退。
  const cloneFn = (globalThis as any).structuredClone;
  if (typeof cloneFn === 'function') {
    try {
      return cloneFn(v) as T;
    } catch {
      // fallback to JSON clone below
    }
  }
  return JSON.parse(JSON.stringify(v)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function getAtPath(root: any, path: PathPart[]): any {
  let cur = root;
  for (const p of path) {
    if (cur === null || typeof cur === 'undefined') return undefined;
    cur = cur[p as any];
  }
  return cur;
}

function ensureContainer(parent: any, key: PathPart, nextKey: PathPart) {
  const wantArray = typeof nextKey === 'number';
  if (typeof key === 'number') {
    if (!Array.isArray(parent)) return;
    if (parent[key] === undefined || parent[key] === null) {
      parent[key] = wantArray ? [] : {};
    }
    return;
  }
  if (!isPlainObject(parent) && !Array.isArray(parent)) return;
  const existing = (parent as any)[key];
  if (existing === undefined || existing === null) {
    (parent as any)[key] = wantArray ? [] : {};
  }
}

function setAtPath(root: Record<string, unknown>, path: PathPart[], nextValue: unknown): Record<string, unknown> {
  const next = cloneJson(root ?? {});
  if (path.length === 0) return next;

  let cur: any = next;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    const nextKey = path[i + 1]!;
    ensureContainer(cur, key, nextKey);
    cur = cur[key as any];
  }
  const last = path[path.length - 1]!;
  if (typeof last === 'string' && (nextValue === '' || typeof nextValue === 'undefined')) {
    delete cur[last];
  } else {
    cur[last as any] = nextValue as any;
  }
  return next;
}

type FieldInfo = {
  key: string;
  label: string;
  required: boolean;
  description?: string;
  schema: JsonSchema;
};

const isObjectWithProperties = computed(() => {
  return props.schema?.type === 'object' && props.schema?.properties && typeof props.schema.properties === 'object';
});

const objectFields = computed<FieldInfo[]>(() => {
  if (!isObjectWithProperties.value) return [];
  const propsObj = props.schema.properties as Record<string, JsonSchema>;
  const requiredList = Array.isArray(props.schema.required) ? (props.schema.required as string[]) : [];
  return Object.keys(propsObj).map((key) => {
    const s = propsObj[key] ?? {};
    return {
      key,
      label: typeof s.title === 'string' ? s.title : key,
      required: requiredList.includes(key),
      description: typeof s.description === 'string' ? s.description : undefined,
      schema: s,
    };
  });
});

const isArrayOfObjects = computed(() => {
  return props.schema?.type === 'array' && props.schema?.items?.type === 'object' && props.schema.items?.properties;
});

const arrayItemFields = computed<FieldInfo[]>(() => {
  if (!isArrayOfObjects.value) return [];
  const itemSchema = props.schema.items as JsonSchema;
  const propsObj = (itemSchema.properties ?? {}) as Record<string, JsonSchema>;
  const requiredList = Array.isArray(itemSchema.required) ? (itemSchema.required as string[]) : [];
  return Object.keys(propsObj).map((key) => {
    const s = propsObj[key] ?? {};
    return {
      key,
      label: typeof s.title === 'string' ? s.title : key,
      required: requiredList.includes(key),
      description: typeof s.description === 'string' ? s.description : undefined,
      schema: s,
    };
  });
});

const items = computed<any[]>(() => {
  const v = getAtPath(props.root, props.path);
  return Array.isArray(v) ? v : [];
});

const placeholder = computed(() => {
  if (typeof props.schema?.default !== 'undefined') return String(props.schema.default);
  return undefined;
});

const enumValues = computed<string[]>(() => {
  const e = props.schema?.enum;
  if (!Array.isArray(e) || !e.every((v) => typeof v === 'string')) return [];
  return e as string[];
});

const value = computed(() => getAtPath(props.root, props.path));

type LeafKind = 'string' | 'string_enum' | 'number' | 'integer' | 'boolean' | 'json_textarea';

const leafKind = computed<LeafKind>(() => {
  const t = props.schema?.type;
  if (t === 'string' && enumValues.value.length > 0) return 'string_enum';
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'integer') return 'integer';
  if (t === 'boolean') return 'boolean';
  if (t === 'array' || t === 'object' || typeof t !== 'string') return 'json_textarea';
  return 'json_textarea';
});

const jsonText = computed(() => {
  const v = value.value;
  if (typeof v === 'string') return v;
  if (typeof v === 'undefined') return '';
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
});

function updateValue(v: unknown) {
  emit('update:root', setAtPath(props.root, props.path, v));
}

function updateJsonText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    emit('update:root', setAtPath(props.root, props.path, undefined));
    return;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    emit('update:root', setAtPath(props.root, props.path, parsed));
  } catch {
    emit('update:root', setAtPath(props.root, props.path, text));
  }
}

function buildDefaultValue(schema: JsonSchema): unknown {
  if (typeof schema?.default !== 'undefined') return schema.default;
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) return schema.enum[0];
  switch (schema?.type) {
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

function uniqueName(existing: string[], prefix = 'pin'): string {
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const name = `${prefix}${i}`;
    if (!existing.includes(name)) return name;
    i++;
  }
}

function buildDefaultObject(itemSchema: JsonSchema, existingItems: any[]): Record<string, unknown> {
  const propsObj = (itemSchema.properties ?? {}) as Record<string, JsonSchema>;
  const requiredList = Array.isArray(itemSchema.required) ? (itemSchema.required as string[]) : [];

  const existingNames = existingItems
    .map((it) => (isPlainObject(it) && typeof it.name === 'string' ? it.name : null))
    .filter((v): v is string => Boolean(v));

  const obj: Record<string, unknown> = {};
  for (const key of requiredList) {
    if (key === 'name') {
      obj[key] = uniqueName(existingNames);
      continue;
    }
    obj[key] = buildDefaultValue(propsObj[key] ?? {});
  }
  return obj;
}

function addItem() {
  if (!isArrayOfObjects.value) return;
  const next = cloneJson(props.root ?? {});
  const current = getAtPath(next as any, props.path);
  if (!Array.isArray(current)) {
    // 创建数组容器
    const nextRoot = setAtPath(next as any, props.path, []);
    const arr = getAtPath(nextRoot as any, props.path) as any[];
    const itemSchema = props.schema.items as JsonSchema;
    arr.push(buildDefaultObject(itemSchema, arr));
    emit('update:root', nextRoot);
    return;
  }
  const itemSchema = props.schema.items as JsonSchema;
  current.push(buildDefaultObject(itemSchema, current));
  emit('update:root', next);
}

function removeItem(index: number) {
  const next = cloneJson(props.root ?? {});
  const current = getAtPath(next as any, props.path);
  if (!Array.isArray(current)) return;
  current.splice(index, 1);
  emit('update:root', next);
}
</script>

<style scoped>
.group {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 10px;
  background: var(--el-fill-color-light);
  margin-bottom: 10px;
}

.group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.group-title {
  font-weight: 600;
}

.req {
  color: var(--el-color-danger);
  margin-left: 4px;
}

.group-body {
  margin-top: 8px;
}

.item {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
  padding: 10px;
  background: var(--el-bg-color);
  margin-top: 10px;
}

.item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.muted {
  opacity: 0.75;
}

.desc {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.75;
}

.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}
</style>

