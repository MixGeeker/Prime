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
- 数据结构：BlueprintGraph（见 `GRAPH_SCHEMA.md`），在前端类型为 `GraphJsonV1`（`frontend/src/engine/types.ts`）
- UI 元数据：写入 `content.metadata.ui.nodes[nodeId] = {x,y}`（引擎忽略且不参与 `definitionHash`）

## 4. 连线约束（前端预防 + 后端兜底）
- value edges：
  - input 端口最多 1 条入边
  - 必须是 DAG（前端在连线创建时做一次 cycle check；最终以服务端 validate 为准）
- exec edges：
  - exec 输出端口最多 1 条出边（MVP 简化）
  - 允许成环（loop）

## 5. 错误定位
- validate 返回 `ValidationIssue.path`（JSON Pointer）
- 示例实现支持从 `/nodes/<index>/...` 解析 nodeId，并定位到画布节点

