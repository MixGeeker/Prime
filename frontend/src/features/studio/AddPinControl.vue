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
  width: 100%;
  border: 1px dashed rgba(255, 255, 255, 0.35);
  border-radius: 8px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  cursor: pointer;
  font-size: 12px;
  line-height: 16px;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.55);
}
</style>

