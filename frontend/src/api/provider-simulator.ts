import axios, { type AxiosRequestConfig } from 'axios';
import { useSettingsStore } from '@/stores/settings';
import type { InputsCatalogV2 } from '@/engine/types';

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const settings = useSettingsStore();
  const res = await axios.request<T>({
    baseURL: settings.providerSimulatorBaseUrl,
    timeout: 20_000,
    ...config,
  });
  return res.data;
}

export const providerSimulatorApi = {
  health(): Promise<{ ok: boolean; mqConnected: boolean; storageUpdatedAt: string }> {
    return request({ method: 'GET', url: '/health' });
  },

  getInputsCatalog(): Promise<InputsCatalogV2> {
    return request({ method: 'GET', url: '/catalog/inputs' });
  },

  getGlobalFacts(): Promise<Record<string, unknown>> {
    return request({ method: 'GET', url: '/facts/global' });
  },

  setGlobalFacts(body: Record<string, unknown>): Promise<{ ok: true }> {
    return request({ method: 'PUT', url: '/facts/global', data: body });
  },

  listJobs(limit = 50): Promise<{ items: any[] }> {
    return request({ method: 'GET', url: '/jobs', params: { limit } });
  },

  getJob(jobId: string): Promise<any> {
    return request({ method: 'GET', url: `/jobs/${jobId}` });
  },

  triggerJob(body: {
    jobId?: string;
    correlationId?: string;
    definitionRef: { definitionId: string; definitionHash: string };
    entrypointKey?: string;
    inputs?: Record<string, unknown>;
    options?: Record<string, unknown>;
    mergeGlobalFacts?: boolean;
  }): Promise<{ ok: true; jobId: string }> {
    return request({ method: 'POST', url: '/jobs', data: body });
  },
};
