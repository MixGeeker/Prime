# Compute Engine 后端执行文档（里程碑 / 任务 / 参考文档）

> 本文档是“怎么把文档落地成一个可上线的 Compute Engine 服务”的执行清单。
> 重点是：里程碑拆解、每个里程碑的任务与验收标准，以及每项任务参考哪些设计文档。

## 0. 范围与假设

- 范围：只覆盖 **Compute Engine 后端服务**（不含 Provider/Editor 的实现，只规定对接契约）。
- 当前假设：单租户（不含 `tenantId`）。
- 事件系统：默认 RabbitMQ（但内部通过 `MessageBusPort` 抽象，方便未来替换）。
- 幂等键：以 `jobId` 为准（必须写死）。
- `contentType=graph_json`（历史命名；`content` 实际为 BlueprintGraph，见 `GRAPH_SCHEMA.md`）。

## 1. 参考文档（“真规格”）

实现时以这些文档为准（优先级从上到下）：
1. `COMPUTE_ENGINE_DESIGN.md`（总体边界、Outbox/Inbox、失败策略）
2. `API_DESIGN.md`（HTTP Admin API + MQ 契约 + 错误码）
3. `GRAPH_SCHEMA.md`（BlueprintGraph 结构与 validate 要求；`runnerConfig` 归属）
4. `HASHING_SPEC.md`（`definitionHash/inputsHash/outputsHash` 计算规则）
5. `VALUE_TYPES.md`（类型系统与 canonicalize 规则）
6. `BACKEND_GUIDE.md`（DDD+六边形、数据模型、运维与清理策略）
7. `PROVIDER_GUIDE.md` / `EDITOR_GUIDE.md`（对外接入约束，供联调）

## 2. 里程碑（MVP → 可运营）

> 建议用 2 周为一个迭代单位；下面按“可独立验收”的里程碑拆分。你们也可以按团队节奏合并/拆分。

### 当前进度快照（截至 2026-03-02）

- M0：已完成（5/5）
- M1：已完成（4/4）
- M2：已完成（3/3）
- M3：已完成（6/6）
- M4：已完成（7/7）
- M5：已完成（5/5）
- M6：已完成（5/5）
- M7：已完成（4/4）
- M8：已完成（4/4）
- M9：已完成（3/3）
- M10：已完成（7/7）— 蓝图控制流重构（去版本号）

### M0. 项目骨架与工程规范（可启动）

**目标**
- 服务能跑起来，有基础配置与目录结构，便于后续按 DDD+六边形扩展。

**任务**
- [x] 初始化 NestJS 服务骨架（HTTP + MQ worker 预留）
- [x] 按 `BACKEND_GUIDE.md` 建议落目录：`domain/application/ports/adapters`
- [x] 配置：env 管理（DB/MQ/日志级别/retention TTL）
- [x] 基础端点：`GET /health`、（可选）`GET /ready`
- [x] OpenAPI/Swagger（至少覆盖 Admin API）

**验收标准（DoD）**
- 可本地启动，能连接空 DB（或跳过 DB）并通过健康检查

**参考**
- `BACKEND_GUIDE.md`

---

### M1. 数据库与领域模型（Definition/Job/Outbox）

**目标**
- 把“版本化 Definition + jobId 幂等 + outbox 可靠发布”落到 DB。

**任务**
- [x] 建表/迁移（最少：`definitions/definition_drafts/definition_releases/jobs/outbox`；`inbox` 可选）
- [x] 定义 `jobs.request_hash` 规则（用于检测同 `jobId` 不同 payload）
- [x] Repository adapters（TypeORM）：DraftRepo / ReleaseRepo / JobRepo / OutboxRepo
- [x] 事务边界：`ExecuteJob` 用例里保证 `job + outbox` 同事务提交（MQ ack 时机在 M6 接入 consumer 时实现）

**验收标准（DoD）**
- `publish` 产出不可变 `definition_releases`（append-only，以 `definitionHash` 标识）
- `jobId` 重复投递不会重复执行（基于 `jobs.job_id` 唯一约束 + request_hash）

**参考**
- `BACKEND_GUIDE.md`
- `API_DESIGN.md`（幂等与重复投递）

---

### M2. Graph validate（静态校验）与 Node Catalog 机制

**目标**
- 能对 BlueprintGraph 做结构/拓扑/类型的最小静态校验；并具备 Node Catalog（节点白名单）。

**任务**
- [x] 实现 Graph schema 校验（结构字段、唯一性、DAG、端口合法性、类型兼容）
- [x] Node Catalog（只读 JSON/内置模块 + `GET /catalog/nodes`）
- [x] validate 错误结构化输出：`{ code, severity, path?, message }`

