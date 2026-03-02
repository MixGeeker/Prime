# Graph JSON Schema（Definition `content` 规范）

> 本文档定义 `contentType = graph_json` 时，`content`（graphJson）的**落地可实现**结构与校验规则。
>
> 作用范围：
> - Compute Engine：发布时静态校验；运行时校验与执行；计算 `definitionHash`。
> - Editor：建图/连线/参数配置/校验提示；生成 `content`。
> - Inputs Provider：根据 `variables` 的 `path/valueType` 准备 `inputs`（但 Provider 不需要理解 nodes/edges）。

另见：
- 值类型规范：`VALUE_TYPES.md`
- Hash 规范：`HASHING_SPEC.md`

---

## 1. 顶层结构（MVP）

`content` 必须是一个 JSON object，至少包含：

```json
{
  "schemaVersion": 1,
  "variables": [],
  "nodes": [],
  "edges": [],
  "outputs": []
}
```

字段说明：
- `schemaVersion`：固定为 `1`（后续不兼容变更才升版本）。
- `variables`：输入契约声明（用于运行时校验 + inputsHash）。
- `nodes/edges`：计算图（DAG）。
- `outputs`：输出契约声明（用于运行时校验 + outputsHash）。

可选字段（不影响引擎执行；也不参与 `definitionHash`，见 `HASHING_SPEC.md`）：
- `metadata?`：纯展示/审计用途（如节点坐标、分组、说明等）。
- `resolvers?`：描述 Provider 侧可做的“输入物化步骤”（HTTP 抓取/格式转换等）。Compute Engine 不执行这些 resolver。

> `runnerConfig` 是 DefinitionVersion 的独立字段（Admin API 的 `runnerConfig`），不放在 graph content 里；见本文件第 7 节。

---

## 2. Path 语法（variables 引用 inputs）

为避免转义复杂度，MVP 采用受限 dot-path：
- `path` 必须以 `inputs.` 开头。
- 每个 segment 只能是 `[A-Za-z0-9_-]+`（禁止包含 `.`、`[`、`]`、空格等）。
- 例：`inputs.globals.fx_rates.usd_to_ves`、`inputs.facts.product.cost`、`inputs._meta.asOf`

运行时解析规则：
- `inputs.<...>` 映射到 job payload 的 `inputs` 对象：`job.payload.inputs.<...>`
- 未找到值：视为 `undefined`（是否允许取决于变量是否 required / 是否有 default）

> 如果未来需要支持任意 JSON key（含点号等），可以在 schemaVersion=2 引入 JSON Pointer。

---

## 3. `variables`（输入契约）

### 3.1 结构

```json
{
  "path": "inputs.globals.fx_rates.usd_to_ves",
  "valueType": "Decimal",
  "required": true,
  "description": "USD 到 VES 的汇率",
  "default": null,
  "constraints": {}
}
```

字段说明：
- `path`（必填，唯一）：见上面的 Path 语法。
- `valueType`（必填）：见 `VALUE_TYPES.md`。
- `required`（可选，默认 `false`）：运行时必须提供（缺失则 validation error）。
- `description`（可选）：用于 Editor 提示与文档。
- `default`（可选）：当 `required=false` 且输入缺失时可使用默认值（引擎执行时可采用；hash 规则见 `HASHING_SPEC.md`）。
- `constraints`（可选）：用于 validate 的额外约束（MVP 可不实现），例如：
  - `min/max`（Decimal/Ratio）
  - `regex`（String）
  - `enum`（String）

### 3.2 约束（MVP 必须）
- `path` 唯一；`valueType` 必须是引擎支持的类型（至少 MVP 类型）。
- `default`（若存在）必须能通过 `valueType` 校验。

---

## 4. `nodes`（计算节点）

### 4.1 结构

```json
{
  "id": "n_add_1",
  "nodeType": "math.add",
  "nodeVersion": 1,
  "params": {}
}
```

