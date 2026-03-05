import 'dotenv/config';
import { Storage } from './storage';
import { MqClient } from './mq';
import { createServer } from './server';

function mustGet(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} is required`);
  return v;
}

async function main() {
  const httpPort = Number(process.env.HTTP_PORT ?? 4020);
  const rabbitUrl = mustGet('RABBITMQ_URL', '');

  const commandsExchange = process.env.MQ_COMMANDS_EXCHANGE ?? 'compute.commands';
  const eventsExchange = process.env.MQ_EVENTS_EXCHANGE ?? 'compute.events';
  const jobRequestedRoutingKey = process.env.MQ_JOB_REQUESTED_ROUTING_KEY ?? 'compute.job.requested.v1';
  const resultsQueue = process.env.MQ_RESULTS_QUEUE ?? 'provider.simulator.results.v1';
  const storagePath = process.env.STORAGE_PATH ?? './data/provider-simulator.json';

  const storageFlushIntervalMs = Number(process.env.STORAGE_FLUSH_INTERVAL_MS ?? 200);
  const storagePrettyJson = process.env.STORAGE_PRETTY_JSON === 'true';
  const storage = new Storage(storagePath, {
    flushIntervalMs: storageFlushIntervalMs,
    prettyJson: storagePrettyJson,
  });
  await storage.init();

  const mqPublishConfirmIntervalMs = Number(
    process.env.MQ_PUBLISH_CONFIRM_INTERVAL_MS ?? 50,
  );
  const mqPublishConfirmBatchSize = Number(
    process.env.MQ_PUBLISH_CONFIRM_BATCH_SIZE ?? 200,
  );

  const mq = new MqClient(
    {
      rabbitUrl,
      commandsExchange,
      eventsExchange,
      jobRequestedRoutingKey,
      resultsQueue,
      prefetch: 50,
      publishConfirmIntervalMs: mqPublishConfirmIntervalMs,
      publishConfirmBatchSize: mqPublishConfirmBatchSize,
    },
    storage,
  );
  await mq.start();

  const app = await createServer({ storage, mq, httpPort });

  // eslint-disable-next-line no-console
  console.log(`[provider-simulator] HTTP listening on http://localhost:${httpPort}`);

  let shuttingDown = false;
  const shutdown = async (reason: string, exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;

    // eslint-disable-next-line no-console
    console.log(`[provider-simulator] shutting down: reason=${reason}`);

    try {
      await app.close();
    } catch {}
    try {
      await mq.stop();
    } catch {}
    try {
      await storage.flushNow();
    } catch {}

    process.exit(exitCode);
  };

  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('uncaughtException', (err) => {
    // eslint-disable-next-line no-console
    console.error('[provider-simulator] uncaughtException', err);
    void shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (err) => {
    // eslint-disable-next-line no-console
    console.error('[provider-simulator] unhandledRejection', err);
    void shutdown('unhandledRejection', 1);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

