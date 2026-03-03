# Hashing Spec（definitionHash / inputsHash / outputsHash）

> 本文档定义 Compute Engine 的 hash 计算规则，用于：
> - 可追溯/可回放：明确“某次计算到底用了什么 Definition 与什么 Inputs”。
> - 幂等与语义去重：Inbox/Outbox 与下游去重的基础。
> - 跨语言/跨实现一致：未来替换语言/事件系统时仍可对账。

另见：
- Graph schema：`GRAPH_SCHEMA.md`
- Value types：`VALUE_TYPES.md`

---

## 1. Hash 算法与编码

- 算法：`SHA-256`
- 输出编码：**小写 hex**（64 字符）
- 记法：`sha256_hex(<bytes>)`

---

## 2. Canonical JSON（基础）

hash 的输入必须是一个**确定性的字节序列**。为避免 JSON 序列化差异，采用：
- **JSON Canonicalization Scheme（JCS, RFC 8785）** 作为基础 canonicalization：
  - object key 按字典序排序
  - 不输出多余空白
  - 数字按 RFC 8785 规则输出

> 实现建议：直接使用现成 JCS 库；不要手写。

---

## 3. 类型感知的值规范化（typed canonicalize）

在进入 JCS 之前，对以下 valueType 做额外规范化（见 `VALUE_TYPES.md`）：
- `Decimal/Ratio`：转成规范 decimal string（禁止指数表示；`-0` → `0`）。
- `DateTime`：建议解析后输出 `toISOString()`（UTC、带毫秒），否则视为 validation error（MVP 建议严格）。

> 注意：`Json` 类型不做 typed canonicalize；其 hash 稳定性仅由 JCS 保证。

---

## 4. definitionHash

### 4.1 计算时机
- 在 `publish` 成功时计算并落库到 `definition_releases.definition_hash`（以 `definitionHash` 标识不可变发布物）。

### 4.2 输入对象（规范）
对“发布版本”的内容构造以下对象并 hash：

```json
{
  "contentType": "graph_json",
  "content": { /* Graph JSON */ },
  "outputSchema": null,
  "runnerConfig": null
}
```

说明：
- `content` 必须符合 `GRAPH_SCHEMA.md`。
- `outputSchema/runnerConfig` 对应 Admin API 的可选字段；若未使用应为 `null`（避免缺失/空对象导致多种等价表示）。
- `content` 在计算 hash 前必须先做“可执行语义裁剪”：
  - 必须剔除：`content.metadata`、`content.resolvers`（以及未来任何仅供展示/生态的非执行字段）
  - 目的：避免 Editor 布局/提示文案等变化导致 `definitionHash` 漂移，从而污染对账与缓存命中。

### 4.3 Graph 的额外规范化（强烈建议）
为避免“数组顺序不同但语义相同”导致 hash 漂移，计算 definitionHash 前建议对 `content` 做稳定排序：
- **先裁剪**：只保留可执行字段：`globals/entrypoints/locals/nodes/edges/execEdges/outputs`；剔除 `metadata/resolvers`（以及任何仅 UI/生态的扩展字段）。
- `globals` 按 `name` 升序
- `entrypoints` 按 `key` 升序
  - `entrypoints[].params` 按 `name` 升序
- `locals` 按 `name` 升序
- `nodes` 按 `id` 升序
- `edges` 按 `(from.nodeId, from.port, to.nodeId, to.port)` 升序
- `execEdges` 按 `(from.nodeId, from.port, to.nodeId, to.port)` 升序
- `outputs` 按 `key` 升序

然后对得到的对象执行 typed canonicalize（仅对 `globals[].default`、`entrypoints[].params[].default`、`locals[].default` 等可能包含 typed 值的字段）→ JCS → SHA-256。

---

## 5. inputsHash

### 5.1 目标
`inputsHash` 用于标识一次计算的“输入快照”（在给定 Definition 下可对账/回放）。

### 5.2 输入选择（MVP 规则）
为了避免 job payload 中的“无关字段”影响 hash，inputsHash **只覆盖 Definition 声明的 globals + 本次执行入口的 params** + job options + entrypointKey：

```json
{
  "entrypointKey": "main",
  "globals": { "<name>": <canonicalValueOrNull> },
  "params": { "<name>": <canonicalValueOrNull> },
  "options": { /* job payload.options */ }
}
```

规则：
- `entrypointKey`：缺省为 `main`；必须纳入 hash（同一份 inputs 在不同入口下语义不同）。
- `globals/params`：只覆盖声明项，并且必须包含**每一个**声明的 name：
  - 引擎只读取 job payload.inputs 中的：
    - `inputs.globals.<name>`（对应 `globals[].name`）
    - `inputs.params.<name>`（对应 `entrypoints[key].params[].name`）
  - 允许多余字段：`inputs` 可以携带任意其它字段（不会触发校验错误，也不参与 hash）。`inputs.globals/inputs.params` 内的未声明字段同样会被忽略。
  - 若 job inputs 缺失该 name：
    - 当 `required=false` 且定义了 `default`：使用 `default`（因此 inputsHash 表示“实际执行用的 effective inputs”）。
    - 否则：值为 `null`。
  - 若存在：按该项的 `valueType` 做 typed canonicalize（包含显式 `null` 的处理：`required=true` 时应报 validation error）。
- `options`：
  - 若 job 未提供 options：使用空对象 `{}`（而不是 `null`）。
  - 若提供：只允许稳定字段（MVP 建议仅允许 `options.decimal.precision`（整数）与 `options.decimal.roundingMode`（字符串））；不支持的字段应视为 `INVALID_MESSAGE`。

### 5.3 计算流程（规范）
1. 从 DefinitionRelease 读取 `globals[]` 与指定入口（`entrypointKey`）的 `params[]`。
2. 从 job payload 读取 `entrypointKey`、`inputs` 与 `options`。
3. 构造上述 inputsHash 输入对象（只覆盖声明项；缺失时按 default→null 规则补齐）。
4. typed canonicalize（按 globals/params 的 valueType + options 规则）→ JCS → SHA-256。

---

## 6. outputsHash

### 6.1 输入对象（规范）
只覆盖 Definition 声明的 outputs：

```json
{
  "outputs": {
    "<output.key>": <canonicalValue>
  }
}
```

规则：
- key 使用 `outputs[].key`。
- value 按 outputs 的 `valueType` 做 typed canonicalize。
- 如果某个 output 缺失/无法计算：应视为执行错误（`compute.job.failed.v1`），并且**不计算/不产生 `outputsHash`**（`outputs` 也不应作为成功结果发出）。

### 6.2 计算流程
typed canonicalize（按 outputs 的 valueType）→ JCS → SHA-256。

---

## 7. 一致性要求（必须）
- 同一 `definitionHash` + 同一 `inputsHash` 必须产出同一 `outputsHash`（确定性）。
- typed canonicalize 与 JCS 实现必须固定版本并有测试向量（建议在仓库内放一组 golden cases）。
