# 06｜MQ 协议（RabbitMQ：怎么发 job、怎么收结果）

## 这份文档适合谁

- 你要写 Provider，打算用 RabbitMQ 驱动 Engine 执行。
- 你看到“exchange / routingKey / queue”就头大，想先搞清楚概念再写代码。
- 你想要可以直接复制的 Node.js 发布/订阅示例，并知道如何排查“消息到底去哪了”。

> 权威来源：[`../API_DESIGN.md`](../API_DESIGN.md)
> 本文会优先讲清楚“发生了什么”，再给可复制示例。

---

## 先把 RabbitMQ 三个词讲明白

你可以把 RabbitMQ 想成“快递中转站”：

- **exchange（交换机）**：中转站的分拣中心（你把包裹丢给它）
- **routingKey（路由键）**：包裹上写的“目的地标签”（例如 `compute.job.requested.v1`）
- **queue（队列）**：真正的“收件箱”（消费者从这里取件）
- **bind（绑定）**：告诉分拣中心“哪些标签的包裹应该放进这个收件箱”

一句话：  
**发布方把消息发到 exchange，并写上 routingKey；RabbitMQ 按绑定规则把消息放进一个或多个 queue；消费者从 queue 消费。**

---

## 这套系统用到哪些 exchange / routingKey（严格版）

默认约定（开发/测试环境）：

- Commands exchange：`compute.commands`（发 job 请求）
- Events exchange：`compute.events`（发结果事件）
- Job 请求 routingKey：`compute.job.requested.v1`
- Job 成功 routingKey：`compute.job.succeeded.v1`
- Job 失败 routingKey：`compute.job.failed.v1`

Provider 通常会创建一个自己的结果队列（名字你自己定），并绑定到 `compute.events`：

- bind `compute.job.succeeded.v1`
- bind `compute.job.failed.v1`

> 提示：你会在示例 provider（`provider-simulator`）里看到同样的做法：
> - 发布时 assert `compute.commands`（topic）
> - 消费时 assert `compute.events`（topic）并 bind 两个结果 routingKey

---

## 消息的 JSON payload（你需要认识的三种）

### 1) 计算请求：`compute.job.requested.v1`

```json
{
  "schemaVersion": 1,
  "jobId": "2665a5be-723d-4672-b382-8bf64202cb92",
  "definitionRef": { "definitionId": "测试", "definitionHash": "..." },
  "inputs": { "basePrice": "100", "_meta": { "provider": "demo" } },
  "options": {}
}
```

要点：

- `jobId`：这次执行的单号（幂等关键）
- `definitionRef`：跑哪一版图（必须包含 `definitionHash`）
- `inputs`：你喂进去的输入（结构由图的 `flow.start` pins 决定）
- `options`：运行开关（没有就 `{}`）

### 2) 成功事件：`compute.job.succeeded.v1`

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

### 3) 失败事件：`compute.job.failed.v1`

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

## AMQP properties（messageId / correlationId）怎么用

### 解释

JSON payload 只是“包裹内容”。AMQP 还有一层“包裹外面的快递单”（properties）。
其中两个非常有用：

- `messageId`：这条消息本身的唯一 ID（用于去重）
- `correlationId`：把一堆相关消息串起来的 ID（用于链路追踪）

### 建议约定

- 发布 job 时：
  - `messageId = <job request message id>`（建议 UUID）
  - `correlationId = jobId`（方便串联日志）
- 消费结果事件时：
  - 按事件的 `messageId` 做去重（保存已处理集合）

> 提示：即使你不设置 `messageId`，系统也能跑；只是你下游会更难保证“重复事件不重复处理”。

---

## Node.js 可复制示例（推荐直接用）

安装依赖：

```bash
npm i amqplib
```

### A) 发布 job（confirm channel，确保真正发出去了）

```javascript
const amqplib = require("amqplib");
const { randomUUID } = require("crypto");

const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const commandsExchange = process.env.MQ_COMMANDS_EXCHANGE ?? "compute.commands";
const jobRequestedRoutingKey = "compute.job.requested.v1";

async function main() {
  const jobId = randomUUID();
  const messageId = randomUUID();

  const job = {
    schemaVersion: 1,
    jobId,
    definitionRef: { definitionId: "测试", definitionHash: "..." },
    inputs: { basePrice: "100", _meta: { provider: "demo", requestedAt: new Date().toISOString() } },
    options: {},
  };

  const conn = await amqplib.connect(rabbitUrl);
  const ch = await conn.createConfirmChannel();
  await ch.assertExchange(commandsExchange, "topic", { durable: true });

  const ok = ch.publish(commandsExchange, jobRequestedRoutingKey, Buffer.from(JSON.stringify(job), "utf8"), {
    persistent: true,
    contentType: "application/json",
    type: jobRequestedRoutingKey,
    messageId,
    correlationId: jobId,
    headers: { schemaVersion: 1 },
    timestamp: Math.floor(Date.now() / 1000),
  });

  if (!ok) await new Promise((r) => ch.once("drain", r));
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

### B) 订阅结果（ack + 去重）

```javascript
const amqplib = require("amqplib");

const rabbitUrl = process.env.RABBITMQ_URL ?? "amqp://guest:guest@localhost:5672";
const eventsExchange = process.env.MQ_EVENTS_EXCHANGE ?? "compute.events";
const resultsQueue = process.env.MQ_RESULTS_QUEUE ?? "my-provider.results.v1";

// 生产环境建议持久化到 DB/Redis；这里只用内存演示
const processed = new Set();

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
    if (messageId && processed.has(messageId)) {
      ch.ack(msg);
      return;
    }

    try {
      const payload = JSON.parse(msg.content.toString("utf8"));
      console.log("event", msg.fields.routingKey, payload.jobId);

      // TODO：把 payload.outputs 写回你们系统，或触发回调

      if (messageId) processed.add(messageId);
      ch.ack(msg);
    } catch (e) {
      // 解析失败：别吞消息，丢回队列重试
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

## PowerShell/curl：用 RabbitMQ 管理 API 看“队列有没有在堆积”

> 说明：开发/测试环境默认开了管理插件（15672）。生产环境是否开放由你们运维策略决定。

### 1) 列出所有队列（PowerShell）

```powershell
$user = "guest"
$pass = "guest"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${pass}"))
$headers = @{ Authorization = "Basic $auth" }

Invoke-RestMethod "http://localhost:15672/api/queues" -Headers $headers -Method Get |
  Select-Object name, messages, consumers
```

### 2) 查看某个队列详情（curl）

> 注意：vhost 默认是 `/`，URL 里要写成 `%2F`

```bash
curl.exe -sS -u "guest:guest" "http://localhost:15672/api/queues/%2F/my-provider.results.v1"
```

---

## 常见坑（你八成会踩其中一个）

- **发到了错误的 exchange**：看清 `compute.commands` vs `compute.events`。
- **routingKey 写错**：尤其是 `requested/succeeded/failed` 拼写。
- **队列没 bind**：没有绑定就收不到事件（RabbitMQ UI 可视化检查）。
- **忘记 ack**：消费者不 ack，消息会一直堆在队列里。
- **不做去重**：结果事件重复投递时，你会重复落库/重复回调。

