# Editor 文档（集成方自定义实现）

> Editor（Definition Studio / Editor）由集成方/业务方自行实现。Compute Engine 不提供官方 UI，只提供后端标准与能力（Admin API + Node Catalog + validate/dry-run）。

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
- `flow.branch` / `flow.sequence` / `flow.while` / `flow.return` / `flow.call_definition`

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
- 输出映射：基于被调蓝图的 `outputs[]` 列表，配置 `exposeOutputs`（把某些 outputs key 映射到强类型槽位端口）。

---

## 3. 变量接入（来自 Inputs Provider）

> Provider 是集成方实现，负责输出标准化 `inputs`。BlueprintGraph 通过 `globals/entrypoints(params)` 声明强类型输入契约；Editor 需要帮助用户“选择要声明的输入字段”。（可选：Inputs Catalog）

### 3.1 Inputs Catalog（可选）
Provider 可输出一份 JSON（或接口）给 Editor，用于：
- 列出允许声明为 `globals/params` 的输入字段（以 `name` 表示，而不是路径）
- 每个字段的类型（`Decimal/Ratio/String/Boolean/DateTime/Json`；规范见 `VALUE_TYPES.md`）、说明、示例值

> 引擎在运行时只读取 job payload 的 `inputs.globals/inputs.params` 中**已声明**的字段；未声明字段允许存在但默认不可读、也不进入 `inputsHash`。

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
- 错误面板：展示 validate 的结构化错误（支持定位到 node/edge/global/param/local）
- 发布面板：changelog 必填、diff 预览、权限提示
