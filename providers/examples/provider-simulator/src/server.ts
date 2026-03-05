import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { MqClient } from './mq';
import type { Storage } from './storage';
import type { InputsCatalogV2, JobRequestedV1, StoredJob } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

export async function createServer(params: {
  storage: Storage;
  mq: MqClient;
  httpPort: number;
}) {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  app.get('/health', async () => {
    return {
      ok: true,
      mqConnected: params.mq.isConnected(),
      storageUpdatedAt: new Date().toISOString(),
    };
  });

  app.get('/facts/global', async () => {
    return params.storage.getGlobalFacts();
  });

  app.get('/catalog/inputs', async () => {
    const catalog: InputsCatalogV2 = {
      schemaVersion: 2,
      inputs: [
        {
          name: 'companyName',
          valueType: 'String',
          description: '公司名称（示例：更像“全局 fact”，但在 Graph v2 中就是一个 inputs key）',
          example: 'Prime Inc.',
        },
        {
          name: 'taxRate',
          valueType: 'Ratio',
          description: '税率（0..1）',
          example: '0.13',
        },
        {
          name: 'fxRate',
          valueType: 'Decimal',
          description: '汇率（示例）',
          example: '7.1234',
        },
        {
          name: 'productId',
          valueType: 'String',
          description: '商品 ID（示例：更像“请求参数”，但在 Graph v2 中就是一个 inputs key）',
          example: 'p_123',
        },
        {
          name: 'payload',
          valueType: 'Json',
          description: '业务入参（结构化对象，示例）',
          example: {
            price: { base: '100', currency: 'USD' },
            discount: { ratio: '0.1' },
          },
        },
        {
          name: 'asOf',
          valueType: 'DateTime',
          description: '生效时间点（ISO8601）',
          example: '2026-03-03T00:00:00Z',
        },
      ],
    };

    return catalog;
  });

  app.put('/facts/global', async (req, reply) => {
    const body = (req as any).body as unknown;
    if (!isPlainObject(body)) {
      reply.code(400);
      return { code: 'INVALID_BODY', message: 'global facts must be an object' };
    }
    await params.storage.setGlobalFacts(body);
    return { ok: true };
  });

  app.get('/jobs', async (req) => {
    const limitRaw = (req.query as any)?.limit;
    const limit = Math.max(1, Math.min(200, Number(limitRaw ?? 50)));
    return {
      items: params.storage.listJobs(limit),
    };
  });

  app.get('/jobs/:jobId', async (req, reply) => {
    const jobId = (req.params as any).jobId as string;
    const job = params.storage.getJob(jobId);
    if (!job) {
      reply.code(404);
      return { code: 'JOB_NOT_FOUND', message: 'job not found' };
    }
    return job;
  });

  app.post('/jobs', async (req, reply) => {
    const body = (req as any).body as unknown;
    if (!isPlainObject(body)) {
      reply.code(400);
      return { code: 'INVALID_BODY', message: 'body must be an object' };
    }

    const definitionRef = body['definitionRef'];
    if (!isPlainObject(definitionRef)) {
      reply.code(400);
      return { code: 'INVALID_BODY', message: 'definitionRef is required' };
    }
    const definitionId = definitionRef['definitionId'];
    const definitionHash = definitionRef['definitionHash'];
    if (typeof definitionId !== 'string' || typeof definitionHash !== 'string') {
      reply.code(400);
      return { code: 'INVALID_BODY', message: 'definitionRef.definitionId/hash must be string' };
    }

    const jobId = typeof body['jobId'] === 'string' ? body['jobId'] : crypto.randomUUID();
    const correlationId =
      typeof body['correlationId'] === 'string' ? body['correlationId'] : jobId;

    const entrypointKey =
      typeof body['entrypointKey'] === 'string' ? body['entrypointKey'] : undefined;
    const options = isPlainObject(body['options']) ? (body['options'] as Record<string, unknown>) : undefined;

    const mergeGlobalFacts = body['mergeGlobalFacts'] !== false;
    const inputRaw = isPlainObject(body['inputs']) ? (body['inputs'] as Record<string, unknown>) : {};

    const mergedBase = mergeGlobalFacts
      ? { ...params.storage.getGlobalFacts(), ...inputRaw }
      : inputRaw;

    const inputs: Record<string, unknown> = {
      ...mergedBase,
      _meta: {
        provider: 'provider-simulator',
        requestedAt: new Date().toISOString(),
        ...(isPlainObject(mergedBase['_meta']) ? (mergedBase['_meta'] as Record<string, unknown>) : {}),
      },
    };

    const payload: JobRequestedV1 = {
      schemaVersion: 1,
      jobId,
      definitionRef: { definitionId, definitionHash },
      entrypointKey,
      inputs,
      options,
    };

    const stored: StoredJob = {
      jobId,
      requestedAt: new Date().toISOString(),
      definitionRef: { definitionId, definitionHash },
      entrypointKey,
      status: 'requested',
      correlationId,
      messageId: jobId,
      payload,
    };

    try {
      // 先更新本地视图（内存），落盘为异步批处理；避免请求路径同步写盘。
      await params.storage.upsertJob(stored);
      // MQ 发布为 confirm 批处理；避免每条消息 waitForConfirms()。
      await params.mq.publishJob(payload, { messageId: jobId, correlationId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === 'MQ not connected') {
        reply.code(503);
        return { code: 'MQ_NOT_CONNECTED', message };
      }
      reply.code(500);
      return { code: 'INTERNAL_ERROR', message };
    }

    return { ok: true, jobId };
  });

  await app.listen({ port: params.httpPort, host: '0.0.0.0' });
  return app;
}
