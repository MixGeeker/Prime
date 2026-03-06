import { defineStore } from 'pinia';

export type ThemeMode = 'system' | 'light' | 'dark';

type SettingsStorage = {
  backendBaseUrl: string;
  adminToken: string;
  themeMode: ThemeMode;
};

const STORAGE_KEY = 'prime_engine_settings_v1';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function defaultSettings(): SettingsStorage {
  return {
    backendBaseUrl: import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:4010',
    adminToken: import.meta.env.VITE_ADMIN_TOKEN || '',
    themeMode: 'system',
  };
}

export const useSettingsStore = defineStore('settings', {
  state: () => defaultSettings(),
  actions: {
    hydrateFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<SettingsStorage>;
        if (typeof parsed.backendBaseUrl === 'string') {
          this.backendBaseUrl = parsed.backendBaseUrl;
        }
        if (typeof parsed.adminToken === 'string') {
          this.adminToken = parsed.adminToken;
        }
        if (isThemeMode(parsed.themeMode)) {
          this.themeMode = parsed.themeMode;
        }
      } catch {
        // ignore
      }
    },
    persistToStorage() {
      const payload: SettingsStorage = {
        backendBaseUrl: this.backendBaseUrl,
        adminToken: this.adminToken,
        themeMode: this.themeMode,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    resetToDefaults() {
      const defaults = defaultSettings();
      this.backendBaseUrl = defaults.backendBaseUrl;
      this.adminToken = defaults.adminToken;
      this.themeMode = defaults.themeMode;
      this.persistToStorage();
    },
  },
});
