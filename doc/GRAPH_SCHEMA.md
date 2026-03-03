# Blueprint Graph Schema（Definition `content` 规范）

> 本文档定义 `contentType = graph_json` 时，`content`（BlueprintGraph）的**落地可实现**结构与校验规则。
>
> 作用范围：
> - Compute Engine：发布时静态校验；运行时校验与执行；计算 `definitionHash`。
> - Editor：建图（含控制流 exec 线）/连线/参数配置/校验提示；生成 `content`。
> - 调用方（或 Inputs Provider）：构造 job 的 `inputs`（允许多余字段，但引擎只读取声明过的 globals/params）。

另见：
- 值类型规范：`VALUE_TYPES.md`
- Hash 规范：`HASHING_SPEC.md`

---

## 1. 顶层结构

`content` 必须是一个 JSON object，至少包含：

```json
{
  "globals": [],
  "entrypoints": [],
  "locals": [],
  "nodes": [],
  "edges": [],
  "execEdges": [],
  "outputs": []
}
```

字段说明：
- `globals`：全局输入契约（强类型校验 + inputsHash 的来源）。
- `entrypoints`：入口（触发器）声明（每个入口有自己的入参契约与执行起点）。
- `locals`：图内局部变量声明（可变状态；用于循环/状态机）。
- `nodes`：节点实例（按 `nodeType` 指向 Node Catalog 定义）。
- `edges`：**值连线**（value edges）：连接 value ports，必须是 DAG（无环）。
- `execEdges`：**控制流连线**（exec edges）：连接 exec ports，允许成环（用于 loop）。
- `outputs`：输出契约声明（用于运行时校验 + outputsHash）。

可选字段（不影响引擎执行；也不参与 `definitionHash`）：
- `metadata?`：展示/审计字段（坐标、分组等）。
- `resolvers?`：保留字段；Compute Engine 不执行任何 IO。

> `runnerConfig` 是 Release 的独立字段（Admin API 的 `runnerConfig`），不放在 graph content 里；见本文件第 7 节。

---

## 2. Job 输入结构（强类型 + 允许多余字段）

Compute Engine 触发执行时，job payload 中仍然携带一个 `inputs` object：

```json
{
  "inputs": {
    "globals": { "fxRate": "7.1234" },
    "params": { "productId": "p_123" },
    "_any_extra": "allowed but ignored"
  }
}
```

约束：
- 引擎只读取：
  - `inputs.globals.<name>`（对应 `globals[].name`）
  - `inputs.params.<name>`（对应 `entrypoints[key].params[].name`）
- **允许多余字段**：`inputs` 可以包含任意其它字段（不会触发校验错误）。
- **允许显式读取多余字段**：引擎只会对“已声明字段”做强类型校验/默认值填充/参与 `inputsHash`；但图内可以通过
  `inputs.(globals|params).root -> json.select -> json.to.*` 显式读取多余字段进行计算。
  - 多余字段 **不会** 进入 `inputsHash`
  - 多余字段 **不会** 被自动强类型校验（除非显式插入 `json.to.*`）

---

## 3. `globals`（全局输入契约）

每个全局输入是一条强类型声明：

```json
{
  "name": "fxRate",
  "valueType": "Decimal",
  "required": true,
  "default": null,
  "description": "USD -> VES 汇率",
  "constraints": {}
}
```

约束（必须）：
- `name` 唯一，且仅允许 `[A-Za-z0-9_-]+`。
- `valueType` 必须是引擎支持的类型。
- `default`（若存在）必须能通过 `valueType` 校验。

---

## 4. `entrypoints`（入口/触发器）

入口声明：

```json
{
  "key": "main",
  "params": [
    { "name": "productId", "valueType": "String", "required": true }
  ],
  "to": { "nodeId": "n_start", "port": "in" }
}
```

字段说明：
- `key`：入口名称（例如 `main`、`onPriceFix`）。
- `params`：该入口的强类型入参契约（从 `inputs.params` 读取）。
- `to`：该入口触发时，从哪个节点的哪个 **exec 输入端口**开始执行。

约束（必须）：
- `key` 唯一；至少包含 `main`。
- `to.nodeId` 必须存在；`to.port` 必须是目标节点的 execInputs 之一。

---

## 5. `locals`（图内局部变量）

局部变量声明：

```json
{ "name": "acc", "valueType": "Decimal", "default": "0" }
```

约束（必须）：
- `name` 唯一。
- `default`（若存在）必须能通过 `valueType` 校验。

> locals 的读写通过内置节点完成（例如 `locals.get.decimal` / `locals.set.decimal`）。

---

## 6. `nodes/edges/execEdges/outputs`

### 6.1 `nodes`

```json
{
  "id": "n_add_1",
  "nodeType": "math.add",
  "params": {}
}
```

约束（必须）：
- `id` 唯一。
- `nodeType` 必须存在于 Node Catalog。
- `params`（若存在）必须符合 Node Catalog 的 `paramsSchema`。

> 注意：本引擎不再使用 `nodeVersion`。语义变更必须更换 `nodeType` 字符串（例如 `math.add_v2`）。

### 6.2 `edges`（值连线）

```json
{ "from": { "nodeId": "n1", "port": "value" }, "to": { "nodeId": "n2", "port": "a" } }
```

约束（必须）：
- `from` 必须引用一个节点的 **value 输出端口**。
- `to` 必须引用一个节点的 **value 输入端口**。
- 每个 value 输入端口最多 1 条入边（MVP 简化）。
- 图在 value 层必须是 **DAG（无环）**。
- 类型兼容：连接类型必须满足 `VALUE_TYPES.md` 的兼容规则与节点定义规则。

