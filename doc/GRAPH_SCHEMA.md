# Blueprint Graph Schema（Definition `content` 规范）

> 本文档定义 `contentType = graph_json` 时，`content`（BlueprintGraph）的**落地可实现**结构与校验规则（Graph v2 / UE Blueprint 风格）。
>
> **Hard cut**：Engine 只接受 `schemaVersion = 2` 的图。旧版（含 `globals/entrypoints/outputs`、`flow.return`、`inputs.*`、`outputs.set.*` 等）在校验与执行阶段都会被拒绝。

另见：
- 值类型规范：`VALUE_TYPES.md`
- Hash 规范：`HASHING_SPEC.md`

---

## 1. 顶层结构（GraphJsonV2）

`content` 必须是一个 JSON object，至少包含：

```json
{
  "schemaVersion": 2,
  "locals": [],
  "nodes": [],
  "edges": [],
  "execEdges": []
}
```

字段说明：
- `schemaVersion`：固定为 `2`。
- `locals`：图内局部变量声明（可变状态；用于循环/状态机）。
- `nodes`：节点实例（按 `nodeType` 指向 Node Catalog 定义）。
- `edges`：**值连线**（value edges）：连接 value ports，必须是 DAG（无环）。
- `execEdges`：**控制流连线**（exec edges）：连接 exec ports，允许成环（用于 loop）。

可选字段（不影响引擎执行；也不参与 `definitionHash`）：
- `metadata?`：展示/审计字段（坐标、分组等）。
- `resolvers?`：保留字段；Compute Engine 不执行任何 IO。

> `runnerConfig` 是 Release 的独立字段（Admin API 的 `runnerConfig`），不放在 graph content 里。

---

## 2. 输入契约：`flow.start`（Pin as contract）

Graph v2 不再有顶层 `globals/entrypoints`；输入契约由唯一的 `flow.start` 节点定义：

- `flow.start` 必须存在且**只能有一个**
- `flow.start` 必须是“事件节点”：
  - **没有** exec 输入端口
  - 必须有一个 exec 输出端口：`out`
- 输入契约来自 `flow.start.params.dynamicOutputs`（动态 value 输出 pins）

### 2.1 `PinDef`（start 输出 pin）

start 的每个 pin 定义一条输入契约（Pin 即参数）：

```json
{
  "name": "basePrice",
  "label": "基础价格",
  "valueType": "Decimal",
  "required": true,
  "defaultValue": "0"
}
```

约束（必须）：
- `name` 唯一，且仅允许 `[A-Za-z0-9_-]+`。
- `valueType` 必须是引擎支持的类型。
- `defaultValue`（若存在）必须能通过 `valueType` 校验。

语义（运行时）：
- 引擎只读取 job payload 的 `inputs.<name>`（见下一节）。
- 若 job inputs 缺失该 `name`：
  - 若存在 `defaultValue`：使用 `defaultValue`
  - 否则：使用 `null`
- 若 `required=true`（默认）且最终值为 `null`：抛出确定性错误（缺失必填输入）。
- 若存在值：按 `valueType` 做强类型校验与 canonicalize。

---

## 3. Job 输入结构（单一 inputs object）

Compute Engine 触发执行时，job payload 中携带一个 `inputs` object：

```json
{
  "inputs": {
    "basePrice": "100",
    "taxRate": "0.13",
    "discountRate": "0.10",
    "_meta": { "asOf": "2026-03-03T00:00:00Z" }
  }
}
```

规则：
- 引擎只会读取并校验 `flow.start` 声明过的 pins（`dynamicOutputs[].name`）。
- **允许多余字段**：`inputs` 可以包含任意其它字段。
- **但多余字段默认不可读**：引擎会把“未声明字段”从运行时 `inputs` 中剔除（它们不会进入 `inputsHash`，也不会被图内节点访问到）。
- 若需要传入结构化对象或“可演进字段”，推荐声明一个 `Json` pin（例如 `payload: Json`），并在图内通过 `json.select/json.to.*` 显式解析与转换。

