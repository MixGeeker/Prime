# Prime Engine SDK

`@prime-engine/sdk` 是新的主集成路径：业务模块自己构建 flat `inputs`，SDK 负责三件事：

- 模块化组装 `inputs`
- 发布 `compute.job.requested.v1`
- 订阅并去重 `compute.job.succeeded.v1 / failed.v1`

## 安装

```bash
cd sdk
npm i
```

## 核心原则

- **输入契约唯一事实源**：Definition release 的 `flow.start` pins
- **输入形态唯一约束**：单一 flat `inputs` object
- **结果回写责任**：业务模块自己处理；SDK 只做消费、去重、分发辅助
- **Runner 仍然纯函数**：SDK 负责所有外部 IO 聚合，不把 IO 放进 Compute Engine

## 快速示例

```ts
import {
  JsonFileDedupeStore,
  createComputeSdk,
} from '@prime-engine/sdk';

const sdk = createComputeSdk({
  rabbitUrl: 'amqp://guest:guest@localhost:5672',
  resultsQueue: 'pricing.results.v1',
});

const builder = sdk.createInputsBuilder<{ orderId: string; quantity: string }>();

builder
  .use('company', async () => ({ companyId: 'c_1', companyName: 'Prime Inc.' }))
  .use('order', async (context) => ({ orderId: context.orderId, quantity: context.quantity }));

const inputs = await builder.build({ orderId: 'o_1', quantity: '2' });

await sdk.sendJob({
  definitionRef: {
    definitionId: 'pricing.retail',
    definitionHash: '<definitionHash>',
  },
  inputs,
});

const consumer = sdk.createResultsConsumer({
  dedupeStore: new JsonFileDedupeStore('./data/results-dedupe.json'),
  onSucceeded: async ({ payload }) => {
    console.log('job succeeded', payload.jobId, payload.outputs);
  },
  onFailed: async ({ payload }) => {
    console.error('job failed', payload.jobId, payload.error);
  },
});

await consumer.start();
```

完整演示见 `sdk/examples/full-chain-demo.ts`。
