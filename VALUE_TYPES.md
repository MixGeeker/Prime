# Compute Engine Value Types（类型系统）

> 本文档定义 `valueType` 的标准：用于 Node Catalog、Variable Catalog、Definition 的 `variables/outputs` 以及运行时校验。
>
> 目标：保证 Engine/Provider/Editor 之间对“值的语义与结构”有一致理解，从而支持：静态校验、确定性计算、可追溯与可回放。

## 1. 设计原则
- **值是数据，不是代码**：类型系统只约定“结构与语义”，不引入业务名词。
- **确定性优先**：数值一律按 decimal 语义处理，避免 JS 浮点误差。
- **向后兼容**：新增类型/语义通过 `schemaVersion` 或 `nodeVersion` 演进，已发布 Definition 不被破坏。

---

## 2. `valueType` 表达（字符串）

`valueType` 在 catalog 中用字符串表达，建议支持：
- 原子类型：`String | Boolean | Decimal | Ratio | DateTime | Json`

> 说明（重要）：Compute Engine 的定位是“计算底座”，MVP **不内置 Money/Rate/Currency 等领域语义**。
> - 如果集成方需要携带币种/方向等信息，建议把它们作为独立变量（例如 `inputs.params.currency`）或放在 `Json` 里（但引擎不会对其做强校验与 typed canonicalize）。

---

## 3. MVP 支持的类型（建议）

### 3.1 `Decimal`
- 语义：任意高精度十进制数。
- JSON 表达（推荐）：`string`（例如 `"123.45"`）
- JSON 表达（兼容）：`number`（引擎会 canonicalize 成 decimal string）

约束（建议）：
- **强烈建议生产端只使用 string**：JSON `number` 在解析为 JS `number` 时已经可能丢精度（IEEE754）。
- `number` 仅作为兼容输入：必须是有限数（拒绝 `NaN/Infinity`）；引擎会把它转换为 decimal string 并进入后续 hash/执行。

Decimal string（推荐语法）：
- `^-?(0|[1-9]\\d*)(\\.\\d+)?$`
- 禁止指数表示（`1e-7`）、禁止 `+` 前缀、禁止多余空格。

### 3.2 `Ratio`
- 语义：区间 `[0,1]` 的 decimal（用于比例/占比）。
- 表达：同 `Decimal`（推荐 string），并在 validate 阶段校验范围。

### 3.3 `String` / `Boolean`
- 语义：基础类型，用于配置、开关、标签等。

### 3.4 `DateTime`
- 语义：时间点（用于 “as-of”/有效期等）。
- JSON 表达：ISO8601 字符串（例如 `"2026-02-28T12:34:56Z"`）
- 说明：引擎不做“当前时间”读取；时间必须由 Provider 注入为输入值。

### 3.5 `Json`
- 语义：任意 JSON 值（不做强校验）。
- 用途：用于暂存不参与计算的输入，或逐步迁移时的过渡类型。
- 注意：节点如果声明 `Json`，通常意味着引擎无法提供强类型校验与确定性保证（除非节点语义明确）。

---

## 4. 类型兼容与校验（MVP 规则）

> 这些规则用于 validate 与运行时检查；更细的推导规则随节点库演进。

- `Ratio` 是 `Decimal` 的子类型（可连接到接受 `Decimal` 的端口）。
- `If`：
  - condition 必须是 `Boolean`。
  - then/else 两支建议同类型；若不同，validate 应报错或要求显式转换节点（后续扩展）。

---

## 5. Canonicalize（用于 `inputsHash`）

为保证 hash 稳定：
- `Decimal/Ratio`：统一转换成规范 decimal string（去掉多余前导零、标准化 `-0` 等）。
- `DateTime`：建议转换成 ISO `Z`（UTC）形式；如果无法转换则保持原字符串但会影响一致性。

> 注意：`Json` 类型不做 typed canonicalize；其 hash 稳定性仅由 JCS 保证。
> 如果 `Json` 内嵌了 decimal，建议调用方把它们也做成 string，并提前 canonicalize，避免同语义不同写法导致 hash 漂移。
