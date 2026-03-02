# Compute Engine 后端执行文档（里程碑 / 任务 / 参考文档）

> 本文档是“怎么把文档落地成一个可上线的 Compute Engine 服务”的执行清单。
> 重点是：里程碑拆解、每个里程碑的任务与验收标准，以及每项任务参考哪些设计文档。

## 0. 范围与假设

- 范围：只覆盖 **Compute Engine 后端服务**（不含 Provider/Editor 的实现，只规定对接契约）。
- 当前假设：单租户（不含 `tenantId`）。
- 事件系统：默认 RabbitMQ（但内部通过 `MessageBusPort` 抽象，方便未来替换）。
- 幂等键：以 `jobId` 为准（必须写死）。
- `contentType=graph_json`（MVP 先落地 graphJson）。

## 1. 参考文档（“真规格”）

实现时以这些文档为准（优先级从上到下）：
1. `compute-engine/COMPUTE_ENGINE_DESIGN.md`（总体边界、Outbox/Inbox、失败策略）
2. `compute-engine/API_DESIGN.md`（HTTP Admin API + MQ 契约 + 错误码）
3. `compute-engine/GRAPH_SCHEMA.md`（graphJson 结构与 validate 要求；`runnerConfig` 归属）
4. `compute-engine/HASHING_SPEC.md`（`definitionHash/inputsHash/outputsHash` 计算规则）
5. `compute-engine/VALUE_TYPES.md`（类型系统与 canonicalize 规则）
6. `compute-engine/BACKEND_GUIDE.md`（DDD+六边形、数据模型、运维与清理策略）
7. `compute-engine/PROVIDER_GUIDE.md` / `compute-engine/EDITOR_GUIDE.md`（对外接入约束，供联调）

## 2. 里程碑（MVP → 可运营）

> 建议用 2 周为一个迭代单位；下面按“可独立验收”的里程碑拆分。你们也可以按团队节奏合并/拆分。

### M0. 项目骨架与工程规范（可启动）

**目标**
- 服务能跑起来，有基础配置与目录结构，便于后续按 DDD+六边形扩展。

**任务**
- [ ] 初始化 NestJS 服务骨架（HTTP + MQ worker 预留）
- [ ] 按 `BACKEND_GUIDE.md` 建议落目录：`domain/application/ports/adapters`
- [ ] 配置：env 管理（DB/MQ/日志级别/retention TTL）
- [ ] 基础端点：`GET /health`、（可选）`GET /ready`
- [ ] OpenAPI/Swagger（至少覆盖 Admin API）

**验收标准（DoD）**
- 可本地启动，能连接空 DB（或跳过 DB）并通过健康检查

**参考**
- `compute-engine/BACKEND_GUIDE.md`

---

### M1. 数据库与领域模型（Definition/Job/Outbox）

**目标**
- 把“版本化 Definition + jobId 幂等 + outbox 可靠发布”落到 DB。

**任务**
- [ ] 建表/迁移（最少：`definitions/definition_drafts/definition_versions/jobs/outbox`；`inbox` 可选）
- [ ] 定义 `jobs.request_hash` 规则（用于检测同 `jobId` 不同 payload）
- [ ] Repository adapters（TypeORM）：DraftRepo / VersionRepo / JobRepo / OutboxRepo
- [ ] 事务边界：`ExecuteJob` 用例里保证 `job + outbox` 同事务提交后才能 ack

**验收标准（DoD）**
- `publish` 产出不可变 `definition_versions`（append-only）
- `jobId` 重复投递不会重复执行（基于 `jobs.job_id` 唯一约束 + request_hash）

**参考**
- `compute-engine/BACKEND_GUIDE.md`
- `compute-engine/API_DESIGN.md`（幂等与重复投递）

---

### M2. Graph validate（静态校验）与 Node Catalog 机制

**目标**
- 能对 graphJson 做结构/拓扑/类型的最小静态校验；并具备 Node Catalog（节点白名单）。

**任务**
- [ ] 实现 Graph schema 校验（结构字段、唯一性、DAG、端口合法性、类型兼容）
- [ ] Node Catalog（只读 JSON/内置模块 + `GET /catalog/nodes`）
- [ ] validate 错误结构化输出：`{ code, severity, path?, message }`