字段说明：
- `id`（必填，唯一）：建议稳定字符串（例如 ULID 或编辑器生成的稳定 id）。
- `nodeType/nodeVersion`（必填）：必须存在于 Node Catalog（`nodeType@nodeVersion`）。
- `params`（可选）：必须符合 Node Catalog 的 `paramsSchema`（若该节点有 paramsSchema）。

### 4.2 特殊节点约定（MVP）
为让 Editor/Engine/生态可用，建议至少提供：

#### 4.2.1 按类型拆分的变量节点（推荐，MVP）
> 目的：让 Node Catalog 的 ports valueType 是**固定的**，从而让 Editor/validate 更容易落地（避免“输出类型随 params 变化”的泛型节点）。

变量节点（source node）通用规则：
- 语义：从 job inputs 读取一个变量（读取路径为 `params.path`）。
- `params.path`：string（必须匹配 `variables[].path` 之一）。
- 输出端口：`value`。

MVP 推荐拆分为以下节点（示例）：
- `core.var.decimal@1`：输出 `Decimal`；要求 `variables[path].valueType == Decimal`
- `core.var.ratio@1`：输出 `Ratio`；要求 `variables[path].valueType == Ratio`
- `core.var.string@1`：输出 `String`；要求 `variables[path].valueType == String`
- `core.var.boolean@1`：输出 `Boolean`；要求 `variables[path].valueType == Boolean`
- `core.var.datetime@1`：输出 `DateTime`；要求 `variables[path].valueType == DateTime`
- `core.var.json@1`：输出 `Json`；要求 `variables[path].valueType == Json`

#### 4.2.2 按类型拆分的常量节点（推荐，MVP）
常量节点（source node）通用规则：
- 语义：在图中内联一个常量值。
- 输出端口：`value`。

MVP 推荐拆分为以下节点（示例）：
- `core.const.decimal@1`：`params: { value: <Decimal> }`，输出 `Decimal`
- `core.const.ratio@1`：`params: { value: <Ratio> }`，输出 `Ratio`
- `core.const.string@1`：`params: { value: string }`，输出 `String`
- `core.const.boolean@1`：`params: { value: boolean }`，输出 `Boolean`
- `core.const.datetime@1`：`params: { value: string }`，输出 `DateTime`
- `core.const.json@1`：`params: { value: <any JSON> }`，输出 `Json`

---

## 5. `edges`（连线）

### 5.1 结构

```json
{
  "from": { "nodeId": "n1", "port": "value" },
  "to": { "nodeId": "n2", "port": "a" }
}
```

字段说明：
- `from`：必须引用一个节点的 **输出端口**。
- `to`：必须引用一个节点的 **输入端口**。

### 5.2 约束（MVP 必须）
- `nodes` 中必须存在 `from.nodeId` 与 `to.nodeId`。
- `from.port/to.port` 必须存在于对应节点的 ports 定义中（来自 Node Catalog）。
- 每个 `to` 输入端口最多只能有 1 条入边（MVP 简化；未来可支持 variadic ports）。
- 每个节点的每个输入端口都必须被连接（恰好 1 条入边；MVP 不支持可选输入端口）。
- 图必须是 DAG（无环）；存在环则 validate 失败。
- 类型兼容：
  - 连接类型必须满足 `VALUE_TYPES.md` 的兼容规则与节点定义规则（例如 `Ratio` 可接到 `Decimal`）。

---

## 6. `outputs`（输出契约）

### 6.1 结构

```json
{
  "key": "selling_price_usd",
  "valueType": "Decimal",
  "from": { "nodeId": "n_price", "port": "value" },
  "rounding": { "scale": 2, "mode": "HALF_UP" }
}
```

字段说明：
- `key`（必填，唯一）：输出名称；将作为 event payload `outputs[key]` 的 key。
- `valueType`（必填）：见 `VALUE_TYPES.md`。
- `from`（必填）：从哪个节点的输出端口取值。
- `rounding`（可选）：对该 output 的舍入规则（若存在将影响结果与 hash）。

