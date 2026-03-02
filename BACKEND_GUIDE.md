# Compute Engine 后端文档（实现与运维约定）

> 项目执行里程碑与任务拆解见：`BACKEND_EXECUTION.md`。

## 1. 技术栈（建议）
- 语言：TypeScript
- 运行时：Node.js（LTS）
- 框架：NestJS
- 数据库：PostgreSQL
- ORM：TypeORM（与现有 ERP 风格一致）
- MQ：RabbitMQ（默认适配器，`amqplib` confirm channel；通过 Ports 抽象可替换 Kafka/NATS 等）
- 精度：`decimal.js`（或同等级 decimal 库）

> 如果后续需要极致性能/并发，可替换实现语言/运行时，但必须保持：Definition 版本不可变、输入规范化与 hash 算法一致、节点语义兼容。

---

## 2. 架构（DDD + 六边形 / Ports & Adapters）

### 2.1 分层与边界
> 目标：引擎核心不依赖 MQ/DB/框架细节，未来替换事件系统（RabbitMQ → Kafka/NATS/HTTP 等）只需要新增适配器。

- **Domain（领域层）**
  - 纯业务规则与不变性：Definition（draft/release）、Job（执行与状态）、值对象（hash、时间等）。
  - 不引用 NestJS/TypeORM/amqplib 等基础设施依赖。
- **Application（应用层）**
  - 用例编排：UpsertDraft、Validate、DryRun、Publish、ExecuteJob、OutboxDispatch 等。
  - 通过 ports 调用外部世界（DB、MQ、时钟、hash、runner）。
- **Ports（端口层）**
  - 对外依赖的接口定义（outbound ports）：Repository、MessageBus、Clock、Hasher、Runner、IdGenerator 等。
  - 入口接口定义（inbound ports）：UseCase interfaces（供 HTTP/MQ handler 调用）。
- **Adapters（适配器层）**
  - Inbound：HTTP Admin Controller、MQ Consumer、Scheduler/Worker（Outbox dispatcher）。
  - Outbound：Postgres/TypeORM repositories、RabbitMQ publisher/consumer、metrics/logging 等。

### 2.2 推荐目录结构（示意）
> 仅是建议，不强制；关键是依赖方向：`domain → application → ports ← adapters`。

```text
src/
  domain/
    definition/
    job/
    value-objects/
  application/
    use-cases/
    ports/
  adapters/
    inbound/
      http/
      mq/
      scheduler/
    outbound/
      db/
      mq/
  shared/
```

### 2.3 关键 Ports（示例）
- `DefinitionDraftRepositoryPort`：读写 draft（用于编辑与发布前校验/预览）。
- `DefinitionReleaseRepositoryPort`：读写 releases（append-only，以 `definitionHash` 标识不可变发布物）。
- `JobRepositoryPort`：落库 job（**建议作为 MQ 执行链路的必选项**，用于 `jobId` 幂等与回放）。
- `InboxRepositoryPort`：可选（用于去重“消息投递”，但 `compute.job.requested.v1` 推荐直接以 `jobs.job_id` 唯一约束实现幂等）。
- `OutboxRepositoryPort`：写入/拉取/锁定 outbox 记录。
- `MessageBusPort`：发布/消费消息（Transport-agnostic）。
  - RabbitMQ/Kafka/NATS 等差异只存在于适配器实现。
- `RunnerPort`：执行冻结 Definition（纯计算）。
- `HasherPort`：`definitionHash / inputsHash / outputsHash`。
- `ClockPort`：获取时间（用于 computedAt / failedAt）。

### 2.4 兼容更多事件系统（关键策略）
- **引擎内部统一使用“消息信封（envelope）”结构**（与 transport 解耦）：
  - `messageId`, `correlationId`, `type`, `schemaVersion`, `occurredAt`, `headers`, `payload`
- **MQ 适配器负责映射**：
  - RabbitMQ：`exchange + routingKey + headers`，confirm ack 决定 outbox `SENT`
  - Kafka：`topic + key + headers`，producer ack 决定 outbox `SENT`
  - NATS：`subject + headers`，ack 策略由适配器决定
