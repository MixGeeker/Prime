# Editor 文档（集成方自定义实现）

> Editor（Definition Studio / Editor）由集成方/业务方自行实现。Compute Engine 不提供官方 UI，只提供后端标准与能力（Admin API + Node Catalog + validate/dry-run）。

## 1. Editor 的目标
- 可视化创建 Definition（graphJson/DSL）。
- 支持变量选择、连线、参数配置、静态校验、预览（preview）。
- 支持版本发布流程：draft → publish → deprecated，含 diff/changelog。

---

## 2. 依赖的后端能力（来自 Compute Engine）

### 2.1 Node Catalog
Editor 必须从 Node Catalog 获取：
- 可用节点列表（`nodeType@nodeVersion`）
- 输入/输出 ports 与 `valueType`
- 节点参数 schema（用于渲染配置表单）
- 节点说明文档（用于提示）

### 2.2 Definition Admin API
Editor 通过 Admin API：
- 保存/读取 draft
- validate（实时提示错误/warn）
- dry-run（预览输出）
- publish/deprecate（版本治理）
- 查看版本列表与详情（diff/回滚/审计）

编辑器侧需要特别注意：
- `content` 只承载 graphJson（见 `GRAPH_SCHEMA.md`），**不包含** `runnerConfig`；`runnerConfig` 通过 Admin API 的独立字段提交。
- 可把 UI 布局/分组/说明放入 `content.metadata`；引擎执行时忽略，且不参与 `definitionHash`（见 `HASHING_SPEC.md`）。

---

## 3. 变量接入（来自 Inputs Provider）

> Provider 是集成方实现，负责输出标准化 `inputs`。为了让 Editor 体验好，需要一份 Variable Catalog（变量目录）。

### 3.1 Variable Catalog（建议）
Provider 输出一份 JSON（或接口）给 Editor，用于：
- 列出允许使用的 `inputs.*` 路径（如 `inputs.globals.fx_rates.*`）
- 每个变量的类型（如 `Decimal`/`Ratio`/`String`/`Boolean`/`DateTime`/`Json`；规范见 `VALUE_TYPES.md`）、说明、示例值、是否必填

> Editor 用 Variable Catalog 做“选择变量”与类型提示；引擎在运行时只看 job 的 `inputs` 是否满足 Definition 的 `variables`。

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
- 变量面板：按 Variable Catalog 分类与搜索
- 错误面板：展示 validate 的结构化错误（支持定位到 node/edge/variable）
- 发布面板：changelog 必填、diff 预览、权限提示