**验收标准（DoD）**
- Editor 按 `validate` 返回能定位到 node/edge/global/param/local 的错误
- 不在 catalog 的 `nodeType` 必须被拒绝发布/执行

**参考**
- `GRAPH_SCHEMA.md`
- `API_DESIGN.md`（Node Catalog、Validate API）
- `VALUE_TYPES.md`

---

### M3. Hashing 与 canonicalize（可对账）

**目标**
- 实现 `definitionHash/inputsHash/outputsHash`，并有可复用的测试向量（golden cases）。

**任务**
- [x] typed canonicalize（Decimal/Ratio/DateTime）
- [x] JCS（RFC 8785）序列化（已用 npm 包 `canonicalize` 落地）
- [x] `definitionHash`：发布时计算；裁剪 `content.metadata/resolvers`；稳定排序（globals/entrypoints/locals/nodes/edges/execEdges/outputs）
- [x] `inputsHash`：覆盖 `entrypointKey + globals + params + job.options`；缺失时应用 default→null；忽略未声明的 inputs 字段
- [x] `outputsHash`：只在成功时计算；失败不产生 outputsHash
- [x] golden cases：至少覆盖（脚本：`backend` 下 `npm run test:hashing`）
  - 同语义不同顺序 → hash 相同（definitionHash）
  - default 生效/不生效 → inputsHash 不同
  - Decimal/Ratio 的规范化一致性

**验收标准（DoD）**
- 同 `definitionHash + inputsHash` 必须得到同 `outputsHash`（确定性）
- hash 计算有测试向量，未来换语言可对账

**参考**
- `HASHING_SPEC.md`
- `VALUE_TYPES.md`
- `GRAPH_SCHEMA.md`

---

### M4. Admin API（draft/publish/validate/dry-run/job 查询）

**目标**
- 给 Editor/运维提供完整的后端能力：draft 流程 + 校验 + 预览 + 发布 + job 查询。

**任务**
- [x] Draft CRUD：`POST /admin/definitions`、`GET/PUT/DELETE /admin/definitions/:id/draft`
- [x] `POST /admin/definitions/validate`（支持 `definitionRef` 与 inline `definition`）
- [x] `POST /admin/definitions/dry-run`（不落库、不发 MQ）
- [x] `POST /admin/definitions/:id/publish`（生成 Release + 计算 definitionHash）
- [x] `POST /admin/definitions/:id/releases/:definitionHash/deprecate`
- [x] Read：`GET /admin/definitions/:id/releases`、`GET /admin/definitions/:id/releases/:definitionHash`
- [x] 运维查询：`GET /admin/jobs/:jobId`

**验收标准（DoD）**
- draft → validate → dry-run → publish 流程闭环
- publish 后版本不可变（禁止覆盖更新）

**参考**
- `API_DESIGN.md`
- `COMPUTE_ENGINE_DESIGN.md`

---

### M5. Runner 执行（纯函数、确定性）

**目标**
- 能执行已发布 DefinitionRelease（BlueprintGraph / `contentType=graph_json`），产出 outputs，并严格遵守纯函数约束。

**任务**
- [x] RunnerPort（domain/application 只依赖 port）
- [x] 节点执行（按 Node Catalog 白名单），包含最小节点集合：
  - [x] `inputs.globals.*`、`inputs.params.*`、`core.const.*`（按 valueType 拆分）
  - [x] 数值：`math.add/sub/mul/div`
  - [x] 逻辑/比较/if/round（已补齐：`logic.*`、`compare.decimal.*`、`core.if.decimal`、`math.round`）
  - [x] 控制流与状态：`flow.*`、`locals.*`
- [x] 节点实现模块化：每个 nodeType 一个文件；按分类目录组织（`backend/src/application/nodes/**`）；Runner service 仅负责编排
- [x] 执行限制：`runnerConfig.limits`（maxNodes/maxDepth/maxSteps/timeout/maxCallDepth）
- [x] 失败分类：确定性错误 vs 超时/资源错误（映射到 `job.failed.error.code` 与 `retryable`）

**验收标准（DoD）**
- 同输入同输出（可用回归用例验证）
- Runner 不允许任何 IO（DB/HTTP/MQ/系统时间）

**参考**
- `COMPUTE_ENGINE_DESIGN.md`（Runner 约束）
- `VALUE_TYPES.md`
- `API_DESIGN.md`（错误码）

---

### M6. MQ 消费链路（requested → succeeded/failed）

**目标**
- 消费 `compute.job.requested.v1` 并可靠发布结果事件，具备 at-least-once + jobId 幂等。

