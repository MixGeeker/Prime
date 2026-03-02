# Compute Inputs Provider 文档（制作与集成）

> Inputs Provider 由集成方/业务方实现与维护。它的职责是：聚合全局变量与业务 facts、执行所有 IO（DB/HTTP/gRPC）、把结果规范化为标准 `inputs`，并投递 `compute.job.requested.v1` 给 Compute Engine。

## 1. Provider 的边界

### 1.1 Provider 负责
- 读取/订阅业务模块数据：汇率、公司配置、商品/库存/成本、对手价抓取等。
- 解析与标准化：Decimal（字符串）规范化、缺失值与降级策略；币种/方向等领域语义由集成方自行管理。
- 组装 `inputs`（含 `inputs._meta`），并发送 job（MQ 或调用一个 job sender SDK）。
- （可选）输出 Variable Catalog 给 Editor，用于变量选择与提示。

### 1.2 Provider 不负责
- 不做图执行与确定性计算（由 Compute Engine 做）。
- 不直接写入业务价格结果（结果落地由业务模块消费 `job.succeeded/failed` 决定）。

---

## 2. 标准 inputs 结构（强烈建议）

> 目标：让所有 Definition 都能用一致的命名空间，降低口径漂移与编辑器接入成本。

建议约定：
- `inputs.globals.*`：全局变量（公司信息、系统开关、汇率快照、对手价快照等）
- `inputs.facts.*`：对象事实（某个商品/门店/订单的事实数据）
- `inputs.params.*`：调用方参数（如目标利润率、渠道、阈值、策略参数）
- `inputs.resolved.*`：resolver 输出（如 HTTP 抓取结果/清洗结果）
- `inputs._meta.*`：来源元信息（用于追溯/回放，必须进入 `inputsHash`）

`inputs._meta` 建议包含：
- `asOf`: string（ISO 时间点，表示 Provider 用于读取 facts 的基准时间）
- `sources`: `Array<{ name: string, ref?: string, fetchedAt?: string }>`（例如 `fx_rates` 的来源/ID）
- `notes?`: string（可选，用于排障）

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

## 5. Variable Catalog（供 Editor 使用，建议）

### 5.1 目的
让 Editor 能“选变量而不是手写路径”，并在连线时做类型提示。

### 5.2 建议格式
- `schemaVersion`
- `variables`: `Array<{
    path: string,
    valueType: string,
    required?: boolean,
    description?: string,
    example?: unknown
  }>`

示例（片段）：
- `inputs.globals.fx_rates.usd_to_ves`: `Decimal`
- `inputs.globals.company.name`: `String`
- `inputs.facts.product.cost`: `Decimal`
- `inputs.facts.product.currency`: `String`

---

## 6. 对手价抓取（如果需要）

> 抓取一定放在 Provider（IO 层），结果作为 inputs 注入，引擎不做抓取。

建议：
- 缓存/限流：避免频繁抓取导致不稳定。
- 清洗/去噪：异常值、缺失值、置信度。
- 元信息：将 `fetchedAt/source/confidence` 写入 `inputs._meta`，并进入 `inputsHash`。

---

## 7. 回放与对账

为了可追溯：
- Provider 必须把影响结果的 facts 都注入到 inputs（或注入其可定位的 ref + 快照关键字段）。
- Provider 必须保证 `inputs._meta` 足以定位当时的来源与时间点（尤其是汇率与对手价）。
