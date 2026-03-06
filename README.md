# 太一计算引擎（Prime Compute Engine）

> **太一**，取自中国传统哲学“太一生水、化生万物”之意——以一套可插拔的计算内核，驱动业务中千变万化的规则与数值推导。

本仓库是 **太一计算引擎** 的单体仓库（monorepo）：把 **文档**、**后端服务**、**Definition Studio（前端/管理端）**、**Integration SDK** 与若干 **历史 Provider 示例** 放在一起演进与发布。

---

## 解决了什么问题

传统业务系统中，**规则计算逻辑**往往散落在各个服务的代码深处：

- 精算/定价公式 hardcode 在业务代码里，每次调整都要发版；
- 不同业务线各自维护一套“计算服务”，逻辑重复、维护成本高；
- 计算过程不可视、不可审计，出了问题难以排查溯源；
- 输入数据来源分散，系统间集成靠硬编码对接，耦合严重。

**太一计算引擎**将计算逻辑从业务代码中抽离，提供一套统一的、**图驱动（Graph-based）的可插拔计算平台**，让业务规则的定义、执行与审计形成闭环。

---

## 有什么意义

| 维度 | 价值 |
|------|------|
| **研发效率** | 规则变更无需重新发版，在 Studio 配置即可生效 |
| **可维护性** | 计算图可视化，逻辑一目了然，告别“黑盒计算” |
| **可复用性** | 一套引擎服务多条业务线，避免重复造轮子 |
| **可审计性** | 每次计算留有完整的输入快照与结果记录，合规可溯源 |
| **可扩展性** | 通过 SDK 与模块化 inputs builder 解耦集成与纯计算 |
| **稳定性** | 基于事件驱动（RabbitMQ）异步执行，峰值流量下不阻塞主链路 |

---

## 使用方法

### 1. 快速启动（推荐：Agent 脚本）

在仓库根目录运行：

```bash
node scripts/start.mjs
```

脚本会引导你选择：
- **开发模式（dev）**：仅启动依赖（PostgreSQL + RabbitMQ），其余在本机跑；
- **测试模式（test）**：全 Docker 启动（依赖 + backend + worker + frontend）。

完整步骤见：`doc/GETTING_STARTED.md`

### 2. 仅启动后端服务

```bash
cd backend/
npm i
cp .env.example .env
npm run migration:run
npm run start:dev
```

- Health 检查：`GET /health`
- Ready 检查：`GET /ready`
- Swagger UI（API 文档）：`GET /docs`

### 3. 端到端完整体验

1. 启动后端 HTTP + Worker（见 `backend/README.md`）；
2. 启动前端 Studio：`frontend/`；
3. 使用 SDK 或业务模块发送 `compute.job.requested.v1`；
4. 在 Ops 查看 jobs / outbox / DLQ。

> 完整链路：SDK / 业务模块投递 `compute.job.requested.v1` → Worker 执行计算图 → Outbox 发布结果事件 → 业务模块消费 `job.succeeded/failed`。

### 4. 接入自己的业务系统（集成方）

参考 `doc/integration/README.md` 与 `sdk/README.md`，按 flat `inputs` 契约实现一个 **集成 SDK / 模块化 inputs builder**，即可将太一计算引擎嵌入你的业务流程。

---

## 目录结构

```
.
├── backend/        # 计算引擎后端（NestJS + TypeORM）
├── frontend/       # Studio 编辑器 + Ops 仪表盘（Vue3 + Element Plus + Rete）
├── sdk/            # Integration SDK（inputs builder + sendJob + results consumer）
├── providers/      # 历史 Provider 规范 + 示例（迁移参考，非默认方案）
└── doc/            # 设计 / 规范文档（见下方“文档索引”）
```

---

## 文档索引

| 文档 | 说明 |
|------|------|
| `doc/integration/README.md` | 集成文档（面向集成方） |
| `doc/COMPUTE_ENGINE_DESIGN.md` | 总体设计 |
| `doc/BACKEND_EXECUTION.md` | 后端执行链路 |
| `doc/BACKEND_GUIDE.md` | 后端工程指南 |
| `doc/API_DESIGN.md` | API 设计 |
| `doc/GRAPH_SCHEMA.md` | 图 / DSL Schema |
| `doc/VALUE_TYPES.md` | 值类型规范 |
| `doc/HASHING_SPEC.md` | Hash 规范 |
| `doc/SDK_GUIDE.md` | SDK 集成指南 |
| `doc/PROVIDER_GUIDE.md` | Provider 迁移说明（历史文件） |
| `doc/EDITOR_GUIDE.md` | Editor 使用指南 |
| `sdk/README.md` | SDK 代码级快速上手 |

---

## 开发约定

- **Node 依赖**：每个子项目各自维护依赖（`backend/package.json` 等），避免在仓库根引入统一包管理的额外复杂度（后续按需升级为 pnpm/yarn workspaces）。
- **避免提交产物**：`node_modules/`、`dist/`、`.env` 等均已在仓库级 `.gitignore` 忽略。
