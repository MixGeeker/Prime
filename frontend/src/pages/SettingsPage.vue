<template>
  <el-card>
    <template #header>设置</template>

    <el-form label-position="top" :model="form" class="form">
      <el-form-item label="主题（Theme）">
        <el-radio-group v-model="form.themeMode">
          <el-radio-button label="system">跟随系统</el-radio-button>
          <el-radio-button label="light">浅色</el-radio-button>
          <el-radio-button label="dark">深色</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="Studio 模式（输入来源）">
        <el-radio-group v-model="form.studioMode">
          <el-radio-button label="free">自由模式</el-radio-button>
          <el-radio-button label="business">业务模式（从 Provider 目录导入）</el-radio-button>
        </el-radio-group>
        <div class="muted" style="margin-top: 6px">
          自由模式允许手工定义 globals/params；业务模式建议从 Provider 的 Inputs Catalog 选择导入，减少手写 key 错误。
        </div>
      </el-form-item>

      <el-form-item label="后端 Base URL">
        <el-input v-model="form.backendBaseUrl" placeholder="http://localhost:4010" />
      </el-form-item>

      <el-form-item label="Provider Simulator Base URL（可选）">
        <el-input v-model="form.providerSimulatorBaseUrl" placeholder="http://localhost:4020" />
      </el-form-item>

      <el-form-item label="Admin Token（可选，仅用于危险端点：DLQ replay）">
        <el-input v-model="form.adminToken" placeholder="Bearer ..." show-password />
      </el-form-item>

      <div class="actions">
        <el-button type="primary" @click="save">保存</el-button>
        <el-button @click="reset">重置</el-button>
      </div>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();
const form = reactive({
  themeMode: settings.themeMode,
  studioMode: settings.studioMode,
  backendBaseUrl: settings.backendBaseUrl,
  providerSimulatorBaseUrl: settings.providerSimulatorBaseUrl,
  adminToken: settings.adminToken,
});

function save() {
  settings.themeMode = form.themeMode;
  settings.studioMode = form.studioMode;
  settings.backendBaseUrl = form.backendBaseUrl.trim();
  settings.providerSimulatorBaseUrl = form.providerSimulatorBaseUrl.trim();
  settings.adminToken = form.adminToken.trim();
  settings.persistToStorage();
  ElMessage.success('已保存');
}

function reset() {
  settings.resetToDefaults();
  form.themeMode = settings.themeMode;
  form.studioMode = settings.studioMode;
  form.backendBaseUrl = settings.backendBaseUrl;
  form.providerSimulatorBaseUrl = settings.providerSimulatorBaseUrl;
  form.adminToken = settings.adminToken;
  ElMessage.success('已重置');
}
</script>

<style scoped>
.form {
  max-width: 700px;
}
.actions {
  display: flex;
  gap: 10px;
}
.muted {
  opacity: 0.75;
}
</style>
