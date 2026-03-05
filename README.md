# Prime / Compute Engine（单体仓库）

本仓库是 **可插拔 Compute Engine** 的单体仓库（monorepo）：把 **文档**、**后端服务**、以及后续的 **Definition Studio（前端/管理端）**、**Inputs Provider 示例** 放在一起演进与发布。

## 目录结构

- `./backend/`：Compute Engine 后端（NestJS + TypeORM）
- `./frontend/`：**示例前端**（Studio 编辑器 + Ops 仪表盘；Vue3 + Element Plus + Rete）
- `./providers/`：Compute Inputs Provider（规范 + 示例：Provider Simulator + 业务样例）
- `./doc/`：设计/规范文档（见下方“文档索引”）

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

## 快速开始（推荐：Agent 启动）

在仓库根目录运行：

```bash
node scripts/start.mjs
```

脚本会询问你选择：
- **开发模式（dev）**：仅启动依赖（PostgreSQL + RabbitMQ）
- **测试模式（test）**：全 Docker 启动（依赖 + backend + worker + provider + frontend）

完整步骤见：`doc/GETTING_STARTED.md`

## 快速开始（端到端示例）

1) 启动后端 HTTP + Worker（见 `backend/README.md`）
2) 启动 Provider Simulator：`providers/examples/provider-simulator/`
3) 启动前端：`frontend/`

> 端到端演示会走 MQ：Provider Simulator 投递 `compute.job.requested.v1` → Worker 执行 → Outbox 发布结果事件 → Provider Simulator 订阅并展示。

## 文档索引

- 集成文档（小白版，面向集成方）：`doc/integration/README.md`
- 总体设计：`doc/COMPUTE_ENGINE_DESIGN.md`
- 后端执行链路：`doc/BACKEND_EXECUTION.md`
- 后端工程指南：`doc/BACKEND_GUIDE.md`
- API 设计：`doc/API_DESIGN.md`
- 图/DSL Schema：`doc/GRAPH_SCHEMA.md`
- 值类型：`doc/VALUE_TYPES.md`
- Hash 规范：`doc/HASHING_SPEC.md`
- Provider 指南：`doc/PROVIDER_GUIDE.md`
- Editor 指南：`doc/EDITOR_GUIDE.md`

## 约定（推荐）

- **Node 依赖**：每个子项目各自维护依赖（例如 `backend/package.json`），避免在仓库根引入统一包管理的额外复杂度（后续需要再升级为 pnpm/yarn workspaces）。
- **避免提交产物**：`node_modules/`、`dist/`、`.env` 等均已在仓库级 `.gitignore` 忽略。

