<template>
  <el-container class="app">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <div class="title">Prime Engine</div>
        <div class="subtitle">Studio / Ops</div>
      </div>

      <el-menu :default-active="activePath" router class="menu">
        <el-menu-item index="/studio">Studio</el-menu-item>
        <el-menu-item index="/ops">Ops</el-menu-item>
        <el-menu-item index="/settings">设置</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">{{ pageTitle }}</div>
        <div class="header-right">
          <small class="muted">后端：{{ settings.backendBaseUrl }}</small>
        </div>
      </el-header>

      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSettingsStore } from './stores/settings';

const route = useRoute();
const settings = useSettingsStore();

const activePath = computed(() => route.path);
const pageTitle = computed(() => {
  if (route.path.startsWith('/studio')) return 'Studio（蓝图编辑器）';
  if (route.path.startsWith('/ops')) return 'Ops（仪表盘）';
  if (route.path.startsWith('/settings')) return '设置';
  return 'Prime Engine';
});
</script>

<style scoped>
.app {
  height: 100%;
}

.aside {
  background: #0f1733;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.9);
}

.brand {
  padding: 16px 14px;
}

.title {
  font-weight: 700;
  font-size: 16px;
  line-height: 18px;
}

.subtitle {
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.7;
}

.menu {
  border-right: none;
  background: transparent;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(15, 23, 51, 0.6);
  backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.92);
}

.header-left {
  font-weight: 600;
}

.muted {
  opacity: 0.75;
}

.main {
  padding: 16px;
  background: radial-gradient(1200px 800px at 10% 0%, rgba(80, 110, 255, 0.22), transparent 60%),
    radial-gradient(800px 600px at 80% 10%, rgba(255, 140, 0, 0.12), transparent 55%),
    #0b1020;
}
</style>

