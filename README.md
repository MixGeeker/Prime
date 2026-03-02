# Prime / Compute Engine（单体仓库）

本仓库是 **可插拔 Compute Engine** 的单体仓库（monorepo）：把 **文档**、**后端服务**、以及后续的 **Definition Studio（前端/管理端）**、**Inputs Provider 示例** 放在一起演进与发布。

## 目录结构

- `./backend/`：Compute Engine 后端（NestJS + TypeORM）
- `./frontend/`：Definition Studio / Editor（占位，后续实现）
- `./providers/`：Compute Inputs Provider（规范 + 示例）
- `./*.md`：设计/规范文档（见下方“文档索引”）

## 快速开始（后端）

在 `backend/` 下运行：

```bash
npm i
cp .env.example .env
npm run migration:run
npm run start:dev
```

- Health：`GET /health`
- Ready：`GET /ready`
- Swagger UI：`GET /docs`

## 文档索引

- 总体设计：`COMPUTE_ENGINE_DESIGN.md`
- 后端执行链路：`BACKEND_EXECUTION.md`
- 后端工程指南：`BACKEND_GUIDE.md`
- API 设计：`API_DESIGN.md`
- 图/DSL Schema：`GRAPH_SCHEMA.md`
- 值类型：`VALUE_TYPES.md`
- Hash 规范：`HASHING_SPEC.md`
- Provider 指南：`PROVIDER_GUIDE.md`
- Editor 指南：`EDITOR_GUIDE.md`

## 约定（推荐）

- **Node 依赖**：每个子项目各自维护依赖（例如 `backend/package.json`），避免在仓库根引入统一包管理的额外复杂度（后续需要再升级为 pnpm/yarn workspaces）。
- **避免提交产物**：`node_modules/`、`dist/`、`.env` 等均已在仓库级 `.gitignore` 忽略。

