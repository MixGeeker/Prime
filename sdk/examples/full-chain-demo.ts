import {
  JsonFileDedupeStore,
  createComputeSdk,
} from '../src/index.js';

type PricingContext = {
  orderId: string;
  customerId: string;
  quantity: string;
  unitPrice: string;
};

async function main() {
  const sdk = createComputeSdk({
    rabbitUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    resultsQueue: process.env.RESULTS_QUEUE ?? 'sdk.demo.results.v1',
  });

  const builder = sdk.createInputsBuilder<PricingContext>();

  builder
    .use('company', async () => ({
      companyId: 'prime-demo',
      taxRate: '0.13',
      currency: 'USD',
    }))
    .use('order', async (context) => ({
      orderId: context.orderId,
      customerId: context.customerId,
      quantity: context.quantity,
      unitPrice: context.unitPrice,
    }))
    .use('audit', async () => ({
      _meta: {
        source: 'sdk-demo',
        requestedAt: new Date().toISOString(),
      },
    }));

  const inputs = await builder.build({
    orderId: 'order_001',
    customerId: 'customer_001',
    quantity: '2',
    unitPrice: '100',
  });

  const consumer = sdk.createResultsConsumer({
    dedupeStore: new JsonFileDedupeStore('./data/sdk-demo-dedupe.json'),
    onSucceeded: async ({ payload }) => {
      console.log('[sdk-demo] succeeded', payload.jobId, payload.outputs);
    },
    onFailed: async ({ payload }) => {
      console.error('[sdk-demo] failed', payload.jobId, payload.error);
    },
  });
  await consumer.start();

  const result = await sdk.sendJob({
    definitionRef: {
      definitionId: process.env.DEFINITION_ID ?? 'example.tax-discount',
      definitionHash: process.env.DEFINITION_HASH ?? '<replace-me>',
    },
    inputs,
  });

  console.log('[sdk-demo] published job', result.jobId);
  console.log('[sdk-demo] press Ctrl+C to stop consumer');

  const shutdown = async () => {
    await consumer.stop();
    await sdk.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
