import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

import App from './App.vue';
import { router } from './router';
import { useSettingsStore } from './stores/settings';
import './styles/global.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus);

// 读取本地持久化配置（baseUrl/token 等）
useSettingsStore().hydrateFromStorage();

app.mount('#app');