**任务**
- [x] RabbitMQ consumer（routingKey：`compute.job.requested.v1`）
- [x] 消息解析与校验（无法解析 `jobId` / `definitionRef` → DLQ；其余字段非法 → 写 `job.failed(INVALID_MESSAGE)` 并 ack）
- [x] `jobId` 幂等处理（重复 payload 一致 → 直接 ack；不一致 → DLQ）
- [x] 执行流程：读 DefinitionRelease → validate inputs → defaults → canonicalize → inputsHash → runner → outputsHash
- [x] 事务内写 `jobs + outbox` 后 ack（ack 时机要严格）

**验收标准（DoD）**
- 重复投递不重复执行（且不会重复发结果）
- 宕机/重启不会丢结果事件（依赖 outbox）

**参考**
- `API_DESIGN.md`（MQ 契约、幂等、错误码）
- `COMPUTE_ENGINE_DESIGN.md`（失败策略、Outbox/Inbox）
- `BACKEND_GUIDE.md`（ack/nack 语义）

---

### M7. Outbox dispatcher（confirm + 重试 + 监控）

**目标**
- outbox 能稳定把结果事件发布出去；失败可重试；可观测。

**任务**
- [x] outbox 表锁策略（`SKIP LOCKED` / leased lock）
- [x] publisher confirm（RabbitMQ confirm channel）
- [x] 退避重试：nextRetryAt + attempts + lastError
- [x] 指标：Prometheus `/metrics`（pending/failed、发布耗时、dispatcher lease/发布成功率）

**验收标准（DoD）**
- 模拟 MQ 断开/恢复：pending 能最终发出且不重复

**参考**
- `COMPUTE_ENGINE_DESIGN.md`
- `BACKEND_GUIDE.md`

---

### M8. 运维能力（DLQ 回放 / 可观测性 / 限流）

**目标**
- 能运营：发现问题、定位问题、回放问题、限制资源消耗。

**任务**
- [x] 统一日志字段：关键链路带上 `jobId/messageId/correlationId/definitionRef`（便于对账与定位）
- [x] 关键指标与告警建议：提供 `/metrics`，可基于 outbox backlog / job 失败率 / DLQ 堆积做告警
- [x] DLQ 回放工具：Admin API（受开关+token 保护）回放 `compute.job.requested.v1.dlq`，复用 jobId 幂等
- [x] 资源保护：`MQ_MAX_MESSAGE_BYTES`、DLQ 回放 `DLQ_REPLAY_MAX_LIMIT`、runnerConfig.limits（maxNodes/maxDepth/timeout）

**验收标准（DoD）**
- 出现 DLQ 时有明确流程：定位 → 修复 → 回放 → 对账

**参考**
- `COMPUTE_ENGINE_DESIGN.md`
- `BACKEND_GUIDE.md`

---

### M9. 历史数据保留与自动清理（retention cleaner）

**目标**
- DB 体积可控，同时不破坏 jobId 幂等与追溯。

**任务**
- [x] 明确保留策略配置项（OutboxSentTTL / JobSnapshotTTL / DraftTTL）（`OUTBOX_SENT_TTL_DAYS`、`JOBS_SNAPSHOT_TTL_DAYS`、`DRAFT_TTL_DAYS`）
- [x] Retention Cleaner（定时任务，worker role：maintenance）：
  - [x] 清理 SENT outbox
  - [x] 清理过期 drafts
  - [x] 清空 job 快照（inputs/outputs 大 JSON），不删除 jobs 元数据（不破坏幂等与追溯）
- [x] （可选）分区表策略（jobs/outbox 按月/周）— 暂不做

**验收标准（DoD）**
- 清理不会导致同 jobId 被再次执行（默认不清理 job 元数据）

**参考**
- `BACKEND_GUIDE.md`（第 7 节 retention）

---

### M10. 蓝图控制流（Blueprint）重构（去版本号）

**目标**
- 从“仅 value edges 的 DAG 数据流图（历史称 graphJson）”升级为“真正控制流蓝图”（exec 连线、if/loop/break、locals 状态、子蓝图调用）。
- 对外契约彻底去掉数字版本：以 `definitionHash` 作为不可变发布物标识。
- 同时保持 Runner 的确定性（纯函数）与可对账能力（hash 可重放）。

