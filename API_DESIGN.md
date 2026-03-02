# Compute Engine API 设计文档

> 本文档定义 Compute Engine 对外提供的接口（HTTP Admin API + Node Catalog）以及与 MQ 的契约边界。业务 facts 的聚合/解析由 Inputs Provider 负责，不属于引擎 API。

## 1. 总览

### 1.1 目标
- 管理 Definition：draft CRUD、校验、发布（publish）、弃用（deprecate）、查看发布物/审计信息。
- 支撑自定义 Editor：节点目录（Node Catalog）、结构化校验错误、预览（dry-run）。
- 支撑运行：MQ 接收 `compute.job.requested.v1`，发布 `compute.job.succeeded.v1 / failed.v1`。

### 1.2 非目标
- 不提供官方 Editor UI。
- 不提供 Inputs Provider 的运行时接口（Provider 是集成方实现）。

---

## 2. 消息队列（RabbitMQ）契约

> 约定：**幂等键以 `jobId` 为准**（平台级唯一）；`messageId/correlationId` 仅用于链路追踪与排障（可选但建议）。

### 2.1 Commands（输入）
#### `compute.job.requested.v1`
- headers（建议）：`messageId?`, `correlationId?`, `schemaVersion`
- payload：
  - `schemaVersion`: `1`
  - `jobId`: string（UUID/ULID）
  - `definitionRef`: `{ definitionId: string, definitionHash: string }`
  - `entrypointKey?`: string（默认 `main`）
  - `inputs`: `{ [key: string]: unknown }`
  - `options?`: `{ decimal?: { precision?: number, roundingMode?: string } }`（执行覆盖项；会进入 `inputsHash`）

### 2.2 Events（输出）
#### `compute.job.succeeded.v1`
- payload：
  - `schemaVersion`: `1`
  - `jobId`: string
  - `definitionRefUsed`: `{ definitionId: string, definitionHash: string }`
  - `inputsHash`: string
  - `outputs`: `{ [key: string]: unknown }`
  - `outputsHash`: string
  - `computedAt`: string（ISO）

#### `compute.job.failed.v1`
- payload：
  - `schemaVersion`: `1`
  - `jobId`: string
  - `definitionRefUsed`: `{ definitionId: string, definitionHash: string }`
  - `inputsHash?`: string（若已成功完成 inputsHash 计算）
  - `error`: `{ code: string, message: string, details?: unknown }`
  - `retryable`: boolean
  - `failedAt`: string（ISO）

### 2.3 幂等与重复投递（必须写死）
- **唯一键**：`jobId` 必须全局唯一；引擎必须以 `jobId` 幂等处理 `compute.job.requested.v1`。
- **重复消息**：
  - 若相同 `jobId` 的请求 payload 与已存档一致：视为重复投递，直接 ack（不得重复执行）。
  - 若相同 `jobId` 的请求 payload 不一致：视为生产端 bug，建议 `reject(requeue=false)` → DLQ，并记录 `IDEMPOTENCY_CONFLICT` 指标。

### 2.4 `job.failed.error.code`（MVP 建议枚举）
> `retryable` 是引擎给出的“建议重试”结论；上游可自行覆盖策略。

- `INVALID_MESSAGE`：消息体 schema 不合法/字段缺失（不可重试；若缺少/无法解析 `jobId` 则只能进入 DLQ，不会产生结果事件）。
- `DEFINITION_NOT_FOUND`：找不到指定 `definitionId+definitionHash`（通常不可重试）。
- `DEFINITION_NOT_PUBLISHED`：引用了不可执行的发布物（例如已弃用；不可重试）。
- `INPUT_VALIDATION_ERROR`：inputs 缺必填/类型不匹配/约束违规（不可重试；details 建议带结构化 errors）。
- `RUNNER_TIMEOUT`：执行超时/资源限制触发（通常可重试）。
- `RUNNER_DETERMINISTIC_ERROR`：确定性运行时错误（如除零、类型转换失败；通常不可重试）。
- `ENGINE_TEMPORARY_UNAVAILABLE`：DB/MQ/依赖不可用（可重试）。
- `INTERNAL_ERROR`：未分类内部错误（默认可重试）。

---

## 3. HTTP Admin API（供 Editor / 运维使用）

> 约定：所有响应都包含 `requestId`（可选）用于排障；所有写操作需要鉴权（实现方式由部署侧决定）。

