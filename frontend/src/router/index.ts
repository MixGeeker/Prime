import { createRouter, createWebHistory } from 'vue-router';
import StudioPage from '@/pages/StudioPage.vue';
import OpsPage from '@/pages/OpsPage.vue';
import SettingsPage from '@/pages/SettingsPage.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/studio' },
    { path: '/studio', component: StudioPage },
    { path: '/ops', component: OpsPage },
    { path: '/settings', component: SettingsPage },
  ],
});

