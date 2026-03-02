# 可插拔 Compute Engine（Definition + Job + Result）设计文档（Outbox + RabbitMQ）

> 本文档将“Compute Engine”定位为**平台级微服务**（单租户当前假设），不内置任何业务计算名称、业务事件、业务实体（Product/Order/POS 等）。
>
> 完整方案由三部分组成：
> - **Compute Engine（平台团队开发/维护，可独立服务部署）**：存储并发布不可变计算逻辑（Definition Release），消费计算任务（Job）并确定性执行，发布通用的 Job 结果事件。
> - **Compute Inputs Provider（集成方/业务方开发/维护）**：聚合并注入全局变量与 facts，负责所有 IO（DB/HTTP/gRPC），输出标准化 `inputs`。
> - **Definition Studio / Editor（集成方/业务方开发/维护）**：基于 Engine 提供的后端标准（Node Catalog / Definition Admin API / validate & dry-run）实现可视化建图与发布流程。

## 背景与动机
- 计算规则频繁变化，硬编码迭代成本高、风险大。
- “同一口径”在不同业务上下文下会演化出多套版本，需要**可追溯、可回放、可审计**。
- 我们希望把它作为微服务的第一步：通过 RabbitMQ 解耦“业务服务”与“计算执行”，并且未来可替换 Runner/DSL 实现。

## 核心原则（必须遵守）
1. **引擎不认识业务名词**：不出现 `product_pricing/profit/POS` 这类语义；这些都属于“Definition 的数据内容”，不是引擎代码。
2. **引擎只认识固定的平台命令与平台事件**：命令用于“存定义/发任务”；事件只表达“某个 job 成功/失败”。
3. **Runner 必须确定性**：纯函数、无业务 IO；相同 `definitionHash + inputsHash` 必须得到同输出（同精度与舍入策略）。
4. **发布后不可变（append-only）**：每次 publish 生成一个不可变发布物（Release，以 `definitionHash` 标识），发布后不允许修改；如需改动必须再次 publish 生成新 `definitionHash`。
5. **至少一次投递 + 幂等**：引擎端与消费端都要按 at-least-once 设计（Inbox/Outbox）。
6. **IO 归属 Inputs Provider**：任何 DB/HTTP/gRPC 拉取与解析都在 Provider 完成；Compute Engine 只接受标准化 inputs 并执行纯计算。
7. **后端采用 DDD + 六边形（Ports & Adapters）**：消息系统通过 `MessageBus` 端口抽象，RabbitMQ 只是默认适配器，未来可替换为 Kafka/NATS 等。

## 目标（What）
- 提供一个独立的 Compute Engine 微服务（可单独部署/扩容）。
- 存储计算 Definition，并对每次发布生成新的不可变发布物（Release，以 `definitionHash` 标识）。
- 消费 `compute.job.requested.v1`，按指定 `definitionId+definitionHash` 执行并发布结果事件。
- 可靠性：Outbox + RabbitMQ confirm；消费端/引擎端都有 Inbox 幂等能力。
- 提供 Inputs Provider 的接口规范与参考实现（由集成方按需扩展，用于统一聚合与注入 inputs）。
- 提供 Editor 的后端标准：Node Catalog、Definition Admin API、validate、dry-run（集成方可自由实现 UI）。

## 非目标（What Not）
- 引擎不负责“哪个业务对象用哪个计算逻辑”（不做 BindingPolicy/Scope/Target 之类业务绑定）。
- 引擎不直接查业务库、也不拼装 facts；输入由 Inputs Provider（调用方注入）组装并随 job 一起发送。
- Compute Engine 不提供官方 Editor UI；Editor 由集成方按自身技术栈实现（Engine 只提供后端标准与能力）。

---

## 服务边界与职责划分

### Compute Engine（本服务）
- Definition 仓库：创建/发布/弃用（Deprecated）计算逻辑发布物（Release）。
- Job 执行：根据 `definitionRef` 运行 Runner，输出 `outputs`。
- 可靠发布：Outbox dispatcher + publisher confirm。
- 幂等与追溯：Inbox 去重；结果事件携带溯源字段（`definitionRefUsed/inputsHash`）。