**验收标准（DoD）**
- Editor 按 `validate` 返回能定位到 node/edge/variable 的错误
- 不在 catalog 的 `nodeType@version` 必须被拒绝发布/执行

**参考**
- `compute-engine/GRAPH_SCHEMA.md`
- `compute-engine/API_DESIGN.md`（Node Catalog、Validate API）
- `compute-engine/VALUE_TYPES.md`

---

### M3. Hashing 与 canonicalize（可对账）

**目标**
- 实现 `definitionHash/inputsHash/outputsHash`，并有可复用的测试向量（golden cases）。

**任务**
- [ ] typed canonicalize（Decimal/Ratio/DateTime）
- [ ] JCS（RFC 8785）序列化
- [ ] `definitionHash`：发布时计算；裁剪 `content.metadata/resolvers`；稳定排序（variables/nodes/edges/outputs）
- [ ] `inputsHash`：按 variables.path 全量覆盖；缺失时应用 default；并纳入 `job.options`
- [ ] `outputsHash`：只在成功时计算；失败不产生 outputsHash
- [ ] golden cases：至少覆盖
  - 同语义不同顺序 → hash 相同（definitionHash）
  - default 生效/不生效 → inputsHash 不同
  - Decimal/Ratio 的规范化一致性

**验收标准（DoD）**
- 同 `definitionHash + inputsHash` 必须得到同 `outputsHash`（确定性）
- hash 计算有测试向量，未来换语言可对账

**参考**
- `compute-engine/HASHING_SPEC.md`
- `compute-engine/VALUE_TYPES.md`
- `compute-engine/GRAPH_SCHEMA.md`

---

### M4. Admin API（draft/publish/validate/dry-run/job 查询）

**目标**
- 给 Editor/运维提供完整的后端能力：draft 流程 + 校验 + 预览 + 发布 + job 查询。

**任务**
- [ ] Draft CRUD：`POST/GET/PUT/DELETE /admin/definitions/:id/draft`
- [ ] `POST /admin/definitions/validate`
- [ ] `POST /admin/definitions/dry-run`（不落库、不发 MQ）
- [ ] `POST /admin/definitions/:id/publish`（生成 vN + 计算 definitionHash）
- [ ] `POST /admin/definitions/:id/versions/:version/deprecate`
- [ ] Read：`GET /admin/definitions/:id/versions`、`GET /admin/definitions/:id/versions/:version`
- [ ] 运维查询：`GET /admin/jobs/:jobId`

**验收标准（DoD）**
- draft → validate → dry-run → publish 流程闭环
- publish 后版本不可变（禁止覆盖更新）

**参考**
- `compute-engine/API_DESIGN.md`
- `compute-engine/COMPUTE_ENGINE_DESIGN.md`

---

### M5. Runner 执行（纯函数、确定性）

**目标**
- 能执行已发布 DefinitionVersion（graphJson），产出 outputs，并严格遵守纯函数约束。

**任务**
- [ ] RunnerPort（domain/application 只依赖 port）
- [ ] 节点执行（按 Node Catalog 白名单），包含最小节点集合：
  - `core.var.*@1`、`core.const.*@1`（按 valueType 拆分）
  - 数值/逻辑/比较/if/round
- [ ] 执行限制：`runnerConfig.limits`（maxNodes/maxDepth/timeout）
- [ ] 失败分类：确定性错误 vs 超时/资源错误（映射到 `job.failed.error.code` 与 `retryable`）

**验收标准（DoD）**
- 同输入同输出（可用回归用例验证）
- Runner 不允许任何 IO（DB/HTTP/MQ/系统时间）

**参考**
- `compute-engine/COMPUTE_ENGINE_DESIGN.md`（Runner 约束）
- `compute-engine/VALUE_TYPES.md`
- `compute-engine/API_DESIGN.md`（错误码）

---

### M6. MQ 消费链路（requested → succeeded/failed）

**目标**
- 消费 `compute.job.requested.v1` 并可靠发布结果事件，具备 at-least-once + jobId 幂等。

