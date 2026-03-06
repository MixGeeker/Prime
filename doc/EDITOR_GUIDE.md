# Editor 文档（集成方自定义实现）

> Editor（Definition Studio / Editor）最终仍建议由集成方/业务方按自身 UX/权限/审计要求实现。
>
> 本仓库同时提供一个 **可运行的参考实现**：`./frontend/`（Studio + Ops），用于端到端演示与对齐契约（Admin API + Node Catalog + validate/dry-run/publish）。
>
> 参考实现设计说明：
> - `frontend/docs/EDITOR_SAMPLE_DESIGN.md`
> - `frontend/docs/OPS_DASHBOARD_DESIGN.md`

## 1. Editor 的目标
- 可视化创建 Definition（`contentType=graph_json` 的 BlueprintGraph）。
- 支持变量选择、连线、参数配置、静态校验、预览（preview）。
- 支持发布治理流程：draft → publish（产出不可变 release，以 `definitionHash` 标识）→ deprecated，含 diff/changelog。

---

## 2. 依赖的后端能力（来自 Compute Engine）

### 2.1 Node Catalog
Editor 必须从 Node Catalog 获取：
- 可用节点列表（`nodeType`，全局唯一；不再有 `nodeVersion`）
- 输入/输出 ports 与 `valueType`
- exec ports（`execInputs/execOutputs`，用于控制流连线）
- 节点参数 schema（用于渲染配置表单）
- 节点说明文档（用于提示）

控制流相关节点（内置约定，详见 `GRAPH_SCHEMA.md`）：
- `flow.branch` / `flow.sequence` / `flow.while` / `flow.end` / `flow.call_definition`

> Graph v2（UE Blueprint 风格）推荐心智模型：**Pin 即契约**。
> - 输入契约由 `flow.start.params.dynamicOutputs` 的动态输出 pins 定义（Pin 名就是 inputs key）。
> - 输出契约由 `flow.end.params.dynamicInputs` 的动态输入 pins 定义（Pin 名就是 outputs key）。
> - `inputs.*`、`outputs.set.*`、`flow.return` 在 v2 中是禁止的 nodeType，Editor 不应再依赖它们。
>
> UX 建议：把 “编辑输入/输出契约” 收敛到 Start/End 两个节点本身：
> - 支持动态 pins（内联增删 + 详情面板编辑 name/type/required/defaultValue/rounding）
> - 连线时做类型兼容提示（仅同类型 + Ratio→Decimal；不做自动 cast）

### 2.2 Definition Admin API
Editor 通过 Admin API：
- 保存/读取 draft
- validate（实时提示错误/warn）
- dry-run（预览输出）
- publish/deprecate（release 治理）
- 查看 release 列表与详情（diff/回滚/审计）

编辑器侧需要特别注意：
- `content` 只承载 BlueprintGraph（见 `GRAPH_SCHEMA.md`），**不包含** `runnerConfig`；`runnerConfig` 通过 Admin API 的独立字段提交。
- 可把 UI 布局/分组/说明放入 `content.metadata`；引擎执行时忽略，且不参与 `definitionHash`（见 `HASHING_SPEC.md`）。
- 每个 exec 输出端口最多 1 条出边（MVP 简化）；需要“一进多出”的顺序分支请使用 `flow.sequence`。

### 2.3 子蓝图调用（`flow.call_definition`）
Editor 建议提供：
- 依赖选择：用户必须显式选择 `{ definitionId, definitionHash }`（发布物引用冻结）。
- 输出映射：基于被调蓝图的 `flow.end` 输出 pins（`params.dynamicInputs`）列表，配置 `exposeOutputs`（把某些 outputs key 映射到强类型槽位端口）。

---

## 3. 变量接入（来自 SDK / 业务模块）

> 现在默认由业务模块 + SDK 负责输出标准化 `inputs`。Graph v2 通过 `flow.start` 的动态 pins 声明强类型输入契约；Editor 需要帮助用户直接声明这些字段。

### 3.1 Inputs Catalog（可选）
Provider 可输出一份 JSON（或接口）给 Editor，用于：
- 列出允许声明为 **start pin** 的输入字段（以 `name` 表示，而不是路径）
- 每个字段的类型（`Decimal/Ratio/String/Boolean/DateTime/Json`；规范见 `VALUE_TYPES.md`）、说明、示例值

> 引擎在运行时只会对 **start pins 声明过** 的字段做强类型校验/默认值/参与 `inputsHash`；job `inputs` 中的未声明字段允许存在，但默认会被忽略且不可在图内访问。

### 3.2 Json 输入的建图建议（可选）

当某个输入字段本身是结构化对象（例如 `inputs.payload: Json`），Editor 建议提供：
- 顶层 key 浏览（从 Preview inputs 或 Inputs Catalog 的 example 推断），减少手写路径错误
- 逐层解析：链式生成 `json.select(mode=browse)` 节点
- 直达解析：生成 `json.select(mode=path)` 节点
- 强类型转换：在最终叶子值处显式插入 `json.to.*`（Decimal/String/Boolean/DateTime/Ratio）

> 这样可以在保留「允许多余字段传入」的同时，保证“真正参与计算”的叶子值仍然走强类型校验与 canonicalize。

---

## 4. Preview（预览）建议

### 4.1 预览输入
Editor 预览时必须只依赖 `inputs`（样例数据），不得触发任何外部 IO。

### 4.2 两种预览实现
- 调用 Compute Engine `dry-run`（推荐）：保证与线上执行一致，且无需把 runner-core 打包到前端。
- 本地 runner-core（可选）：如果需要离线编辑体验，可由平台提供一个纯 runner-core npm 包；版本必须与引擎一致。

---

## 5. UI 组件建议（不强制）
- 画布：Rete.js / React Flow / 自研
- 节点面板：按 Node Catalog 分类与搜索
- 输入面板：按 Inputs Catalog（可选）或既有约定分类与搜索
- 错误面板：展示 validate 的结构化错误（支持定位到 node/edge/pin/local）
- 发布面板：changelog 必填、diff 预览、权限提示

