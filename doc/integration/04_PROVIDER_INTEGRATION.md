# 04｜Provider 集成（拼 inputs、投递 job、收结果）

## 这份文档适合谁

- 你们要把 Engine 的计算能力接到自己的业务系统里（例如：计费、风控、报价、规则计算）。
- 你们准备写一个“Provider 服务/SDK”，负责把业务数据变成 inputs，并通过 MQ 驱动执行。
- 你不想照抄 `providers/examples/provider-simulator/`，而是想抓住必守规则：inputs 契约、幂等、去重、错误处理。

---

## Provider 到底负责什么（人话版）

Provider 可以理解成“适配层/翻译官”：

- 从你们系统拿到业务数据（数据库、HTTP、消息、文件……都行，这部分是你们的 IO）
- 把数据 **按图的入口 pins** 组装成 `inputs`
- 生成一个 `jobId`（用于幂等）
- 通过 RabbitMQ 投递 `compute.job.requested.v1`
- 订阅 `compute.job.succeeded.v1` / `compute.job.failed.v1` 拿到结果
- 把 outputs 写回你们系统（回调、落库、发事件等）

> Engine 的边界：Engine **不做 IO**。
> 所以“去哪里拿数据/把结果写到哪里”都属于 Provider 的职责。

---

## inputs 怎么拼（最关键）

### 人话解释：只看 `flow.start` 声明的 pins

Graph v2 里，图的输入契约来自 `flow.start.params.dynamicOutputs[]`。
Provider 的 `inputs` 里，**只有这些 pin.name 对应的字段会被读取/校验**。

- 你可以在 `inputs` 里带额外字段（例如 `_meta`），一般会被忽略
- 但如果你想让“可演进字段”真正能在图里被使用，推荐声明一个 `Json` pin（例如 `payload: Json`），把结构化对象塞进去

### 严格规则（你必须遵守）

- `inputs` 必须是一个 JSON object（不是数组/字符串）
- 对于 `Decimal/Ratio` 类型：推荐用 **字符串** 表示（例如 `"10.2"`），避免语言浮点误差
- 缺必填字段（required 且最终值为 null）会触发 `INPUT_VALIDATION_ERROR`

### 示例（JSON）

```json
{
  "inputs": {
    "basePrice": "100",
    "taxRate": "0.13",
    "_meta": { "provider": "my-provider", "requestedAt": "2026-03-04T23:44:42.266Z" }
  }
}
```

---

## jobId 幂等怎么做（避免重复执行）

### 人话解释

消息系统的现实是：消息可能重复、网络可能抖、你可能重试。
所以你必须有一个稳定的 `jobId` 来把“同一笔业务的同一次计算”绑定起来。

### 严格建议

- **重试必须复用同一个 jobId**（比如 MQ publish 超时后重试、Provider 崩溃重启后补偿重发）
- 生成方式推荐二选一：
  - UUID（最简单，但如果你重试时生成了新 UUID，就失去幂等）
  - 业务主键派生（例如 `hash(orderId + definitionHash + attemptKey)`），保证同一业务同一版本同一窗口得到同一 jobId

---

## 结果事件为什么要去重（messageId）

### 人话解释

`succeeded/failed` 事件是 **至少一次（at-least-once）**：同一个结果事件可能会重复投递。
所以消费方必须去重，否则你可能把同一份结果写库两次/触发两次回调。

### 严格做法

- 结果事件的 AMQP properties 里会带 `messageId`（如果发布方设置了）
- Provider 侧应保存“已处理的 messageId 集合”（可以是 DB 表、Redis set、本地持久化文件……）
  - 如果再次收到同一 messageId：直接 ack 丢弃

> 参考实现可以看 `providers/examples/provider-simulator/src/mq.ts`（它把 processed messageId 持久化起来）。

---

## MQ 协议（最小必会）

更完整细节见：[`06_MQ_PROTOCOL.md`](06_MQ_PROTOCOL.md) 和权威文档 [`../API_DESIGN.md`](../API_DESIGN.md)。

### 1) 投递 job 的 payload（JSON）

```json
{
  "schemaVersion": 1,
  "jobId": "2665a5be-723d-4672-b382-8bf64202cb92",
  "definitionRef": {
    "definitionId": "测试",
    "definitionHash": "3e425483de312fcc5db5bed310df0d7c8e358f191c858794f4b489cdefae72b2"
  },
  "inputs": {
    "basePrice": "100",
    "_meta": { "provider": "my-provider", "requestedAt": "2026-03-04T23:44:42.266Z" }
  },
  "options": {}
}
```

### 2) 成功事件 payload（JSON）