---

## 4. 输出契约：`flow.end`（聚合输出）

Graph v2 不再有顶层 `outputs`，也不再通过 `outputs.set.*` 写 outputs；输出契约由唯一的 `flow.end` 节点定义：

- `flow.end` 必须存在且**只能有一个**
- `flow.end` 必须有一个 exec 输入端口：`in`
- `flow.end` **没有** exec 输出端口（到达即终止）
- 输出契约来自 `flow.end.params.dynamicInputs`（动态 value 输入 pins）

### 4.1 `PinDef`（end 输入 pin）

end 的每个 pin 定义一条输出契约（Pin 即 outputs key）：

```json
{
  "name": "finalPrice",
  "label": "最终价格",
  "valueType": "Decimal",
  "rounding": { "scale": 2, "mode": "HALF_UP" }
}
```

约束（必须）：
- `name` 唯一，且仅允许 `[A-Za-z0-9_-]+`。
- `rounding`（若存在）仅允许用于 `Decimal | Ratio`。

语义（运行时）：
- 当控制流执行到 `flow.end` 时，引擎读取对应输入端口的值，组装为最终 `outputs`：
  - `outputs[pin.name] = <pin 输入值>`
  - 若配置 `rounding`：对 `Decimal/Ratio` 输出在返回前做舍入处理

---

## 5. `nodes / edges / execEdges`

### 5.1 `nodes`

```json
{ "id": "n_add_1", "nodeType": "math.add", "params": {} }
```

约束（必须）：
- `id` 唯一。
- `nodeType` 必须存在于 Node Catalog。
- `params`（若存在）必须符合 Node Catalog 的 `paramsSchema`。

> 注意：本引擎不使用 `nodeVersion`。语义变更必须更换 `nodeType` 字符串（例如 `math.add_v2`）。

### 5.2 `edges`（值连线）

```json
{ "from": { "nodeId": "n1", "port": "value" }, "to": { "nodeId": "n2", "port": "a" } }
```

约束（必须）：
- `from` 必须引用一个节点的 **value 输出端口**。
- `to` 必须引用一个节点的 **value 输入端口**。
- 每个 value 输入端口最多 1 条入边（MVP 简化）。
- value 层必须是 **DAG（无环）**。
- **无自动类型转换**：
  - 类型必须一致
  - 仅允许 `Ratio -> Decimal` 的赋值兼容（Ratio 是 Decimal 子类型）

### 5.3 `execEdges`（控制流连线）

```json
{ "from": { "nodeId": "n_branch", "port": "true" }, "to": { "nodeId": "n_then", "port": "in" } }
```

约束（必须）：
- `from` 必须引用节点的 **exec 输出端口**。
- `to` 必须引用节点的 **exec 输入端口**。
- 每个 exec 输出端口最多 1 条出边（MVP 简化；需要 fan-out 请使用显式节点，例如 `flow.sequence`）。
- 允许成环（loop），由 runner limits（`maxSteps/timeoutMs`）防止无限循环。

---

## 6. 内置关键节点（约定）

### 6.1 `flow.start`
- exec：`(event) -> out`
- value outputs：由 `params.dynamicOutputs` 动态声明（Pin 即 inputs 契约）

### 6.2 `flow.end`
- exec：`in -> (terminate)`
- value inputs：由 `params.dynamicInputs` 动态声明（Pin 即 outputs 契约）

### 6.3 `flow.call_definition`
- params（必须）：`{ definitionId, definitionHash }`
- params（可选）：`entrypointKey`（保留字段；Graph v2 默认忽略）、`exposeOutputs`（强类型槽位映射）
- value inputs：`inputs:Json`（必须是 object；调用方组装要传入子图的 inputs）
- value outputs：`outputs:Json` + 若干强类型槽位（见 Node Catalog）

---

## 7. 禁止的旧节点族（Graph v2）

Graph v2 校验会拒绝以下 nodeType（避免出现旧 I/O 范式）：
- `flow.return`
- `inputs.*`
- `outputs.set.*`