### 6.2 约束（MVP 必须）
- `from.nodeId/port` 必须存在。
- `from` 的输出 valueType 必须可赋值给 outputs 声明的 `valueType`（必要时要求显式转换节点）。
- 输出必须可计算（其依赖链不能缺失）。
- `rounding`（若存在）：
  - 仅允许用于 `valueType = Decimal | Ratio`。
  - `scale` 必须是非负整数。
  - `mode` 必须是下文 `RoundingMode` 枚举之一。

---

## 7. Definition `runnerConfig`（DefinitionVersion 字段，不在 `content`）

> `runnerConfig` 影响执行语义，必须参与 `definitionHash`（见 `HASHING_SPEC.md`）。
>
> 它由 Admin API 在 draft/publish 时与 `content` 一起提交/冻结：`{ contentType, content, runnerConfig }`（见 `API_DESIGN.md`）。
>
> 覆盖规则（MVP 建议）：
> - `effectiveRunnerConfig = deepMerge(definition.runnerConfig, job.options)`（job.options 覆盖同名字段）
> - `runnerConfig` 进入 `definitionHash`；`job.options` 进入 `inputsHash`（见 `HASHING_SPEC.md`）

```json
{
  "decimal": {
    "precision": 34,
    "roundingMode": "HALF_UP"
  },
  "limits": {
    "maxNodes": 500,
    "maxDepth": 200
  }
}
```

约束建议：
- `precision/roundingMode`：与 decimal 库语义一致；引擎必须在 hash 与执行中保持一致。
  - `precision`：有效数字位数（significant digits，不是 scale）。
  - `roundingMode`：见下文 `RoundingMode`。
- `limits`：用于防止恶意/错误图导致资源耗尽（可选）。

### 7.1 `RoundingMode`（建议枚举）
为避免不同语言/库的“字符串随意输入”，建议固定为以下枚举（与常见 decimal 库语义一致）：
- `UP | DOWN | CEIL | FLOOR`
- `HALF_UP | HALF_DOWN | HALF_EVEN | HALF_CEIL | HALF_FLOOR`

---

## 8. 校验清单（validate 的最小集合）

引擎在 `validate/publish/dry-run/executeJob` 中至少要做：
- SchemaVersion 支持校验。
- `variables/nodes/edges/outputs` 基本结构校验（必填字段、唯一性）。
- Node Catalog 支持校验（nodeType@version 存在、paramsSchema 通过）。
- DAG 校验（无环）与拓扑可执行。
- 端口连线合法性（from 输出、to 输入；to 端口单入边）。
- 类型兼容校验（如 Ratio 范围等）。

### 8.1 validate 错误结构（建议）
为便于 Editor 定位错误，建议引擎输出结构化错误项：
```ts
type ValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  path?: string; // JSON Pointer（例如：/nodes/0/params/path）
  message: string;
};
```

code（建议前缀 `GRAPH_`，MVP 可先覆盖这些）：
- `GRAPH_SCHEMA_INVALID`
- `GRAPH_SCHEMA_VERSION_UNSUPPORTED`
- `GRAPH_DUPLICATE_VARIABLE_PATH` / `GRAPH_DUPLICATE_NODE_ID` / `GRAPH_DUPLICATE_OUTPUT_KEY`
- `GRAPH_NODE_NOT_IN_CATALOG` / `GRAPH_NODE_PARAMS_INVALID`
- `GRAPH_EDGE_NODE_NOT_FOUND` / `GRAPH_EDGE_PORT_NOT_FOUND` / `GRAPH_EDGE_TO_PORT_MULTIPLE`
- `GRAPH_CYCLE_DETECTED`
- `GRAPH_MISSING_INPUT_EDGE`
- `GRAPH_TYPE_MISMATCH`
- `GRAPH_OUTPUT_FROM_INVALID` / `GRAPH_OUTPUT_TYPE_MISMATCH`
- `GRAPH_VARIABLE_PATH_NOT_DECLARED` / `GRAPH_VARIABLE_TYPE_MISMATCH`
- `GRAPH_INVALID_ROUNDING`