### 调用方（任意业务服务/适配器）
- 决定用哪个 Definition Release（显式传 `definitionId+definitionHash`；或上层自行做“策略/配置”）。
- 通过 Inputs Provider 组装输入 `inputs`（`inputs.globals` + `inputs.params`；允许携带多余字段但引擎默认忽略）并发送 `compute.job.requested.v1`。
- 消费结果事件，更新自己的读模型/缓存/报表等（需要的话可转发为业务事件）。

### Compute Inputs Provider（由集成方实现）
> 一个“输入聚合/注入模块”，把“全局变量/外部 facts 的获取与解析”从业务模块里抽出来。业务模块只需要：选择 `definitionRef` + 提供少量本地参数/对象标识，然后让 Inputs Provider 输出最终的 `inputs` 并投递 job。

> 平台团队提供：Provider 接口规范 + 参考实现；具体项目可按自身数据源/权限/缓存策略扩展。

Inputs Provider 典型职责：
- **聚合 facts**：从货币模块/公司模块/库存模块等拉取需要的事实数据（可以是 DB 直读、HTTP/gRPC、或订阅事件构建本地缓存）。
- **对齐引擎输入契约**：把“会影响计算结果”的字段写入 `inputs.globals` 与 `inputs.params`（对应 BlueprintGraph 的 `globals/entrypoints[key].params` 声明）。
  - 允许携带多余字段（如 `inputs._meta/inputs.facts/inputs.resolved`），但引擎默认不会读取，也不会把未声明字段纳入 `inputsHash`。
- **解析与规范化**：Decimal（字符串）规范化（必要时包含 Ratio/DateTime），避免调用方各自实现导致口径漂移；币种/方向等领域语义由集成方自行管理。
- **可追溯**：把关键来源信息（如汇率时间点、rateId、公司配置 revision 等）作为声明过的 `globals/params` 注入（可用一个 `Json` 字段聚合，例如 `globals.meta`），确保进入 `inputsHash`。
  - `inputs._meta` 可以保留为审计/排障字段，但默认不进入 `inputsHash`。

实现形态建议（MVP 选最轻的）：
- **共享 SDK / NestJS Module**：业务模块直接调用一个 Provider 接口，由它负责拼装 `inputs` 并发布 MQ job（推荐起步）。
- **独立微服务**：业务模块只发“最小请求”，由该服务拼装 inputs 并代发 job（更集中治理，但会引入额外服务与依赖）。

---

## 总体架构与数据流

### A) 定义发布（Definition Draft → Publish）
1. Editor/管理端通过 **HTTP Admin API** 创建/更新 draft（draft CRUD）。
2. （可选）调用 `validate` / `dry-run` 做静态校验与预览。
3. 调用 `publish` 发布生成一个不可变 Release；引擎写入 DB：Definition + Release（append-only），生成 `definitionHash`。

### B) 计算任务（Job Requested → Job Succeeded/Failed）
1. 调用方通过 Inputs Provider 构造 `inputs`，并发送命令：`compute.job.requested.v1`（指定 `definitionId+definitionHash`）。
2. 引擎：
   - 幂等：按 `jobId` 去重（`jobId` 是平台级唯一键）。
   - 读取 Definition Release → 校验 inputs 符合 `globals + entrypoint.params` 契约 → 生成 inputsSnapshot（应用 default）→ Canonicalize → 计算 `inputsHash` → Runner 执行（控制流 + 表达式）→ 生成 `outputs` 与 `outputsHash`。
   - 事务内写 `job`（建议作为必选，用于幂等/追溯）+ 写 `outbox`（PENDING）。
3. Outbox dispatcher：
   - 拉取 PENDING/FAILED，`SKIP LOCKED` 抢锁。
   - RabbitMQ confirm 发布 `compute.job.succeeded.v1` / `compute.job.failed.v1`。
   - broker ack 后标记 SENT；失败记录错误并退避重试。
4. 调用方消费结果事件（各自实现 Inbox 幂等）并更新投影。

---

## 数据模型（建议）

> 单租户当前假设：不引入 `tenantId` 字段；未来做多租户时再把 `tenantId` 加入主键/唯一约束与消息体。