- **Outbox/Inbox 保持不变**：一致性/幂等策略不随 transport 改变。

---

## 3. 服务职责
- 存储 Definition draft/published releases（发布后不可变；以 `definitionHash` 精确定位）。
- 对 `compute.job.requested.v1` 做：`jobId` 幂等 → 读取 DefinitionRelease（`definitionId + definitionHash`）→ 校验 inputs → 应用 defaults 得到 effectiveInputs → canonicalize → inputsHash → Runner 执行 → outbox 发布结果事件。
- 提供 Admin API（供集成方 Editor 对接）：draft CRUD、validate、dry-run、publish/deprecate release、release 列表与详情。
- 提供 Node Catalog（API 或包）。

---

## 4. 数据库模型（MVP）

### 4.1 `definitions`
- `definition_id` (PK)
- `latest_definition_hash`（可选：便于 publish 后快速定位 latest）
- `created_at`, `updated_at`

### 4.2 `definition_drafts`
- `definition_id` (PK/FK)
- `draft_revision_id`（ULID/UUID，乐观并发）
- `content_type`
- `content_json`
- `output_schema_json`（可选）
- `runner_config_json`（可选）
- `updated_at`

### 4.3 `definition_releases`
- `definition_hash` (PK)
- `definition_id` (FK)
- `status`（published/deprecated）
- `content_json`（冻结）
- `output_schema_json`（冻结）
- `runner_config_json`（冻结）
- `changelog`
- `published_at`, `published_by?`
- `deprecated_at`, `deprecated_reason`

### 4.4 `jobs`（建议作为必选）
- `job_id` (PK)
- `request_hash`（用于检测“同 jobId 不同 payload”的冲突）
- `message_id?`, `correlation_id?`（追踪用）
- `definition_id`, `definition_hash_used`
- `inputs_hash`, `outputs_hash`
- `status`, `requested_at`, `computed_at`
- `inputs_snapshot_json?`（可选：严格回放/审计用）
- `outputs_json?`（可选：方便运维查询；也可只存 outputsHash）
- `error_code?`, `error_message?`

### 4.5 `inbox`（可选）
> 如果 `compute.job.requested.v1` 已经以 `jobs.job_id` 幂等处理，`inbox` 可以不建。
- `job_id` (PK)
- `received_at`

### 4.6 `outbox`
- `id` (PK)
- `event_type`, `routing_key`, `payload_json`, `headers_json`
- `status`（pending/sent/failed）
- `locked_at`, `locked_by`
- `next_retry_at`, `last_error`, `attempts`
- `created_at`, `updated_at`

---

## 5. 关键实现约束

### 5.1 Definition 发布后不可变
- `publish` 只能从 draft 生成新 release（以 `definitionHash` 标识）。
- 已发布 release 禁止覆盖更新；改动必须发布新 release（append-only）。

### 5.2 Inputs 校验与规范化（canonicalize）
- 校验 `inputs` 是否满足 Definition 的 `globals + entrypoints(params)`（必填、类型、约束）。
- 在计算 `inputsHash` 前应用 defaults（仅对 `required=false` 且缺失的项生效；规则见 `HASHING_SPEC.md`）。
- 将 `Decimal/Ratio/DateTime` 等做规范化后再 hash（保证跨语言/跨环境一致）。
- `inputsHash` 必须包含所有会影响输出的内容（包括 `options`）。

### 5.3 Runner 纯函数
- Runner 不做 DB/HTTP/MQ IO。
- Runner 只依赖 `canonicalizedInputs` 与冻结的 DefinitionRelease（`definitionHash` 对应的发布物）。

### 5.4 MQ 幂等与 ack/nack（落地必须明确）
- **ack 时机**：当且仅当“job 状态 + outbox 事件”已在同一 DB 事务内提交成功后 ack；避免丢结果事件。
- **重复投递**：以 `jobId` 做幂等（推荐 `jobs.job_id` 唯一约束）：
  - 已存在且 request_hash 一致：直接 ack（不得重复执行）。
  - 已存在但 request_hash 不一致：`reject(requeue=false)` → DLQ，并记录 `IDEMPOTENCY_CONFLICT`。
