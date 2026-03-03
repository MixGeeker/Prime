import axios, { type AxiosRequestConfig } from 'axios';
import { useSettingsStore } from '@/stores/settings';
import type {
  DefinitionDraft,
  DefinitionSummary,
  ListResponse,
  NodeCatalog,
  ValidationIssue,
} from '@/engine/types';

type HttpErrorBody =
  | { code?: string; message?: string; details?: unknown }
  | { message?: string }
  | unknown;

export function normalizeHttpError(error: unknown): string {
  if (!axios.isAxiosError(error)) return String(error);
  const status = error.response?.status;
  const data = error.response?.data as HttpErrorBody;
  const code =
    data && typeof data === 'object' && data !== null && 'code' in data
      ? String((data as any).code)
      : undefined;
  const message =
    data && typeof data === 'object' && data !== null && 'message' in data
      ? String((data as any).message)
      : error.message;

  return code ? `[${status ?? 'ERR'}] ${code}: ${message}` : `[${status ?? 'ERR'}] ${message}`;
}

async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const settings = useSettingsStore();
  const res = await axios.request<T>({
    baseURL: settings.backendBaseUrl,
    timeout: 20_000,
    ...config,
  });
  return res.data;
}

function getDangerousAuthHeader(): Record<string, string> {
  const settings = useSettingsStore();
  const tokenRaw = settings.adminToken?.trim() ?? '';
  if (!tokenRaw) return {};
  const value = tokenRaw.startsWith('Bearer ') ? tokenRaw : `Bearer ${tokenRaw}`;
  return { Authorization: value };
}

export const backendApi = {
  // Catalog
  getNodeCatalog(): Promise<NodeCatalog> {
    return request({ method: 'GET', url: '/catalog/nodes' });
  },

  // Definitions
  listDefinitions(params?: {
    q?: string;
    limit?: number;
    cursor?: string;
  }): Promise<ListResponse<DefinitionSummary>> {
    return request({
      method: 'GET',
      url: '/admin/definitions',
      params: {
        q: params?.q,
        limit: params?.limit,
        cursor: params?.cursor,
      },
    });
  },

  getDraft(definitionId: string): Promise<DefinitionDraft> {
    return request({ method: 'GET', url: `/admin/definitions/${definitionId}/draft` });
  },

  createDraft(body: {
    definitionId: string;
    contentType: 'graph_json';
    content: Record<string, unknown>;
    outputSchema?: Record<string, unknown> | null;
    runnerConfig?: Record<string, unknown> | null;
  }): Promise<{ definitionId: string; draftRevisionId: string; createdAt: string; updatedAt: string }> {
    return request({ method: 'POST', url: '/admin/definitions', data: body });
  },

  updateDraft(
    definitionId: string,
    body: {
      draftRevisionId: string;
      contentType: 'graph_json';
      content: Record<string, unknown>;
      outputSchema?: Record<string, unknown> | null;
      runnerConfig?: Record<string, unknown> | null;
    },
  ): Promise<{ definitionId: string; draftRevisionId: string; createdAt: string; updatedAt: string }> {
    return request({ method: 'PUT', url: `/admin/definitions/${definitionId}/draft`, data: body });
  },

  deleteDraft(definitionId: string): Promise<{ deleted: boolean }> {
    return request({ method: 'DELETE', url: `/admin/definitions/${definitionId}/draft` });
  },

  validateDefinition(body: {
    definitionRef?: { definitionId: string; definitionHash: string };
    definition?: {
      contentType: 'graph_json';
      content: Record<string, unknown>;
      outputSchema?: Record<string, unknown> | null;
      runnerConfig?: Record<string, unknown> | null;
    };
  }): Promise<{ ok: boolean; errors: ValidationIssue[]; definitionHash?: string }> {
    return request({ method: 'POST', url: '/admin/definitions/validate', data: body });
  },

  dryRun(body: {
    definitionRef?: { definitionId: string; definitionHash: string };
    definition?: {
      contentType: 'graph_json';
      content: Record<string, unknown>;
      outputSchema?: Record<string, unknown> | null;
      runnerConfig?: Record<string, unknown> | null;
    };
    inputs: Record<string, unknown>;
    entrypointKey?: string;
    options?: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    outputs?: Record<string, unknown>;
    outputsHash?: string;
    inputsHash?: string;
    computedAt?: string;
    errors?: ValidationIssue[];
    error?: { code: string; message: string };
  }> {
    return request({ method: 'POST', url: '/admin/definitions/dry-run', data: body });
  },

  publishDefinition(
    definitionId: string,
    body: { draftRevisionId: string; changelog?: string },
  ): Promise<{ definitionId: string; definitionHash: string; publishedAt: string }> {
    return request({ method: 'POST', url: `/admin/definitions/${definitionId}/publish`, data: body });
  },

  listReleases(definitionId: string): Promise<
    Array<{
      definitionId: string;
      definitionHash: string;
      status: 'published' | 'deprecated';
      publishedAt: string;
      changelog: string | null;
      deprecatedAt: string | null;
      deprecatedReason: string | null;
    }>
  > {
    return request({ method: 'GET', url: `/admin/definitions/${definitionId}/releases` });
  },

  getRelease(definitionId: string, definitionHash: string): Promise<Record<string, unknown>> {
    return request({ method: 'GET', url: `/admin/definitions/${definitionId}/releases/${definitionHash}` });
  },

  deprecateRelease(
    definitionId: string,
    definitionHash: string,
    body: { reason?: string },
  ): Promise<Record<string, unknown>> {
    return request({
      method: 'POST',
      url: `/admin/definitions/${definitionId}/releases/${definitionHash}/deprecate`,
      data: body,
    });
  },

  // Jobs
  listJobs(params?: {
    limit?: number;
    cursor?: string;
    status?: 'requested' | 'running' | 'succeeded' | 'failed';
    definitionId?: string;
    definitionHashUsed?: string;
    since?: string;
    until?: string;
  }): Promise<
    ListResponse<{
      jobId: string;
      messageId: string | null;
      correlationId: string | null;
      definitionId: string;
      definitionHashUsed: string;
      inputsHash: string | null;
      outputsHash: string | null;
      status: 'requested' | 'running' | 'succeeded' | 'failed';
      requestedAt: string;
      computedAt: string | null;
      failedAt: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }>
  > {
    return request({
      method: 'GET',
      url: '/admin/jobs',
      params: {
        limit: params?.limit,
        cursor: params?.cursor,
        status: params?.status,
        definitionId: params?.definitionId,
        definitionHashUsed: params?.definitionHashUsed,
        since: params?.since,
        until: params?.until,
      },
    });
  },

  getJob(jobId: string): Promise<Record<string, unknown>> {
    return request({ method: 'GET', url: `/admin/jobs/${jobId}` });
  },

  // Ops
  getOpsStats(params?: { jobsSinceHours?: number }): Promise<Record<string, unknown>> {
    return request({ method: 'GET', url: '/admin/ops/stats', params });
  },

  // DLQ（危险端点）
  dlqStats(): Promise<{ dlqQueue: string; messageCount: number; consumerCount: number }> {
    return request({
      method: 'GET',
      url: '/admin/dlq/job-requested/stats',
      headers: getDangerousAuthHeader(),
    });
  },

  dlqReplay(body: {
    limit?: number;
    dryRun?: boolean;
    minIntervalMs?: number;
  }): Promise<Record<string, unknown>> {
    return request({
      method: 'POST',
      url: '/admin/dlq/job-requested/replay',
      data: body,
      headers: getDangerousAuthHeader(),
    });
  },
};