### 1) Definition / Release（不可变发布物、可追溯）
- `definitionId`：稳定标识（字符串/UUID 均可；建议字符串可读，如 `pricing.retail`，但引擎不解释它的语义）。
- `definitionHash`：对（BlueprintGraph + 关键执行配置）计算 hash，用于确定性与对账；也是 Release 的不可变标识。
- `status`：`published | deprecated`（draft 存在于 `definition_drafts`，不是 Release）。
- `changelog`、`publishedAt/publishedBy`：审计信息。
- `latestDefinitionHash`：指向当前最新发布物（可选指针，便于 UI/运维）。
- **约束**：`definitionHash` 唯一；Release 发布后不可变；如需改动必须再次 publish 生成新 `definitionHash`。

### 2) Job（建议作为必选）
- `jobId`：全局唯一（UUID/ULID），建议由调用方生成。
- `definitionId`、`definitionHashRequested`、`definitionHashUsed`：强制记录实际使用的发布物（用于对账/回放）。
- `inputsHash`、`outputsHash`：用于对账与语义去重（结果事件中建议必带；`jobs` 表建议持久化）。
- `status`：`requested | running | succeeded | failed`。
- `requestedAt/computedAt`、`correlationId/traceId`：链路追踪。

### 3) Inbox / Outbox（可靠性）
- `inbox`：唯一键 `jobId`（或直接用 `jobs.job_id` 唯一约束实现幂等）。
- `outbox`：记录待发布事件（payload + headers + 状态 + nextRetryAt + lockedAt/lockedBy）。

---

## RabbitMQ 契约（平台级、固定，仅用于 Job）

### Exchange / DLX（建议）
- 命令 Exchange（topic, durable）：`compute.commands`
- 事件 Exchange（topic, durable）：`compute.events`
- 死信 Exchange（topic, durable）：`compute.dlx`

> 也可以统一接入你们现有的总线（如 `erp.domain.events`），但建议引擎先用独立 exchange，降低耦合与运维风险。

### RoutingKey（含版本）
- 格式：`compute.{category}.{name}.v{schemaVersion}`
- 示例：
  - `compute.job.requested.v1`
  - `compute.job.succeeded.v1`
  - `compute.job.failed.v1`

### 统一消息字段（建议）
- RabbitMQ `messageId`：用于链路追踪/排障（建议由发送方生成 UUID/ULID；但**幂等以 `jobId` 为准**）。
- `correlationId`：把一次业务操作串起来（可选但建议）。
- `schemaVersion`：消息体 schema 版本（与 routingKey 的 `v1` 保持一致）。

### 命令：`compute.job.requested.v1`（开始计算）
- payload（示意）：
  - `schemaVersion`
  - `jobId`
  - `definitionRef`: `{ definitionId: string, definitionHash: string }`
  - `entrypointKey?`: string（默认 `main`）
  - `inputs`: `{ [key: string]: unknown }`
  - `options?`: `{ decimal?: { precision?: number, roundingMode?: string } }`（执行覆盖项；会进入 `inputsHash`）

### 事件：`compute.job.succeeded.v1`
- payload（建议字段）：
  - `schemaVersion`
  - `jobId`
  - `definitionRefUsed`: `{ definitionId: string, definitionHash: string }`
  - `inputsHash`
  - `outputs`: `{ [key: string]: unknown }`
  - `outputsHash`
  - `computedAt`

### 事件：`compute.job.failed.v1`
- payload（建议字段）：
  - `schemaVersion`
  - `jobId`
  - `definitionRefUsed`: `{ definitionId: string, definitionHash: string }`
  - `inputsHash?`
  - `error`: `{ code: string, message: string, details?: unknown }`
  - `retryable`: boolean
  - `failedAt`

---

## Definition 内容（DSL / Graph）建议

> 引擎只把 Definition 当“数据”，但为了可维护性与安全性，仍需要在“发布前”做静态校验与约束。