- **错误分类**：
  - `INVALID_MESSAGE`：不可重试；若能解析到 `jobId`，建议写 `job.failed` 后 ack；若无法解析 `jobId`，只能 `reject(requeue=false)` → DLQ。
  - `INPUT_VALIDATION_ERROR`：不可重试（写 `job.failed` 后 ack）。
  - `ENGINE_TEMPORARY_UNAVAILABLE` / `INTERNAL_ERROR`：可重试（不 ack 或 `nack(requeue=true)` 让 MQ 重投；依赖 `jobId` 幂等）。

---

## 6. 可观测性与运维
- 指标：job 执行耗时、成功/失败率、outbox pending/failed 数量、发布延迟（requested→published）。
- 日志：按 `jobId`/`messageId`/`correlationId` 打点；错误要可回溯到 `definitionId+definitionHash(+entrypointKey)` 与 `inputsHash`。
- DLQ：必须可观测与可回放（至少可重投原始 message）。

---

## 7. 历史数据保留与自动清理（Data Retention）

> 目标：在保证“可追溯/可审计/可回放（按需）”的前提下，控制数据库体积与运维成本。

### 7.1 可清理对象（建议）
- **DefinitionReleases**：默认**不自动清理**（append-only；体积通常很小，是追溯的根）。
- **DefinitionDrafts**：可自动清理长时间未更新的草稿（例如 `updated_at` 超过 90 天）。
- **Jobs 元数据**（`jobId/definitionRefUsed/definitionHash/inputsHash/status/timestamps`）：建议保留更久（例如 1~3 年，或按财务/审计要求更长）。
- **Jobs 快照**（`inputs_snapshot_json/outputs_json`，如果你们存了）：建议更短保留或归档到冷存储（例如 30~180 天）。
- **Outbox 已发送（SENT）**：可短期保留（例如 7~30 天）用于排障，之后批量删除。
- **Outbox 失败/待发（FAILED/PENDING）**：不自动删除；应通过告警/回放工具处理后再清理。

### 7.2 幂等与清理的关系（必须考虑）
- 引擎幂等以 `jobId` 为准（见 `API_DESIGN.md`）。
- 如果你选择“用 `jobs` 表作为幂等存根”，则**不能**把 `jobs` 记录清理得太短，否则同一个 `jobId` 的重复投递可能在清理后被当成新任务再次执行。
- 推荐做法（MVP 友好）：
  - `jobs` 元数据保留较长；
  - `inputs_snapshot_json/outputs_json` 按更短 TTL 清理（或转存到对象存储）。

### 7.3 推荐实现（PostgreSQL）
- **分区表（推荐）**：按 `requested_at` 月/周分区 `jobs/outbox`，清理时直接 `DROP PARTITION`（最快、最少膨胀）。
- **批量删除（次选）**：按时间范围分批 `DELETE ... LIMIT ...`（应用侧循环），并配合 autovacuum；避免长事务与大面积锁。

### 7.4 清理任务形态（建议）
- 在 Compute Engine 内新增一个 **Retention Cleaner**（scheduler/worker），周期执行：
  - `purge_sent_outbox(before = now - OUTBOX_SENT_TTL)`
  - `purge_job_snapshots(before = now - JOB_SNAPSHOT_TTL)`
  - `purge_stale_drafts(before = now - DRAFT_TTL)`
  - （可选）`purge_job_metadata(before = now - JOB_METADATA_TTL)`（只在明确允许“超过 TTL 的重复 jobId 可以再次执行”时启用）
- 所有 TTL 做成配置项（env/config），并且默认保守（不删 definitions，不删 job 元数据）。

### 7.5 冷存储（可选，但对“强回放”很有用）
如果你们需要“多年后仍能严格回放某次计算”，但不想 DB 长期存大 JSON：
- 将 `effectiveInputs` 与 `outputs` 作为对象存储附件归档（例如 `s3://compute-engine/jobs/<jobId>.json.gz`）。
- `jobs` 表只保留 `archive_ref`（URI）、hash 与时间戳。
- 回放时：先拉取归档快照，再走 dry-run/离线 runner 对账。
