<template>
  <button class="btn" @pointerdown.stop="" @click="data.onClick">
    {{ data.label }}
  </button>
</template>

<script setup lang="ts">
defineProps<{
  data: {
    label: string;
    onClick: () => void;
  };
}>();
</script>

<style scoped>
.btn {
  width: calc(100% - 16px);
  margin: 4px 8px;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  background: var(--el-fill-color-dark);
  color: var(--el-text-color-regular);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  transition: background 0.1s, color 0.1s;
}

.btn:hover {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
</style>

