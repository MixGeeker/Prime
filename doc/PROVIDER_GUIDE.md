# Compute Inputs Provider 文档（制作与集成）

> Inputs Provider 由集成方/业务方实现与维护。它的职责是：聚合全局变量与业务 facts、执行所有 IO（DB/HTTP/gRPC）、把结果规范化为标准 `inputs`，并投递 `compute.job.requested.v1` 给 Compute Engine。

## 1. Provider 的边界

### 1.1 Provider 负责
- 读取/订阅业务模块数据：汇率、公司配置、商品/库存/成本、对手价抓取等。
- 解析与标准化：Decimal（字符串）规范化、缺失值与降级策略；币种/方向等领域语义由集成方自行管理。
- 组装 `inputs`（含 `inputs._meta`），并发送 job（MQ 或调用一个 job sender SDK）。
- （可选）输出 Inputs Catalog 给 Editor，用于输入字段选择与提示。

### 1.2 Provider 不负责
- 不做图执行与确定性计算（由 Compute Engine 做）。
- 不直接写入业务价格结果（结果落地由业务模块消费 `job.succeeded/failed` 决定）。

### 1.3 仓库内的参考实现（可运行）
- Provider Simulator：`providers/examples/provider-simulator/`
  - 管理 `inputs.globals`（全局 facts）
  - 触发 `compute.job.requested.v1`（MQ）
  - 订阅结果事件并落地（便于 Ops 面板展示）
- 业务样例蓝图：`providers/examples/tax-discount/`

---

## 2. 标准 inputs 结构（强烈建议）

> 目标：让 Provider 的 payload 能稳定对接 Compute Engine 的强类型输入契约（见 `GRAPH_SCHEMA.md` 与 `HASHING_SPEC.md`）。

建议约定 job payload 的 `inputs` 结构：
- `inputs.globals`：全局输入（对应 BlueprintGraph 的 `globals[]` 声明）
- `inputs.params`：入口参数（对应 BlueprintGraph 的 `entrypoints[key].params[]` 声明）
- **允许多余字段**：`inputs` 可携带其它字段（例如 `inputs._meta`），但引擎默认不会读取，也不会把未声明字段纳入 `inputsHash`。

`inputs._meta` 建议包含：
- `asOf`: string（ISO 时间点，表示 Provider 用于读取 facts 的基准时间）
- `sources`: `Array<{ name: string, ref?: string, fetchedAt?: string }>`（例如 `fx_rates` 的来源/ID）
- `notes?`: string（可选，用于排障）

> 若希望某些元信息进入 `inputsHash`，应把它们声明为 `globals/params`（可用 `Json` 聚合），并通过 `inputs.globals/inputs.params` 传入。

---

## 3. Decimal 规范（建议）

> Compute Engine 会对 inputs 做 canonicalize，但 Provider 侧也应输出稳定格式，避免口径漂移。类型系统规范见 `VALUE_TYPES.md`。

### 3.1 Decimal（推荐）
- 使用 **string** 表达（例如 `"123.45"`），避免 JS 浮点误差。
- 禁止指数表示（`"1e-7"`），禁止多余空格；建议在 Provider 侧做一次正则校验。
- `number` 仅作为兼容输入：会在 JS JSON 解析阶段变成 IEEE754 浮点，可能已丢精度。

### 3.2 Ratio / Percent
- 建议统一用 `Ratio`（0..1）字符串：`"0.15"`，不要混用 `15`（percent）与 `0.15`。

### 3.3 如果你们需要 Money/Rate/Currency 等语义
Compute Engine MVP 不内置这些领域语义；建议两种做法（二选一）：
- **拆字段（推荐）**：金额用 Decimal（amount）+ 额外的 String（currency/from/to 等），类型校验更清晰。
- **用 `Json`**：例如 `{ amount: "123.45", currency: "USD" }`，但引擎不会对其结构与内部 decimal 做 typed canonicalize（hash 稳定性由你们保证）。

---

## 4. Job 投递（集成方式）

### 4.1 MQ 投递（推荐）
Provider 直接发布 `compute.job.requested.v1` 到 `compute.commands`（见 `API_DESIGN.md`）。

建议做：
- `jobId` 必填（UUID/ULID），并且**在重试/重发时复用同一个 jobId**（幂等键以 jobId 为准）。
- `messageId` 可选但建议（追踪/排障用；即使变化也不影响幂等）。
- `correlationId` 从业务链路透传（可选但建议）。

### 4.2 SDK/模块方式（可选）
平台团队提供一个 `@compute-engine/job-sender` 包：
- 负责：schema 校验、headers 规范、重试策略、trace/correlation 透传。
- Provider 只需要：`sendJob({ jobId, definitionRef, inputs, options })`。

---

## 5. Inputs Catalog（供 Editor 使用，可选）

### 5.1 目的
让 Editor 能“选输入字段而不是手写 key”，并在建图时做类型提示/示例展示。

### 5.2 建议格式
- `schemaVersion`
- `globals`: `Array<{ name: string, valueType: string, description?: string, example?: unknown }>`
- `params`: `Array<{ name: string, valueType: string, description?: string, example?: unknown }>`

示例（片段）：
- `globals.fxRate`: `Decimal`
- `globals.companyName`: `String`
- `params.productId`: `String`

仓库内参考实现：
- Provider Simulator 提供 `GET /catalog/inputs`（`providers/examples/provider-simulator`），用于给 Studio 提供可选字段、类型与示例值。

---

## 6. 对手价抓取（如果需要）

> 抓取一定放在 Provider（IO 层），结果作为 inputs 注入，引擎不做抓取。

建议：
- 缓存/限流：避免频繁抓取导致不稳定。
- 清洗/去噪：异常值、缺失值、置信度。
- 元信息：可将 `fetchedAt/source/confidence` 写入 `inputs._meta`（允许多余字段）；注意 Compute Engine 默认不会读取/也不会把未声明字段纳入 `inputsHash`。
  - 若希望该元信息进入 `inputsHash`：应把它们声明为 `globals`（例如声明一个 `globals.meta: Json`）并通过 `inputs.globals.meta` 传入。

---

## 7. 回放与对账

为了可追溯：
- Provider 必须把**影响结果**的内容注入到本次 Definition 声明的 `globals/params`（否则引擎不会读取，也不会进入 `inputsHash`）。
- `inputs._meta` 允许携带审计信息，但默认不进入 `inputsHash`；需要对账/回放的字段应进入声明项（或聚合到一个 `Json` 声明项里）。
