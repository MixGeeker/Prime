import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';

import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import './styles/global.css';
import { applyTheme } from './styles/theme';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus);

// 读取本地持久化配置（baseUrl/token 等）
const settings = useSettingsStore();
settings.hydrateFromStorage();
applyTheme(settings.themeMode);
let lastThemeMode = settings.themeMode;
settings.$subscribe((_mutation, state) => {
  if (state.themeMode === lastThemeMode) return;
  lastThemeMode = state.themeMode;
  applyTheme(state.themeMode);
});

app.mount('#app');
