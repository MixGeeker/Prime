# Studio（示例编辑器）设计说明

> 目标：提供一个“可运行的参考实现”，对齐 Compute Engine 的契约与关键 UX，而不是替代业务方的生产 Editor。

## 1. 边界
- Studio 只做：建图（nodes/value edges/exec edges）、参数配置、输入契约声明（globals/entrypoints/locals/outputs）、调用后端 `validate/dry-run/publish`。
- Studio 不做：任何外部 IO（DB/HTTP）；所有 facts 都应由 Provider 注入到 job `inputs`。

## 2. 关键对接点
- Node Catalog：`GET /catalog/nodes`
- Draft：`POST/GET/PUT /admin/definitions/:definitionId/draft`
- 校验/预览：`POST /admin/definitions/validate`、`POST /admin/definitions/dry-run`
- 发布：`POST /admin/definitions/:definitionId/publish`

## 3. 画布与数据结构
- 画布：Rete.js（`frontend/src/features/studio/BlueprintCanvas.vue`）
- 数据结构：BlueprintGraph（见 `../../doc/GRAPH_SCHEMA.md`），在前端类型为 `GraphJsonV1`（`frontend/src/engine/types.ts`）
- UI 元数据：写入 `content.metadata.ui.nodes[nodeId] = {x,y}`（引擎忽略且不参与 `definitionHash`）

## 4. 连线约束（前端预防 + 后端兜底）
- value edges：
  - input 端口最多 1 条入边
  - 必须是 DAG（前端在连线创建时做一次 cycle check；最终以服务端 validate 为准）
- exec edges：
  - exec 输出端口最多 1 条出边（MVP 简化）
  - 允许成环（loop）

## 4.1 Json 浏览（Inspector 辅助）
示例实现提供一个最小可用的 Json 浏览器（位于右侧检查器）：
- 针对 `inputs.*.json / core.const.json / json.select`，基于 Preview inputs 推断当前节点 `value:Json` 输出
- 展示顶层 keys，并支持点击 key 自动生成并连线一个子节点 `json.select(mode=browse)`
- 支持输入 path 生成 `json.select(mode=path)`（直达）
- 支持一键插入 `json.to.*` 把叶子 Json 值转换为强类型（用于 math/compare 等节点）

## 4.2 Variables 面板（Inputs 友好入口）
为避免节点库出现“一堆 inputs 节点”，示例实现提供 Variables 面板：
- Inputs 契约仍由 `globals/entrypoints(params)` 声明（强类型 + inputsHash）
- 用户从 Variables 面板点击变量，Studio 自动生成对应的 `inputs.(globals|params).<type>` 节点并填充 `params.name`
- 节点库默认隐藏 `inputs.*`（可通过“显示内部节点”开关查看）

## 5. 错误定位
- validate 返回 `ValidationIssue.path`（JSON Pointer）
- 示例实现支持从 `/nodes/<index>/...` 解析 nodeId，并定位到画布节点
