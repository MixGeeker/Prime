# 快速启动指南（开发模式 / 测试模式）

本仓库提供两种启动模式：

- **开发模式（dev）**：仅用 Docker 启动依赖（PostgreSQL + RabbitMQ），其余服务在本机用 `npm` 启动，方便调试与热更新。
- **测试模式（test）**：全 Docker 启动（依赖 + backend + worker + provider-simulator + frontend），适合演示/联调/集成测试环境。

> 推荐统一入口：`node scripts/start.mjs`（会询问你选择 dev/test）。

---

## 0. 前置要求

- Docker Desktop（或 Docker Engine）+ Docker Compose（`docker compose`）
- Node.js >= 18（推荐 20+）+ npm

---

## 1) 开发模式（dev：仅依赖 Docker）

### 1.1 启动依赖

在仓库根目录执行：

```bash
node scripts/start.mjs --mode dev
```

> 如果你本机已经有 PostgreSQL/RabbitMQ 占用了默认端口（例如 5432），脚本会自动选择可用端口并提示你把 `.env` 里的连接串改到对应端口。

等价命令：

```bash
docker compose -f compose.dev.yaml up -d
```

依赖服务：
- PostgreSQL：`localhost:5432`（db: `compute_engine`，user/pass: `postgres/postgres`）
- RabbitMQ：`localhost:5672`（管理台 `http://localhost:15672`，`guest/guest`）

### 1.2 启动后端（HTTP）

```bash
cd backend
npm ci
cp .env.example .env
npm run migration:run
npm run start:dev
```

### 1.3 启动 Worker

```bash
cd backend
npm run start:worker
```

> 提示：默认 `WORKER_METRICS_PORT=4021`，避免与 Provider Simulator 的 4020 冲突（见 `backend/.env.example`）。

### 1.4 启动 Provider Simulator

```bash
cd providers/examples/provider-simulator
npm ci
cp .env.example .env
npm run dev
```

### 1.5 启动前端（Studio + Ops）

```bash
cd frontend
npm ci
cp .env.example .env
npm run dev
```

### 1.6 常用地址

- Backend health：`http://localhost:4010/health`
- Backend ready：`http://localhost:4010/ready`
- Swagger UI：`http://localhost:4010/docs`
- RabbitMQ 管理台：`http://localhost:15672`（`guest/guest`）
- 前端：Vite 启动后终端会输出地址（默认 `http://localhost:5173`）

---

## 2) 测试模式（test：全 Docker）

在仓库根目录执行：

```bash
node scripts/start.mjs --mode test
```

> 如果端口冲突，脚本会自动换端口（并同步到容器端口映射）；输出里会给出实际访问地址。

等价命令：

```bash
docker compose -f compose.test.yaml up -d
```

### 2.1 常用地址

- 前端：`http://localhost:5173`
- Backend health：`http://localhost:4010/health`
- Backend ready：`http://localhost:4010/ready`
- Swagger UI：`http://localhost:4010/docs`
- RabbitMQ 管理台：`http://localhost:15672`（`guest/guest`）

### 2.2 查看日志

```bash
docker compose -f compose.test.yaml logs -f --tail=200
```

---

## 3) 停止 / 清理 / 重置

### 3.1 停止（保留数据）

```bash
node scripts/start.mjs --mode dev --down
node scripts/start.mjs --mode test --down
```

等价命令：

```bash
docker compose -f compose.dev.yaml down
docker compose -f compose.test.yaml down
```

### 3.2 重置（清空数据：会删除 volumes）

```bash
node scripts/start.mjs --mode dev --reset
node scripts/start.mjs --mode test --reset
```

等价命令：

```bash
docker compose -f compose.dev.yaml down -v
docker compose -f compose.test.yaml down -v
```

---

## 4) 下一步：集成文档

如果你已经把环境启动起来了，建议从“集成视角”继续往下读（面向 Editor/Provider 集成方）：

- 集成文档入口：[`integration/README.md`](integration/README.md)
- 最快跑通一条链路：[`integration/01_QUICKSTART.md`](integration/01_QUICKSTART.md)
- 看到错误不知道怎么修：[`integration/07_TROUBLESHOOTING.md`](integration/07_TROUBLESHOOTING.md)