**任务**
- [x] 去版本化：移除 `definition_versions` / `version_used` / `nodeVersion` / graph `schemaVersion`
- [x] DB 迁移清理重做：引入 `definition_releases`（以 `definitionHash` 标识）+ jobs 记录 `definition_hash_used`
- [x] BlueprintGraph：`globals/entrypoints(params)/locals/execEdges`；value edges 必须 DAG；execEdges 允许环（loop）
- [x] Node Catalog：`nodeType` 全局唯一（不再有 nodeVersion）；新增 `execInputs/execOutputs`
- [x] Runner：控制流解释器（exec token）+ 惰性 value 求值（短路）+ locals store + limits（maxSteps/timeout/maxCallDepth）
- [x] hashing 与 golden cases 更新（definitionHash/inputsHash/outputsHash）+ 文档对齐（API/Schema/Design）
- [x] 子蓝图调用（call_definition）：发布时冻结 callee 为 `definitionHash`；运行期受 `maxCallDepth` 限制

**验收标准（DoD）**
- publish 返回 `definitionHash`；execute/dry-run/MQ 都能按 `{definitionId, definitionHash}` 精确执行。
- Branch 真正短路（未走到的分支不执行）。
- loop 可用且不会卡死 worker（受 `maxSteps/timeoutMs` 限制）。
- locals set/get 正确可用于循环与状态机。
- 子蓝图调用（A 调 B）可运行，且发布后引用冻结为 `definitionHash`。

**参考**
- `API_DESIGN.md`
- `GRAPH_SCHEMA.md`
- `COMPUTE_ENGINE_DESIGN.md`

---

## 3. 最小联调清单（和 Provider/Editor 对上）

- Provider 发 `compute.job.requested.v1`：
  - 必带 `jobId`，重试复用同 jobId
  - 必带 `definitionRef.definitionId + definitionRef.definitionHash`（不再使用 version）
  - 可选 `entrypointKey`（默认 `main`）
  - `inputs` 建议按命名空间组织：`inputs.globals`、`inputs.params`（允许携带多余字段，但引擎只读取声明项）
  - `options` 仅允许 `options.decimal.precision/roundingMode`
- Editor 发布 Definition：
  - `content` 不包含 runnerConfig（runnerConfig 单独字段提交）
  - `content.metadata` 可随便变，不应影响 `definitionHash`
  - 若存在子蓝图调用：publish 时应冻结为 `definitionHash`（避免运行期“latest 漂移”）

参考：
- `PROVIDER_GUIDE.md`
- `EDITOR_GUIDE.md`
- `API_DESIGN.md`

## 4. 交付物清单（最终“可以上线”）

- 一个可部署的 Compute Engine 服务（HTTP Admin API + MQ worker + outbox dispatcher）
- 一套 DB 迁移与运维说明（含 retention 配置与清理任务）
- 一组 hashing golden cases（跨语言对账基础）
- 一份 Node Catalog（API 或包）与 validate 错误码对照表

---

## 5. 内网启用 Runbook（可靠性优先）

### 5.1 推荐部署拓扑（按 Worker 角色拆分）
- HTTP（Admin/Catalog/health/ready/metrics）：`npm run start:prod`
- Consumer Worker（消费 job.requested）：`WORKER_ROLES=consumer npm run start:worker:prod`
- Dispatcher Worker（outbox 发布结果事件）：`WORKER_ROLES=dispatcher npm run start:worker:prod`
- Maintenance Worker（retention cleaner）：`WORKER_ROLES=maintenance npm run start:worker:prod`

> 说明：拆分的收益是故障域隔离（dispatcher 抖动不影响 consumer 吞吐；maintenance 不影响计算）。

### 5.2 探活与就绪（K8s/LB）
- `/health`：只表示进程存活（不探测外部依赖）
- `/ready`：探测 **DB + RabbitMQ** 连通性；失败返回 503，并带上依赖错误与延迟（用于排障）

### 5.3 关键指标（建议告警）
- MQ：`compute_mq_connection_state`（role=consumer/dispatcher 为 0 表示断连）
- MQ：`compute_mq_reconnect_total` 短时间激增（网络抖动/权限/拓扑异常）
- Outbox：`compute_outbox_pending_gauge` 持续上升（发布阻塞/下游不可用）
- Outbox：`compute_outbox_failed_gauge` 上升（发布失败，进入重试）
- Job：`compute_job_failed_total`（按 error_code）与 `compute_job_execution_duration_seconds`

### 5.4 演练清单（上线前必须跑一遍）
1. 正常链路：投递 job → jobs 状态变更 → outbox sent → 下游收到 succeeded/failed
2. MQ 断开 30s 再恢复：consumer/dispatcher 自动恢复（无需重启进程）
3. Worker 重启：重复投递同 jobId 不重复执行（幂等）
4. Dispatcher 在 publish 后崩溃：允许重复事件；下游必须按 `messageId=outbox.id` 去重
