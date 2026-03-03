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

  const storage = new Storage(storagePath);
  await storage.init();

  const mq = new MqClient(
    {
      rabbitUrl,
      commandsExchange,
      eventsExchange,
      jobRequestedRoutingKey,
      resultsQueue,
      prefetch: 50,
    },
    storage,
  );
  await mq.start();

  await createServer({ storage, mq, httpPort });

  // eslint-disable-next-line no-console
  console.log(`[provider-simulator] HTTP listening on http://localhost:${httpPort}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

