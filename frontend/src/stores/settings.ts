import { defineStore } from 'pinia';

type SettingsStorage = {
  backendBaseUrl: string;
  providerSimulatorBaseUrl: string;
  adminToken: string;
};

const STORAGE_KEY = 'prime_engine_settings_v1';

function defaultSettings(): SettingsStorage {
  return {
    backendBaseUrl: import.meta.env.VITE_BACKEND_BASE_URL || 'http://localhost:4010',
    providerSimulatorBaseUrl:
      import.meta.env.VITE_PROVIDER_SIMULATOR_BASE_URL || 'http://localhost:4020',
    adminToken: import.meta.env.VITE_ADMIN_TOKEN || '',
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
      } catch {
        // ignore
      }
    },
    persistToStorage() {
      const payload: SettingsStorage = {
        backendBaseUrl: this.backendBaseUrl,
        providerSimulatorBaseUrl: this.providerSimulatorBaseUrl,
        adminToken: this.adminToken,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    },
    resetToDefaults() {
      const defaults = defaultSettings();
      this.backendBaseUrl = defaults.backendBaseUrl;
      this.providerSimulatorBaseUrl = defaults.providerSimulatorBaseUrl;
      this.adminToken = defaults.adminToken;
      this.persistToStorage();
    },
  },
});

