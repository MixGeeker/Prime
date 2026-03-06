# 01｜快速跑通（从 0 到看到一次结果）

## 这份文档适合谁

- 你是第一次跑这个仓库，不知道从哪启动。
- 你想确认“发布图 → 触发 job → 收到结果”这条链路是真的能跑通。
- 你还不想深究架构细节，只要先跑起来。

## 你将完成什么

在 **同一台机器**上完成一条最短链路：

1. 一键启动（Docker）
2. 打开前端（Studio）发布一个 Definition（得到 `definitionHash`）
3. 打开前端（Ops）触发一次 Provider job
4. 在 Jobs/结果里看到成功或失败的结果

## 前置准备（必须）

- **Docker Desktop**（能运行 `docker` 命令）
- **Node.js**（建议 20+；至少要能运行 `node scripts/start.mjs`）
- **Git**（可选：如果你已在本地 workspace 就不需要）

> 说明：本仓库提供了一个启动脚本 `scripts/start.mjs`，它会帮你选择 `dev/test` 两种模式，并尽量自动处理端口冲突。

## 方式 A（推荐）：测试模式 test（全 Docker，一条命令）

在仓库根目录执行（PowerShell）：

```powershell
node .\scripts\start.mjs --mode test
```

看到类似输出即表示启动完成（端口可能因冲突自动 +1，以脚本输出为准）：

- Frontend：`http://localhost:5173`
- Backend health：`http://localhost:4010/health`
- Backend ready：`http://localhost:4010/ready`
- Swagger：`http://localhost:4010/docs`
- Provider Sim：`http://localhost:4020`
- RabbitMQ 管理台：`http://localhost:15672`（账号/密码 `guest/guest`）

查看所有容器日志（新开一个终端）：

```powershell
docker compose -f .\compose.test.yaml logs -f --tail=200
```

停止（保留数据）：

```powershell
node .\scripts\start.mjs --mode test --down
```

停止并清空数据（会删除 DB/MQ volume，等于“重装”）：

```powershell
node .\scripts\start.mjs --mode test --reset
```

## 方式 B：开发模式 dev（只起依赖，其余本机跑）

如果你要改代码、调试，dev 模式更合适。它只启动 PostgreSQL + RabbitMQ，然后你在本机分别启动 backend/worker/frontend（可选再启动 sdk demo）。

启动依赖：

```powershell
node .\scripts\start.mjs --mode dev
```

接下来脚本会在终端里打印“下一步怎么做”（包含 `npm ci`、`.env`、`migration`、`start:dev`、`start:worker` 等），按提示逐个执行即可。

> 提示：如果你看到 Graph 校验报 `globals/entrypoints/outputs`（Graph v1 字段），九成是 **API/worker 有一个没重启**，详见 [`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)。

## 第一步：确认后端就绪

打开浏览器访问：

- `GET /health`：`http://localhost:4010/health`（活着就行）
- `GET /ready`：`http://localhost:4010/ready`（依赖也连上了才会 ready）
- Swagger：`http://localhost:4010/docs`（能看到接口文档）

如果 `/ready` 不通过：

- 先看容器/进程日志（通常是 DB/MQ 连不上、迁移没跑、端口冲突）。
- 再看 [`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md) 的“启动类问题”。

## 第二步：用 Studio 发布一个图（得到 definitionHash）

1. 打开前端：`http://localhost:5173`
2. 进入 **Studio** 页面
3. 新建/打开一个 Definition（名字随便，比如“测试”）
4. 画一个最简单能跑通的图（例如：一个 `flow.start` 接到一个计算节点，再接 `flow.end`）
5. 点 **Validate（校验）**：确保没有红色错误
6. 点 **Publish（发布）**：发布成功后会出现一个 hash（`definitionHash`）

发布以后得到的 `definitionHash` 就像“这份图的指纹”。它不可变。以后 Provider 触发 job 时，必须指定这个 hash 才能保证跑的就是你发布的那一版。

## 第三步：用 Ops 触发一次 Provider job

1. 进入前端的 **Ops** 页面 → **Provider** 标签页
2. 在 `definitionId` 下拉里选择你刚才发布的 Definition
3. 在 `definitionHash` 下拉里选择版本（通常会自动选最新已发布版本）
4. `inputs` 会自动生成一个模板（根据图的入口 pins）：
   - 你只需要把具体值填进去
   - 不认识的字段不要删，先保持结构
5. 点击 **触发**

触发成功后你会得到一个 `jobId`（可以理解为“这次运行的单号”）。

## 第四步：查看结果（成功/失败都算跑通）

你可以用两种方式看结果：

- **在前端看**：Ops → Jobs（或 Provider 页面里的列表）找到对应 `jobId`
- **在 MQ 看**：RabbitMQ 管理台里看队列是否有消费、是否有堆积（更偏运维）

只要你能看到：

- `status = succeeded` 并有 outputs
  - 或者
- `status = failed` 并有可读的 error（例如输入缺字段/类型不对）

就说明链路跑通了。

## 最小排障（只看这一段也够用）

### 1) 页面能开，但触发后一直没结果

通常是 worker 或结果消费端没跑，或者 MQ 没连上：

- 打开 `http://localhost:15672` 看 RabbitMQ 是否正常
- 看 worker 日志里是否有消费 `compute.job.requested.v1`
- 看你的 SDK 结果消费端（或业务模块）是否在消费 `compute.job.succeeded.v1` / `compute.job.failed.v1`

### 2) 报 `GRAPH_SCHEMA_INVALID` 且提到 `globals/entrypoints/outputs`

这是 Graph v1 的字段，说明 **你跑到旧版本进程了**（最常见：worker 没重启）。

解决步骤（最短路径）：

- 停掉所有 backend/worker（或 docker 里的服务）
- 重新启动（test 模式直接 `node scripts/start.mjs --mode test --reset` 最省事）

### 3) inputs 填了但报“缺字段/类型不对”

先别慌，这通常是你填的 inputs 没满足入口 pins 的要求：

- 回到 Studio，看 `flow.start` 的 pins（入口契约）
- Provider 的 inputs **只会读取 start pins**，多余字段一般会被忽略，但缺字段会报错

更完整的排障见：[`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)。