### Graph JSON（示意）
- `globals/entrypoints.params`：输入契约（强类型、是否必填、默认值、约束、说明）。
- `locals`：图内局部变量声明（可变状态；用于循环/状态机）。
- `resolvers?`：可选的“输入物化（materialization）”声明（由 Inputs Provider 执行，例如 HTTP 拉取/格式转换）；Compute Engine 本身不执行任何 IO。
- `nodes/edges`：表达式节点与 value 连线（value 层必须 DAG）。
- `execEdges`：控制流连线（允许环；用于 loop）。
- `outputs`：输出声明（`key`、类型、舍入/精度）。
- `metadata?`：纯展示/审计用途（如节点坐标、分组、说明等），不参与执行语义与 `definitionHash`。

> `runnerConfig` 是 Release 的独立字段（不放在 graph content 里），见 `API_DESIGN.md` / `GRAPH_SCHEMA.md` / `HASHING_SPEC.md`。

### Inputs 构造与注入（Inputs Provider → Compute Engine）
> 目标：Runner 仍然纯函数，但我们仍然需要“全局取值/HTTP 取值”。推荐把这些 IO 放在 **Inputs Provider（调用方注入）** 中完成，然后把最终的 inputs 随 job 一起发送给 Compute Engine；引擎只负责校验/规范化/hash/执行。

推荐的注入顺序（以“调用方注入”为主）：
1. **Gather Facts**：Inputs Provider 从各业务模块拉取/读取所需 facts（如汇率、公司配置、对象事实等）。
2. **Build Inputs**：构造 job payload 的 `inputs.globals` 与 `inputs.params`（允许携带额外字段，但引擎默认忽略未声明字段）。
3. **Resolvers（可选）**：如必须走 HTTP/外部 API，Inputs Provider 在发送 job 前完成，并把会影响计算的结果写入声明字段（`inputs.globals/inputs.params`；可用 `Json` 聚合）。
4. **Meta（强烈建议）**：把关键来源信息也写入声明字段（例如 `globals.meta: Json` 或拆成多个强类型字段），确保进入 `inputsHash`；`inputs._meta` 可作为审计字段保留。
5. **Compute Engine 侧 Defaults + Canonicalize + Hash**：引擎按 `globals + entrypoint.params` 应用默认值生成 inputsSnapshot，再对其做规范化（Decimal/Ratio/DateTime 等）并计算 `inputsHash`，然后执行 Runner。

关键约束：
- **Runner 只读 `canonicalizedInputs`**，不允许访问进程环境、当前时间、外部服务。
- **任何可能影响结果的值**必须通过声明的 `globals/params` 注入，从而进入 `inputsHash` 并可在 Job 中回放；未声明字段允许存在但默认不可读、也不进入 `inputsHash`。

### 全局变量（来自业务模块的 Facts）怎么让所有图访问
先澄清：汇率、公司名称/配置等属于业务模块的数据；Compute Engine 不应该把自己变成这些数据的“权威来源”。你想要“所有图都能访问”，本质是需要一个**统一的注入入口与命名空间**，而不是让引擎在运行时到处拉取。

推荐两种方式（都算“注入”，只是注入发生的位置不同）：

**A) 调用方注入（最简单、最解耦）**
- 调用方（或一个共享 SDK）从货币模块/公司模块读取 facts，把值放进 job 的 `inputs`（例如 `inputs.globals.fx_rates`、`inputs.globals.company`）。
- 优点：Compute Engine 更纯（除 Definition/Job/outbox 外不需要额外 facts 存储）；Job 的 `inputsHash` 天然就绑定了“当时用了哪些值”，便于追溯/回放。
- 缺点：每个调用方都要做一遍拼装（通常用 SDK/网关解决）；job 消息会更大。

**B) Engine 侧 Facts Cache（可选扩展）**
- 事实拥有者模块把快照推送到 Compute Engine，由引擎缓存并在运行时注入（可减少 job 体积/减少重复拉取）。
- 这需要额外的数据模型与消息契约（例如 `compute.context.*` + job 增补字段）；建议作为后续扩展实现，避免把 MVP 做重。

关于你提到的“为什么会有 v1/v2”：
- 如果走 A（调用方注入），通常**不需要**把“全局变量再做 v1/v2”——因为 job 的 `inputs` 本身就是一次不可变快照。
- 如果走 B（引擎缓存快照），版本号只是“快照 revision”，目的是对账/回放时能精确定位“用了哪次汇率/配置”，并不意味着这些 facts 变成了引擎内部业务。