**任务**
- [ ] RabbitMQ consumer（routingKey：`compute.job.requested.v1`）
- [ ] 消息解析与校验（无法解析 jobId → DLQ；可解析但非法 → 写 `job.failed(INVALID_MESSAGE)` 并 ack）
- [ ] `jobId` 幂等处理（重复 payload 一致 → 直接 ack；不一致 → DLQ）
- [ ] 执行流程：读 DefinitionVersion → validate inputs → defaults → canonicalize → inputsHash → runner → outputsHash
- [ ] 事务内写 `jobs + outbox` 后 ack（ack 时机要严格）

**验收标准（DoD）**
- 重复投递不重复执行（且不会重复发结果）
- 宕机/重启不会丢结果事件（依赖 outbox）

**参考**
- `compute-engine/API_DESIGN.md`（MQ 契约、幂等、错误码）
- `compute-engine/COMPUTE_ENGINE_DESIGN.md`（失败策略、Outbox/Inbox）
- `compute-engine/BACKEND_GUIDE.md`（ack/nack 语义）

---

### M7. Outbox dispatcher（confirm + 重试 + 监控）

**目标**
- outbox 能稳定把结果事件发布出去；失败可重试；可观测。

**任务**
- [ ] outbox 表锁策略（`SKIP LOCKED` / leased lock）
- [ ] publisher confirm（RabbitMQ confirm channel）
- [ ] 退避重试：nextRetryAt + attempts + lastError
- [ ] 指标：pending/failed、confirm 延迟、发布耗时

**验收标准（DoD）**
- 模拟 MQ 断开/恢复：pending 能最终发出且不重复

**参考**
- `compute-engine/COMPUTE_ENGINE_DESIGN.md`
- `compute-engine/BACKEND_GUIDE.md`

---

### M8. 运维能力（DLQ 回放 / 可观测性 / 限流）

**目标**
- 能运营：发现问题、定位问题、回放问题、限制资源消耗。

**任务**
- [ ] 统一日志字段：`jobId/messageId/correlationId/definitionRef/inputsHash`
- [ ] 关键指标与告警建议（job 失败率、DLQ 堆积、outbox 堆积）
- [ ] DLQ 回放工具（最小可用：脚本/管理端点；必须防止重复执行 → 复用 jobId）
- [ ] 资源保护：并发度、timeout、max payload size、max graph size

**验收标准（DoD）**
- 出现 DLQ 时有明确流程：定位 → 修复 → 回放 → 对账

**参考**
- `compute-engine/COMPUTE_ENGINE_DESIGN.md`
- `compute-engine/BACKEND_GUIDE.md`

---

### M9. 历史数据保留与自动清理（retention cleaner）

**目标**
- DB 体积可控，同时不破坏 jobId 幂等与追溯。

**任务**
- [ ] 明确保留策略配置项（OutboxSentTTL / JobSnapshotTTL / DraftTTL / JobMetadataTTL）
- [ ] Retention Cleaner（定时任务）：
  - 清理 SENT outbox
  - 清理过期 drafts
  - 清理 job 快照（如存了 inputs/outputs 大 JSON）
- [ ] （可选）分区表策略（jobs/outbox 按月/周）

**验收标准（DoD）**
- 清理不会导致同 jobId 被再次执行（默认不清理 job 元数据）

**参考**
- `compute-engine/BACKEND_GUIDE.md`（第 7 节 retention）

---

## 3. 最小联调清单（和 Provider/Editor 对上）

- Provider 发 `compute.job.requested.v1`：
  - 必带 `jobId`，重试复用同 jobId
  - `options` 仅允许 `options.decimal.precision/roundingMode`
- Editor 发布 Definition：
  - `content` 不包含 runnerConfig（runnerConfig 单独字段提交）
  - `content.metadata` 可随便变，不应影响 `definitionHash`

参考：
- `compute-engine/PROVIDER_GUIDE.md`
- `compute-engine/EDITOR_GUIDE.md`
- `compute-engine/API_DESIGN.md`

## 4. 交付物清单（最终“可以上线”）

- 一个可部署的 Compute Engine 服务（HTTP Admin API + MQ worker + outbox dispatcher）
- 一套 DB 迁移与运维说明（含 retention 配置与清理任务）
- 一组 hashing golden cases（跨语言对账基础）
- 一份 Node Catalog（API 或包）与 validate 错误码对照表
