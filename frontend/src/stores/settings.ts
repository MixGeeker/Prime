import { defineStore } from 'pinia';

export type ThemeMode = 'system' | 'light' | 'dark';
export type StudioMode = 'free' | 'business';

type SettingsStorage = {
  backendBaseUrl: string;
  providerSimulatorBaseUrl: string;
  adminToken: string;
  themeMode: ThemeMode;
  studioMode: StudioMode;
};

const STORAGE_KEY = 'prime_engine_settings_v1';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function isStudioMode(value: unknown): value is StudioMode {
  return value === 'free' || value === 'business';
}

function defaultSettings(): SettingsStorage {
  return {
    backendBaseUrl: import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:4010',
    providerSimulatorBaseUrl:
      import.meta.env.VITE_PROVIDER_SIMULATOR_BASE_URL || 'http://localhost:4020',
    adminToken: import.meta.env.VITE_ADMIN_TOKEN || '',
    themeMode: 'system',
    studioMode: 'free',
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
        if (typeof parsed.backendBaseUrl === 'string') this.backendBaseUrl = parsed.backendBaseUrl;
        if (typeof parsed.providerSimulatorBaseUrl === 'string')
          this.providerSimulatorBaseUrl = parsed.providerSimulatorBaseUrl;
        if (typeof parsed.adminToken === 'string') this.adminToken = parsed.adminToken;
        if (isThemeMode(parsed.themeMode)) this.themeMode = parsed.themeMode;
        if (isStudioMode((parsed as any).studioMode)) this.studioMode = (parsed as any).studioMode;
      } catch {
        // ignore
      }
    },
    persistToStorage() {
      const payload: SettingsStorage = {
        backendBaseUrl: this.backendBaseUrl,
        providerSimulatorBaseUrl: this.providerSimulatorBaseUrl,
        adminToken: this.adminToken,
        themeMode: this.themeMode,
        studioMode: this.studioMode,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    resetToDefaults() {
      const defaults = defaultSettings();
      this.backendBaseUrl = defaults.backendBaseUrl;
      this.providerSimulatorBaseUrl = defaults.providerSimulatorBaseUrl;
      this.adminToken = defaults.adminToken;
      this.themeMode = defaults.themeMode;
      this.studioMode = defaults.studioMode;
      this.persistToStorage();
    },
  },
});