### “HTTP 块”建议：做成 Inputs Provider Resolver，而不是 Runner 节点
HTTP 很诱人，但把 HTTP 做成 Runner 节点会把系统变成“工作流引擎”（不可控的时序、失败重试、外部副作用、不可确定性）。

推荐折中：**HTTP 只允许出现在 Inputs Provider 的 resolvers（物化层）**，用于把外部 facts 拉取成 inputs，然后再进入纯 Runner 计算。

MVP 约束建议：
- 仅允许 `GET` + `JSON`（或 `text`），严格的域名 allowlist。
- 超时/重试/限流/响应大小上限；失败时 job 直接 failed（`retryable` 由策略决定）。
- resolver 输出必须落库（或至少输出 hash），并进入 `inputsHash`，保证可追溯与可回放。
  - 回放模式下使用已记录的 resolver 输出，不再发真实 HTTP。

### Runner 约束（MVP）
- 纯函数：不得访问 DB/HTTP；所有输入从 `canonicalizedInputs` 注入。
- 节点白名单（MVP，建议分组）：
  - 基础：Const、Inputs（globals/params）、Flow、Locals（get/set）
  - 数值：Add/Sub/Mul/Div、Min/Max、Clamp、Abs
  - 逻辑：Compare、If、And/Or/Not
  - 舍入：Round（建议支持 mode/scale，且计入 `definitionHash` 或 `inputsHash`）
- 类型系统：至少区分 `Decimal`、`Ratio(0..1)`、`Boolean`、`String` 等，禁止错误连线。
- 精度与舍入：统一在 Round/Output 节点处理；后端推荐继续使用 `decimal.js`（或同等级 decimal 库）。

> 类型系统的具体 `valueType` 规范（含 JSON 表达与校验规则）见 `VALUE_TYPES.md`。

---

## 编辑器（Definition Studio / Editor，由集成方实现）

### 定位
- 由集成方/业务方实现与维护，用于创建与发布 Definition（draft → release(published) → deprecated）。
- Compute Engine 提供“后端标准与能力”（Node Catalog / Definition Admin API / validate / dry-run），Editor 只需要对接这些能力即可。
- Editor 不负责 facts 获取；输入的“来源与解析”由 Inputs Provider（或调用方）实现，Editor 只面向“输入契约（globals/entrypoints.params）”与图结构。

### 核心能力（建议 MVP）
- **节点与连线编辑**：基于 Node Catalog 的节点库，拖拽建图；支持 value 连线与 exec 连线；连线时做类型校验。
- **输入契约编辑**：编辑 `globals` 与 `entrypoints.params`（强类型、default、约束）；调用方触发时把值放进 `inputs.globals/inputs.params`。
- **静态校验**：value 层 DAG/拓扑、必填输入、类型/范围/约束匹配、白名单节点、输出声明完整性；exec 层只校验端口合法性（允许 loop）。
- **预览（Preview）**：用样例 `inputs` 在本地 runner（或引擎 dry-run）计算 outputs；预览只接受 inputs，不触发任何外部 IO。
- **发布物与审计**：changelog、diff、回滚到旧 release（按 definitionHash）、弃用（deprecated）。

### Compute Engine 对 Editor 的后端标准（建议提供）
> 目标：让集成方无需理解引擎内部实现，也能自己做 Editor。
- **Node Catalog**：获取节点/端口/参数 schema/类型规则（只读 API 或代码包）。
- **Definition Admin API**：draft CRUD、publish/deprecate、获取 release 列表与详情。
- **Validate API**：返回可机读的校验错误（用于编辑器实时提示）。
- **Dry-run API（可选但建议）**：给定 `definition + inputs` 返回 outputs（不落库、不发 MQ），用于编辑器预览。

### Node Catalog（节点目录）
- 由 Compute Engine 提供一个“节点目录”（可以是代码包或一个只读 API）：包含节点的 ports、类型、可配置参数、校验规则与文档。
- 编辑器必须只允许选择“引擎支持的节点”，避免产生引擎无法执行的 Definition。

