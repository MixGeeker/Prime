# Compute Engine Backend（计算引擎后端）

本服务是 **Compute Engine** 的后端实现：提供 **Definition 管理（draft/publish）**、**BlueprintGraph 校验/预览（dry-run）**、以及 **MQ 执行链路（幂等 + Outbox 可靠发布结果事件）**。

- 里程碑/验收清单：`../doc/BACKEND_EXECUTION.md`
- 对外契约：`../doc/API_DESIGN.md`
- 图结构/DSL：`../doc/GRAPH_SCHEMA.md`
- Hash 规范：`../doc/HASHING_SPEC.md`

---

## 解决的问题

- **把计算逻辑从代码里抽出来**：计算规则以 Definition（蓝图）形式管理与发布，发布物不可变（以 `definitionHash` 标识）。
- **确定性与可对账**：相同 `definitionHash + inputsHash` 必须得到相同输出（`outputsHash`），便于追溯与回放。
- **可靠执行与可靠出站**：消费 `compute.job.requested.v1`，落库 `jobs + outbox` 后 ack；Outbox dispatcher confirm 发布结果事件并重试。
- **幂等与抗重投**：以 `jobId` 为幂等键；重复投递不会重复执行；冲突（同 jobId 不同 payload）进入 DLQ。

---

## 前置要求

- Node.js >= 18（推荐 20+）+ npm
- PostgreSQL（必须）：用于 definitions/jobs/outbox
- RabbitMQ（建议/生产必须）：用于消费 job 与发布结果事件

> 全部配置项见 `.env.example`；环境变量会经过 `src/config/env.validation.ts` 校验。

---

## 使用方式（本地开发）

### 1) 安装依赖与配置

```bash
cd backend
npm ci
cp .env.example .env
```

### 2) 初始化数据库（跑迁移）

```bash
npm run migration:run
```

### 3) 启动 HTTP（Admin/Catalog/Health）

```bash
npm run start:dev
```

- Health：`GET /health`
- Ready（真实探测 DB + MQ，不就绪返回 503）：`GET /ready`
- Swagger UI：`GET /docs`
- Node Catalog：`GET /catalog/nodes`
- Metrics（可选）：`GET /metrics`（HTTP 进程；由 `METRICS_ENABLED` 控制）

### 4) 启动 Worker（Consumer/Dispatcher/Maintenance）

Worker 是独立进程（ApplicationContext），通过 `WORKER_ROLES` 控制启用能力：

- `consumer`：消费 `compute.job.requested.v1` → 执行 → 事务内写 `jobs + outbox` → ack
- `dispatcher`：轮询 outbox → confirm publish 结果事件 → 失败退避重试
- `maintenance`：retention cleaner（清理 sent outbox、清空 jobs 大快照、删除过期 drafts）

示例（开发环境）：

```bash
# macOS/Linux（bash/zsh）
WORKER_ROLES=consumer npm run start:worker
WORKER_ROLES=dispatcher npm run start:worker
WORKER_ROLES=maintenance npm run start:worker

# Windows（PowerShell）
$env:WORKER_ROLES="consumer"; npm run start:worker
$env:WORKER_ROLES="dispatcher"; npm run start:worker
$env:WORKER_ROLES="maintenance"; npm run start:worker
```

> Worker metrics（包含 job/outbox/MQ 等 worker 指标）默认由 `WORKER_METRICS_ENABLED` 控制是否启用；启用后由 `WORKER_METRICS_PORT` / `METRICS_PATH` 控制访问地址（若同机跑多个 worker，建议关闭或为每个进程分配不同端口）。

---

## 部署方式（推荐）

### 进程拆分（故障域隔离）

建议拆成 4 个部署（同镜像不同 env）：

1. **HTTP**：`npm run start:prod`
2. **Consumer Worker**：`WORKER_ROLES=consumer npm run start:worker:prod`
3. **Dispatcher Worker**：`WORKER_ROLES=dispatcher npm run start:worker:prod`
4. **Maintenance Worker**：`WORKER_ROLES=maintenance npm run start:worker:prod`

### 探活与就绪（K8s/LB）

- Liveness：`GET /health`（只表示进程存活）
- Readiness：`GET /ready`（探测 DB + MQ；失败返回 503）

### 鉴权/隔离（内网建议）

本服务默认不内置复杂 RBAC；生产/内网启用时建议通过 **网关/Ingress/内网 ACL** 保护：

- `/admin/*`（Definition 管理与运维接口）
- `/docs`（Swagger UI）
- `/metrics`（Prometheus metrics）

### 可靠性与去重（必须读）

- 结果事件采用 **at-least-once** 语义：极端情况下可能重复投递。
- 引擎将 AMQP `messageId` 固定为 **outbox 记录 id**；下游必须以 `messageId` 做幂等去重（详见 `../doc/API_DESIGN.md`）。

### 危险运维端点（DLQ 回放）

DLQ 回放接口默认关闭，启用需同时设置：

- `ADMIN_DANGEROUS_ENDPOINTS_ENABLED=true`
- `ADMIN_API_TOKEN=<长随机串>`

调用时带上：`Authorization: Bearer <token>`。

---

## 集成方式

### 1) Editor（建图/发布）对接

Editor 只需要对接 HTTP Admin API + Node Catalog：

1. `GET /catalog/nodes` 获取节点目录（端口/类型/参数 schema）
2. `GET /admin/definitions` definitions 列表（供 UI 管理/搜索）
3. `POST /admin/definitions` 创建 draft
4. `POST /admin/definitions/validate` 校验（结构化 errors，便于编辑器定位）
5. `POST /admin/definitions/dry-run` 预览计算（不落库、不发 MQ）
6. `POST /admin/definitions/:definitionId/publish` 发布为 release（拿到 `definitionHash`）

### 2) Provider / 业务服务（投递 job）对接

向 RabbitMQ 投递 `compute.job.requested.v1`（routingKey 同名），关键约束：

- 幂等键：`jobId`（必须全局唯一；重试必须复用同一个 jobId）
- Definition 引用：必须传 `{ definitionId, definitionHash }`（不使用数字 version）
- inputs：单一 object；允许携带多余字段，但引擎只读取声明在 `flow.start` pins 里的 `inputs.<pin>`
- options：仅用于执行覆盖（会进入 `inputsHash`），见 `../doc/API_DESIGN.md`

### 3) 下游结果消费（事件）对接

订阅结果事件：

- `compute.job.succeeded.v1`
- `compute.job.failed.v1`

并以 **AMQP messageId（outbox.id）** 做幂等去重（必须）。

### 4) Ops / 运维面板对接（可选）

- `GET /admin/jobs`：jobs 列表（摘要字段）
- `GET /admin/ops/stats`：outbox backlog + job 状态统计（仪表盘）
- （危险）`/admin/dlq/job-requested/*`：DLQ stats/replay（需显式启用）

---

## 迁移命令（TypeORM）

- Show：`npm run migration:show`
- Run：`npm run migration:run`
- Revert：`npm run migration:revert`