### 6.3 `execEdges`（控制流连线）

```json
{ "from": { "nodeId": "n_branch", "port": "true" }, "to": { "nodeId": "n_then", "port": "in" } }
```

约束（必须）：
- `from` 必须引用节点的 **exec 输出端口**。
- `to` 必须引用节点的 **exec 输入端口**。
- 每个 exec 输出端口最多 1 条出边（MVP 简化；需要多分支 fan-out 请使用显式节点，例如 `flow.sequence`）。
- 允许成环（loop），由 runner 的 limits（`maxSteps/timeoutMs`）防止无限循环。

### 6.3.1 内置控制流节点（约定）

> 具体 ports/paramsSchema 以 Node Catalog 为准；这里只列出关键语义，便于 Editor/Provider 对齐心智模型。

#### `flow.branch`
- 输入：`cond:Boolean`
- exec：`in -> (true|false)`
- 语义：短路分支；未走到的分支不会执行。

#### `flow.sequence`
- params：`count: 1..8`
- exec：`in -> out0..out7`
- 语义：按 `out0 -> out1 -> ...` 的顺序依次触发分支（由 Runner 的确定性调度实现）。

#### `flow.while`
- 输入：`cond:Boolean`
- exec：`in -> (body|completed)`
- 语义：`cond=true` 进入 `body`，否则走 `completed`；循环通过 `execEdges` 回连实现（例如把 `body` 分支末尾连回 `flow.while.in`）。

#### `flow.return`
- exec：`in -> (return)`
- 语义：立即终止当前蓝图执行。

#### `flow.call_definition`
- params（必须）：`{ definitionId, definitionHash }`（发布物引用冻结，禁止 “latest 漂移”）
- params（可选）：`entrypointKey`（默认 `main`）、`exposeOutputs`（强类型槽位映射）
- value inputs：`globals:Json`、`params:Json`（必须是 object；由调用方组装要传入子图的 inputs）
- value outputs：
  - `outputs:Json`：子图完整 outputs object
  - 槽位输出（最多每种类型 2 个）：`decimal0/1`、`string0/1`、`boolean0/1`、`datetime0/1`、`ratio0/1`、`json0/1`
- 语义：执行子蓝图并返回其 outputs；若配置了 `exposeOutputs`，会把指定 outputs key 映射到对应强类型槽位端口。
- 校验：`publish/dry-run/executeJob` 会校验依赖 release 存在且已发布、无循环引用，以及 `exposeOutputs` 的 key/type 与子图 `outputs[]` 声明一致。

### 6.3.2 Json 解析节点（约定）

> 当你的业务输入是一个结构化对象（但暂时不想把每个字段都声明成强类型 params/globals）时，可以把它声明为 `Json`，并在图内显式解析与转换。

#### `json.select`
- 输入：`value:Json`
- 输出：`value:Json`
- params：
  - `mode=browse`：逐层解析（只选择下一层 key/索引）；配合链式多个 `json.select` 实现“逐层下钻”
  - `mode=path`：直达路径（`a.b.c` 或 `value.a.b.c`）
- 语义：选择子字段；缺失 key/path 会在运行时抛出确定性错误（便于排障与回放一致）。

#### `json.to.*`（强类型转换）
- `json.to.decimal` / `json.to.ratio` / `json.to.string` / `json.to.boolean` / `json.to.datetime`
- 输入：`value:Json`
- 输出：对应强类型 `value`
- 语义：按 `VALUE_TYPES.md` 规则做类型校验与 canonicalize；失败会抛出确定性错误。

### 6.4 `outputs`

```json
{
  "key": "selling_price",
  "valueType": "Decimal",
  "rounding": { "scale": 2, "mode": "HALF_UP" }
}
```

约束（必须）：
- `key` 唯一。
- `rounding`（若存在）仅允许用于 `Decimal | Ratio`。
- `outputs` 仅声明输出契约；实际输出必须由节点写入：
  - 使用 `outputs.set.<type>`（例如 `outputs.set.decimal`）把 value 写入 outputs（`params.key = outputs[].key`）
  - 每个 `outputs[].key` 必须至少被一个匹配类型的 `outputs.set.*` 节点写入（发布校验会检查）

---

## 7. Release `runnerConfig`（不在 `content`）

`runnerConfig` 影响执行语义，必须参与 `definitionHash`。建议结构：

```json
{
  "decimal": { "precision": 34, "roundingMode": "HALF_UP" },
  "limits": { "maxNodes": 500, "maxDepth": 200, "maxSteps": 20000, "timeoutMs": 2000, "maxCallDepth": 8 }
}
```

说明：
- `maxNodes/maxDepth`：限制图规模与 value 深度（防资源耗尽）。
- `maxSteps/timeoutMs`：限制 exec 解释器运行步数与总耗时（防死循环）。
- `maxCallDepth`：限制子蓝图递归深度（防递归/爆栈）。

---

## 8. 校验清单（validate 的最小集合）

引擎在 `validate/publish/dry-run/executeJob` 中至少要做：
- Node Catalog 支持校验（nodeType 存在、paramsSchema 通过）。
- `globals/entrypoints/locals/nodes/outputs` 唯一性校验。
- value edges：端口合法性、单入边、类型兼容、**DAG（无环）**。
- exec edges：端口合法性（允许环）。
- entrypoints：至少包含 `main`，并且 `to` 指向 exec 输入端口。

---

## 9. validate 错误结构（建议）

```ts
type ValidationIssue = {
  code: string;
  severity: 'error' | 'warning';
  path?: string; // JSON Pointer
  message: string;
};
```