### 3.1 Definition Draft

#### `POST /admin/definitions`
创建 draft。
- body：
  - `definitionId`: string
  - `contentType`: `'graph_json'`
  - `content`: object（BlueprintGraph；不包含 `runnerConfig`，见 `GRAPH_SCHEMA.md`）
  - `outputSchema?`: object
  - `runnerConfig?`: object
  - `changelog?`: string
- response：
  - `definitionId`
  - `draftRevisionId`
  - `createdAt`

#### `GET /admin/definitions/:definitionId/draft`
获取当前 draft。

#### `PUT /admin/definitions/:definitionId/draft`
更新 draft（乐观并发）。
- body：同创建，另含 `draftRevisionId`（或 `draftHash`）

#### `DELETE /admin/definitions/:definitionId/draft`
删除 draft（可选）。

### 3.2 Validate

#### `POST /admin/definitions/validate`
校验 draft 或一次性 definition（编辑器实时提示）。
- body（二选一）：
  - `definitionRef`: `{ definitionId, definitionHash }`
  - 或 `definition`: `{ contentType, content, outputSchema?, runnerConfig? }`
- response：
  - `ok`: boolean
  - `errors`: `Array<{ code: string, severity: 'error'|'warning', path?: string, message: string }>`
  - `definitionHash?`: string（当可计算时）

### 3.3 Dry-run（预览）

#### `POST /admin/definitions/dry-run`
给定 definition（或 ref）+ inputs，返回 outputs（不落库、不发 MQ）。
- body：
  - `definitionRef` 或 `definition`
  - `entrypointKey?`（默认 `main`）
  - `inputs`
  - `options?`
- response：
  - `definitionRefUsed`
  - `definitionHash`
  - `inputsHash`
  - `outputs`
  - `outputsHash`

### 3.4 Publish / Deprecate

#### `POST /admin/definitions/:definitionId/publish`
发布当前 draft 为一个不可变发布物（Release）。
- body：`{ draftRevisionId, changelog? }`
- response：`{ definitionId, definitionHash, publishedAt }`

#### `POST /admin/definitions/:definitionId/releases/:definitionHash/deprecate`
弃用某个发布物（Release）。
- body：`{ reason? }`

### 3.5 Read APIs
#### `GET /admin/definitions/:definitionId/releases`
列出所有发布物（含 `status/publishedAt/changelog/definitionHash`）。

#### `GET /admin/definitions/:definitionId/releases/:definitionHash`
获取某个发布物内容（用于 diff/回放）。

### 3.6 Job 查询（运维/排障，建议）
#### `GET /admin/jobs/:jobId`
获取一次 job 的执行结果（用于对账/排障）。
- response（建议字段）：
  - `jobId`
  - `status`: `'requested'|'running'|'succeeded'|'failed'`
  - `definitionRefUsed`
  - `definitionHash?`
  - `inputsHash?`
  - `outputs?`
  - `outputsHash?`
  - `error?`: `{ code, message, details? }`
  - `requestedAt`, `computedAt?`, `failedAt?`

---

## 4. Node Catalog（供 Editor 读取）

### 4.1 形式
二选一：
- 只读 API：`GET /catalog/nodes`
- 或 npm 包：`@compute-engine/node-catalog`（导出同结构 JSON）

### 4.2 数据结构（建议）
返回：
- `schemaVersion`
- `nodes`: `Array<{
    nodeType: string,
    title: string,
    category: string,
    description?: string,
    execInputs?: Array<{ name: string }>,
    execOutputs?: Array<{ name: string }>,
    inputs: Array<{ name: string, valueType: string }>,
    outputs: Array<{ name: string, valueType: string }>,
    paramsSchema?: object
  }>`

> `valueType` 建议与引擎类型系统一致（如 `Decimal`, `Ratio`, `String`, `Boolean`, `DateTime`, `Json` 等），由引擎负责解释与校验。类型系统规范见 `VALUE_TYPES.md`。

补充约定（MVP 建议）：
- `paramsSchema`：使用 **JSON Schema（draft-07）**；引擎与 Editor 建议统一使用 Ajv 做校验。
- 若某节点未提供 `paramsSchema`：则该节点在 graph 中的 `params` 必须缺省或为 `{}`（避免“写了但引擎忽略”的歧义）。