```json
{
  "schemaVersion": 1,
  "jobId": "2665a5be-723d-4672-b382-8bf64202cb92",
  "definitionRefUsed": { "definitionId": "测试", "definitionHash": "..." },
  "inputsHash": "…",
  "outputs": { "finalPrice": "113.00" },
  "outputsHash": "…",
  "computedAt": "2026-03-04T23:45:01.000Z"
}
```

### 3) 失败事件 payload（JSON）

```json
{
  "schemaVersion": 1,
  "jobId": "2665a5be-723d-4672-b382-8bf64202cb92",
  "definitionRefUsed": { "definitionId": "测试", "definitionHash": "..." },
  "inputsHash": "…",
  "error": { "code": "INPUT_VALIDATION_ERROR", "message": "definition validation failed", "details": [] },
  "retryable": false,
  "failedAt": "2026-03-04T23:45:01.000Z"
}
```

---

## Node.js 可复制示例：发布 job + 订阅结果（最小版）

> 说明：这是最小示例，展示关键点：exchange、routingKey、messageId、去重。
> 你在生产里需要把“重试/连接保活/错误处理”做得更完整（参考 provider-simulator 的 main loop/backoff）。

安装依赖：

```bash
npm i amqplib
```

### 1) 发布 job（compute.job.requested.v1）

```javascript
const amqplib = require("amqplib");
const { randomUUID } = require("crypto");

const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const commandsExchange = process.env.MQ_COMMANDS_EXCHANGE ?? "compute.commands";
const jobRequestedRoutingKey = "compute.job.requested.v1";

const jobId = randomUUID();
const messageId = randomUUID();

const job = {
  schemaVersion: 1,
  jobId,
  definitionRef: { definitionId: "测试", definitionHash: "..." },
  inputs: { basePrice: "100", _meta: { provider: "demo", requestedAt: new Date().toISOString() } },
  options: {},
};

async function main() {
  const conn = await amqplib.connect(rabbitUrl);
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange(commandsExchange, "topic", { durable: true });

  ch.publish(commandsExchange, jobRequestedRoutingKey, Buffer.from(JSON.stringify(job), "utf8"), {
    persistent: true,
    contentType: "application/json",
    type: jobRequestedRoutingKey,
    messageId,
    correlationId: jobId,
    headers: { schemaVersion: 1 },
    timestamp: Math.floor(Date.now() / 1000),
  });

  await ch.waitForConfirms();
  await ch.close();
  await conn.close();

  console.log("published jobId =", jobId);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

### 2) 订阅结果（去重后处理）

```javascript
const amqplib = require("amqplib");

const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const eventsExchange = process.env.MQ_EVENTS_EXCHANGE ?? "compute.events";
const resultsQueue = process.env.MQ_RESULTS_QUEUE ?? "my-provider.results.v1";

// 生产请用 DB/Redis 持久化；这里只用内存演示
const processedMessageIds = new Set();

async function main() {
  const conn = await amqplib.connect(rabbitUrl);
  const ch = await conn.createChannel();

  await ch.assertExchange(eventsExchange, "topic", { durable: true });
  await ch.assertQueue(resultsQueue, { durable: true });
  await ch.bindQueue(resultsQueue, eventsExchange, "compute.job.succeeded.v1");
  await ch.bindQueue(resultsQueue, eventsExchange, "compute.job.failed.v1");
  await ch.prefetch(20);

  await ch.consume(resultsQueue, async (msg) => {
    if (!msg) return;
    const messageId = typeof msg.properties.messageId === "string" ? msg.properties.messageId : null;
    if (messageId && processedMessageIds.has(messageId)) {
      ch.ack(msg);
      return;
    }

    try {
      const payload = JSON.parse(msg.content.toString("utf8"));
      console.log("event", msg.fields.routingKey, payload.jobId);

      // TODO：把 outputs 写回你们系统 / 回调给调用方

      if (messageId) processedMessageIds.add(messageId);
      ch.ack(msg);
    } catch (e) {
      // 解析失败：nack 且 requeue，避免吞消息
      ch.nack(msg, false, true);
    }
  });

  console.log("listening on queue =", resultsQueue);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

---

## “我怎么知道该填哪些 inputs？”

两种常见做法：

1. **由你们的 Editor 负责生成模板**（推荐）
   - Editor 读取 Release content 的 `flow.start` pins
   - 生成 inputs 模板给业务方填写
   - 这样 Provider 只需要按模板填值
2. **Provider 自己读取 Release pins**
   - 调 `GET /admin/definitions/:definitionId/releases/:definitionHash` 拿图
   - 读 `flow.start.params.dynamicOutputs` 生成模板/校验
如果你想直接照抄命令与代码，看：[`05_HTTP_API_COOKBOOK.md`](05_HTTP_API_COOKBOOK.md) 和 [`06_MQ_PROTOCOL.md`](06_MQ_PROTOCOL.md)。

