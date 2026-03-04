# Hashing Spec（definitionHash / inputsHash / outputsHash）

> 本文档定义 Compute Engine 的 hash 计算规则（Graph v2 / UE Blueprint 风格），用于：
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
- `DateTime`：建议解析后输出 `toISOString()`（UTC、带毫秒）。

> 注意：`Json` 类型不做 typed canonicalize；其稳定性仅由 JCS 保证。

---

## 4. definitionHash

### 4.1 计算时机
- 在 `publish` 成功时计算并落库到 `definition_releases.definition_hash`（以 `definitionHash` 标识不可变发布物）。

### 4.2 输入对象（规范）

对“发布版本”的内容构造以下对象并 hash：

```json
{
  "contentType": "graph_json",
  "content": { "schemaVersion": 2, "locals": [], "nodes": [], "edges": [], "execEdges": [] },
  "outputSchema": null,
  "runnerConfig": null
}
```

说明：
- `content` 必须符合 `GRAPH_SCHEMA.md`（Graph v2）。
- `outputSchema/runnerConfig` 对应 Admin API 的可选字段；若未使用应为 `null`（避免缺失/空对象导致多种等价表示）。

### 4.3 Graph 的规范化（必须）

计算 definitionHash 前必须对 `content` 做“可执行语义裁剪 + 稳定排序”：

- **裁剪**：只保留可执行字段：
  - 保留：`schemaVersion/locals/nodes/edges/execEdges`
  - 剔除：`metadata/resolvers`（以及任何仅 UI/生态的非执行字段）
- **稳定排序**（避免数组顺序不同但语义相同导致 hash 漂移）：
  - `locals` 按 `name` 升序（并对 `default` 做 typed canonicalize）
  - `nodes` 按 `id` 升序
    - 若 `nodeType === flow.start`：对 `params.dynamicOutputs` 做稳定化（按 pin.name 排序；对 `defaultValue` 做 typed canonicalize）
    - 若 `nodeType === flow.end`：对 `params.dynamicInputs` 做稳定化（按 pin.name 排序）
  - `edges/execEdges` 按 `(from.nodeId, from.port, to.nodeId, to.port)` 升序

然后对规范化后的对象执行 JCS → SHA-256。

---

## 5. inputsHash

### 5.1 目标
`inputsHash` 用于标识一次计算的“输入快照”（在给定 Definition 下可对账/回放）。

### 5.2 输入选择（Graph v2 规则）

inputsHash **只覆盖 Graph 声明过的输入 pins**（`flow.start.params.dynamicOutputs`）+ job `options`：

```json
{
  "inputs": { "<pin.name>": "<canonicalValueOrNull>" },
  "options": { /* canonicalized job options */ }
}
```

规则：
- 引擎只读取 job payload 的 `inputs.<pin.name>`。
- **未声明字段忽略**：job `inputs` 中未出现在 start pins 的字段不会参与 inputsHash。
- 对每个 pin（按 `pin.name` 升序）：
  - 若 job inputs 缺失：
    - 若存在 `pin.defaultValue`：使用 `defaultValue`
    - 否则：使用 `null`
  - 若最终值为 `null` 且 `pin.required=true`（默认）：视为错误（不会产生 inputsHash）
  - 否则：按 `pin.valueType` 做 typed canonicalize
- `options`：
  - 若 job 未提供 options：使用空对象 `{}`（而不是 `null`）
  - 若提供：只允许引擎支持的稳定字段（具体见实现的 options canonicalize 规则）；未知字段应视为错误

---

## 6. outputsHash

### 6.1 输入对象（规范）

outputsHash 只覆盖 Graph 声明过的输出 pins（`flow.end.params.dynamicInputs`）：

```json
{
  "outputs": {
    "<pin.name>": "<canonicalValue>"
  }
}
```

规则：
- pins 按 `pin.name` 升序。
- 每个输出 pin 都必须在 `outputs` 中出现：
  - 若缺失：视为错误（不会产生 outputsHash）
  - 若为 `null`：仅允许 `valueType=Json`（否则视为错误）
- 对值按 `pin.valueType` 做 typed canonicalize。

### 6.2 计算流程
typed canonicalize → JCS → SHA-256。

---

## 7. 一致性要求（必须）

- 同一 `definitionHash` + 同一 `inputsHash` 必须产出同一 `outputsHash`（确定性）。
- typed canonicalize 与 JCS 实现必须固定版本并有测试向量（建议在仓库内放 golden cases）。