### Inputs Catalog（输入目录，可选）
- 由 Inputs Provider（集成方）提供一份“输入目录”（names + types + docs + 示例），供编辑器做选择/提示/校验。
- 引擎在运行时只验证 job payload 的 `inputs.globals/inputs.params` 是否满足 Definition 的 `globals/entrypoints.params`；未声明字段允许存在但默认不可读、也不进入 `inputsHash`。

### 技术实现建议
- 前端可选：Rete.js / React Flow / 自研画布；优先选生态成熟、可维护的方案。
- 后端建议提供 Admin API（HTTP）给编辑器使用：draft CRUD、publish、validate、dry-run（可选）。

---

## Outbox / Inbox（可靠性与幂等）

### 为什么需要 Outbox
- 解决“DB 事务成功但消息未发出”或“消息发出但 DB 回滚”的一致性问题。
- 保证 `job.succeeded/failed` 在异常/重启/网络抖动时不丢。

### Outbox 写入时机（关键约束）
- 与 `job` 状态落库（以及可选 outputs 存档）**同一事务写入**：
  - 要么都写入成功
  - 要么都回滚

### Inbox 幂等（引擎侧）
- 以 `jobId` 为唯一键（推荐在 `jobs.job_id` 上做唯一约束）：
  - 已处理：直接 ack，避免重复执行与重复发布结果。
  - 未处理：事务内插入 `job`（或 inbox）→ 执行/写 job/outbox → 提交。

### 失败策略（MVP）
- **不可恢复/毒消息**（无法解析 `jobId` 的非法 payload、jobId 冲突且 payload 不一致）：`reject(requeue=false)` → DLQ。
- **协议错误但可定位 job**（能解析 `jobId`，但 schema/字段不满足契约）：写 `job.failed`（`error.code=INVALID_MESSAGE`，`retryable=false`）并 ack。
- **业务校验失败**（缺必填/类型不匹配/图不可执行）：写 `job.failed`（`retryable=false`）并 ack。
- **基础设施瞬断**（DB 不可用、Outbox 写入失败等）：不 ack（或 `nack(requeue=true)`）让消息重投；依赖 `jobId` 幂等保证不会重复执行。

---

## 风险与控制点（CTO 关注）

### 1) 历史一致性与对账
- 必须记录 `definitionHashUsed/inputsHash`（以及 entrypointKey/runnerConfig），避免“升级口径污染历史”。
- 若需要严格回放：将 `effectiveInputs`（或其冷存储引用）与 `outputs` 持久化到 job 记录中。
- 历史数据体量控制：建议对 `jobs/outbox/drafts` 设计 TTL/归档与自动清理（见 `BACKEND_GUIDE.md` 第 7 节）。

### 2) 类型/约束系统缺失导致隐性错误
- 发布前必须做静态校验：类型不匹配直接拒绝发布；并对关键节点做范围校验（如 Ratio 0..1）。

### 3) 运维复杂度（Outbox + MQ）
- DLQ 必须可观测（告警/面板/回放工具）。
- dispatcher 需要指标：pending/failed 数量、重试次数、端到端延迟、publish confirm 延迟。

### 4) Definition 治理
- 发布流程：draft → published → deprecated。
- 权限：限制谁能发布（避免业务误操作）；发布强制填 changelog。

---

## 里程碑（MVP 建议）
1. Runner Core + Node Catalog（白名单节点 + 类型/约束 + decimal 精度与舍入）。
2. Compute Engine 服务骨架（DB：Definition draft/publish → Release（definitionHash））。
3. RabbitMQ Job 链路（consumer + publisher confirm + Outbox/Inbox + `job.succeeded/failed`）。
4. Inputs Provider 规范与参考实现（`inputs.globals/inputs.params` 约定 + canonicalize 规则 + 多余字段策略）。
5. Editor 后端标准（Definition Admin API + validate + dry-run + OpenAPI/Schema），供集成方自定义 UI。
6. 一个业务集成样板：Provider 注入 `inputs` → 发 `job.requested` → 收结果事件并落读模型（含 Inbox 幂等）。
