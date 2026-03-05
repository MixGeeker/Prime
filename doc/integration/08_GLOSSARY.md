# 08｜术语表（不懂就查这里）

这份“字典”遵循同一个格式：

- **人话解释**：先让你一眼懂在说什么
- **严格定义**：再告诉你系统里它到底指什么
- **常见误解**：避免踩坑

---

## Compute Engine（计算引擎）

- 人话解释：一个只负责“纯计算”的服务。你给它规则（图）和输入（inputs），它给你输出（outputs）。
- 严格定义：执行 Graph v2 的 runner，负责校验、计算 hash、执行节点、产出结果事件。
- 常见误解：Engine 会帮你拉业务数据/写回业务系统。实际上 **Engine 不做 IO**，这些属于 Provider。

---

## Editor（编辑器）

- 人话解释：给人用来“做图/发布/预览/管理版本”的 UI 或工具。
- 严格定义：通过 HTTP Admin API 管理 Draft/Release、调用 Validate/Dry-run/Publish、读取 Node Catalog 渲染表单。
- 常见误解：Editor 是必须的“固定前端”。实际上仓库 `frontend/` 只是示例，你们可自研。

---

## Provider（适配层）

- 人话解释：把你们业务数据翻译成 inputs 的那层服务/SDK，并负责投递 job、消费结果。
- 严格定义：对接 RabbitMQ（commands/events），实现 jobId 幂等与结果事件去重。
- 常见误解：Provider 只要把消息发出去就完事。实际上 Provider 还要处理重试、去重、落库/回调等业务闭环。

---

## Definition / Draft / Release

### Definition

- 人话解释：一份“配方的名字”。
- 严格定义：用 `definitionId` 标识的一组版本集合。
- 常见误解：Definition 自带一个“当前版本”。实际上执行必须引用某个 Release（hash）。

### Draft

- 人话解释：正在编辑中的版本（可变）。
- 严格定义：保存图 content/runnerConfig 等草稿内容，通常带 `draftRevisionId` 做并发控制。
- 常见误解：改了 draft 就会上线。实际上必须 publish 才会变成 release。

### Release

- 人话解释：发布后的不可变版本（盖章版）。
- 严格定义：由 `definitionId + definitionHash` 唯一定位，包含 `content`（Graph v2）等。
- 常见误解：Release 可以“在线修改”。实际上要改只能发新 Release。

---

## definitionHash

- 人话解释：发布版本的“指纹”。
- 严格定义：对 release 的关键内容做规范化后计算出的 SHA-256（详见 [`../HASHING_SPEC.md`](../HASHING_SPEC.md)）。
- 常见误解：hash 是随机的。实际上它由内容决定。

---

## Graph v2 / schemaVersion

- 人话解释：图的结构版本。现在只支持 v2。
- 严格定义：GraphJsonV2 顶层必须包含 `"schemaVersion": 2`，并满足 v2 规则（`flow.start`/`flow.end` 契约等）。
- 常见误解：只要能画出来就能跑。实际上引擎会严格校验；看到 `globals/entrypoints/outputs` 通常意味着跑到了旧版本进程（见排障文档）。

---

## Pin / Port

- 人话解释：画布上一个小圆点（可连线的口）。
- 严格定义：
  - **Port**：节点上的输入/输出口（包含 exec 与 value）。
  - **Pin**：这里特指 `flow.start`/`flow.end` 的动态端口定义（`PinDef`），用来声明 inputs/outputs 的“契约”。
- 常见误解：label 重要。实际上 `name` 才是机器用的 key，必须唯一。

---

## Node Catalog（节点目录）

- 人话解释：告诉 Editor“有哪些节点可以用，每个节点怎么连、怎么填参数”。
- 严格定义：`GET /catalog/nodes` 返回的节点列表，包含 ports 与 `paramsSchema`。
- 常见误解：Catalog 只是 UI 用。实际上引擎校验也依赖节点定义；Editor 和引擎必须一致。

---

## paramsSchema（参数表单说明书）

- 人话解释：一份“表单怎么长、字段怎么填”的规范。
- 严格定义：JSON Schema（draft-07），用于校验 graph 里 `node.params` 的结构和值。
- 常见误解：paramsSchema 可有可无、随便填。实际上填错会导致 validate/publish/execute 失败。

---

## Validate / Dry-run / Publish

- Validate（校验）
  - 人话：检查图是否“能不能跑、有没有明显错误”。
  - 严格：`POST /admin/definitions/validate`，返回 `ok + errors[]`。
- Dry-run（预览执行）
  - 人话：喂一组 inputs，马上看到 outputs（不落库、不走 MQ）。
  - 严格：`POST /admin/definitions/dry-run`，返回 outputs + hashes。
- Publish（发布）
  - 人话：把草稿盖章成不可变版本。
  - 严格：`POST /admin/definitions/:definitionId/publish`，产出 `definitionHash`。

---

## Job / jobId

- Job
  - 人话：一次执行请求（“把这份配方跑一遍”）。
  - 严格：通过 MQ 投递 `compute.job.requested.v1` 的 payload。
- jobId
  - 人话：这次执行的“订单号”。
  - 严格：幂等主键；重试必须复用。
  - 常见误解：重试可以生成新 jobId。这样会导致重复执行。

---

## inputs / options / outputs

- 人话：
  - inputs：原料
  - options：开关
  - outputs：成品
- 严格：
  - 引擎只读取 `flow.start` pins 声明过的 inputs key
  - outputs 只会产出 `flow.end` pins 声明过的 key
- 常见误解：inputs 多带点字段也能在图里用。实际上未声明字段会被剔除；需要灵活结构请用 `Json` pin。

---

## inputsHash / outputsHash

- 人话：输入/输出的指纹，用来追溯与对账。
- 严格：对 inputs/outputs 做 canonicalize 后计算的 hash（详见 [`../HASHING_SPEC.md`](../HASHING_SPEC.md)）。
- 常见误解：hash 是给 UI 展示用。实际上它更适合做审计/排障/一致性验证。

---

## exchange / routingKey / queue / bind（RabbitMQ）

- 人话：分拣中心 / 标签 / 收件箱 / 绑定规则。
- 严格：AMQP 概念，用于把消息从发布者路由到消费者队列。
- 常见误解：发到 exchange 就等于有人收到。实际上必须有 queue 绑定对应 routingKey，且要有消费者消费。

---

## messageId / correlationId

- 人话：
  - messageId：这条消息的身份证（用于去重）
  - correlationId：把一串相关消息串起来（用于链路追踪）
- 严格：AMQP properties 字段。
- 常见误解：不设置也没事。短期能跑，但长期排障/去重会很痛苦。

---

## 幂等（Idempotency）

- 人话：同一件事做两次，结果应该和做一次一样（至少不会变坏）。
- 严格：在本系统里主要体现为 `jobId` 作为幂等主键：重复投递同一个 jobId 不应导致重复执行/重复副作用。
- 常见误解：幂等由 MQ 保证。实际上 MQ 只保证“尽力投递”，幂等要靠业务键（jobId）设计。

---

## at-least-once（至少一次投递）

- 人话：系统会尽量保证你能收到消息，但有可能收到重复的。
- 严格：消息投递语义；因此消费者必须自己去重。
- 常见误解：我只会收到一次。实际上重复很常见（网络抖动、重试、ack 超时等都会导致）。

---

## Outbox（事务外盒）

- 人话：为了保证“写数据库”和“发 MQ 事件”不会一半成功一半失败，先把要发的事件存到表里，再由后台异步发出去。
- 严格：一种一致性模式：业务事务只写 DB（含 outbox 记录），发布器从 outbox 拉取并投递 MQ，失败可重试。
- 常见误解：outbox 是多余的复杂度。实际上没有 outbox，最容易出现“DB 已写但事件没发/事件发了但 DB 没写”的对账灾难。

---

## canonicalize（规范化）

- 人话：把“同一个值的不同写法”变成同一种写法，避免 hash 乱跳。
- 严格：对 JSON/value 做排序、类型归一、精度处理等，再算 hash。
- 常见误解：hash 只对原始 JSON 字符串算。实际上应该对语义值算（详见 hash 规范）。

---

## 确定性错误（Deterministic error）/ 可重试（retryable）

- 人话：
  - 确定性错误：你重试 100 次也会失败（例如缺字段、类型不对、除零）
  - 可重试：过一会儿重试可能会好（例如 MQ/DB 临时不可用）
- 严格：错误对象里会包含 `retryable`（在失败事件中常见）。
- 常见误解：失败就无脑重试。确定性错误重试只会放大故障。

