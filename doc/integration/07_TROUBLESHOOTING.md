# 07｜排障手册（看到什么错 → 怎么修）

## 这份文档适合谁

- 你已经能跑起来，但某一步卡住了（发布失败、触发后没结果、job 失败）。
- 你是运维/值班同学，需要快速定位问题在“前端/后端/worker/MQ/Provider”哪一段。

## 先记住：排障的最短路径

1. **先定位在哪一段**：UI 触发？HTTP API？MQ 投递？worker 执行？Provider 收结果？  
2. **再看日志/状态**：`/health`、`/ready`、RabbitMQ 队列堆积、job 详情。  
3. **最后再修**：重启/修配置/修 inputs/修图。

---

## 0) “我该看哪里？”（按场景）

### A. 环境跑在 test（全 Docker）

- 看整体日志：

```powershell
docker compose -f .\compose.test.yaml logs -f --tail=200
```

- 看后端是否就绪：
  - `http://localhost:4010/health`
  - `http://localhost:4010/ready`
  - `http://localhost:4010/docs`
- 看 RabbitMQ：
  - `http://localhost:15672`（guest/guest）

### B. 环境跑在 dev（依赖 Docker，其余本机）

最常见的问题是 **API 跑了新代码但 worker 还在跑旧代码**。  
只要你遇到“Graph v1 字段”相关错误，先把 API 和 worker 一起重启。

---

## 1) `GRAPH_SCHEMA_INVALID`（最常见）

### 1.1 现象：错误里提到 `globals/entrypoints/outputs`

你会看到类似：

- `must have required property 'globals'`
- `must have required property 'entrypoints'`
- `must have required property 'outputs'`

#### 人话解释

这三个字段属于 **Graph v1**。  
而引擎现在只接受 **Graph v2（schemaVersion=2）**。  
所以出现这种报错，最常见原因不是“你画图画错了”，而是 **某个进程还在用旧版本校验器**（典型：worker 没重启）。

#### 怎么验证（最短）

- 这个错误通常发生在 **job 执行阶段**（worker 校验 release.content 失败），所以看：
  - worker 日志
  - `GET /admin/jobs/:jobId` 返回的 error.details

#### 怎么修（最短）

- **test 模式**：直接重启全套（最省事）

```powershell
node .\scripts\start.mjs --mode test --reset
node .\scripts\start.mjs --mode test
```

- **dev 模式**：确保 API + worker 都停掉并重新启动（不要只重启 API）
  - `backend`：`npm run start:dev`
  - `backend`：`npm run start:worker`

#### 额外提醒

- Graph v2 的权威规范见：[`../GRAPH_SCHEMA.md`](../GRAPH_SCHEMA.md)

---

### 1.2 现象：提示 `schemaVersion` 不等于 2

#### 可能原因

- 你上传/保存了旧结构的图（不是 v2）
- 你在某个地方手工构造了图 JSON，忘了写 `"schemaVersion": 2`

#### 怎么修

- 回到 Editor/Studio 确认图顶层结构包含：

```json
{ "schemaVersion": 2, "locals": [], "nodes": [], "edges": [], "execEdges": [] }
```

---

## 2) `DEFINITION_NOT_FOUND` / `DEFINITION_NOT_PUBLISHED`

### 现象

- `DEFINITION_NOT_FOUND`：找不到这个 `definitionId`
- `DEFINITION_NOT_PUBLISHED`：definitionId 存在，但你引用的 hash 没发布/不可执行

### 人话解释

你要么拼错了 id/hash，要么发布步骤没做完。

### 怎么验证

- 列出 definitions：`GET /admin/definitions?q=<id>`
- 列出 releases：`GET /admin/definitions/:definitionId/releases`

（可直接抄命令）：[`05_HTTP_API_COOKBOOK.md`](05_HTTP_API_COOKBOOK.md)

### 怎么修

- 确认你引用的是 `status = published` 的 `definitionHash`
- 如果没有 published：回到 Studio/Editor 重新 Publish

---

## 3) `INPUT_VALIDATION_ERROR`（inputs 填错/缺字段）

### 现象

job 失败，error.code = `INPUT_VALIDATION_ERROR`，details 里可能有“缺字段”“类型不匹配”等。

### 人话解释

Provider 传进来的 `inputs` 没满足图的入口契约（`flow.start` pins）。
最常见的是：必填字段缺失、Decimal/Ratio 传了不合法的值、Json pin 传了非 object。

### 怎么验证

1. 回到 Studio/Editor，看 `flow.start.params.dynamicOutputs`（入口 pins）
2. 对照 pins 的 `name/valueType/required/defaultValue` 检查你的 inputs

### 怎么修

- 缺字段：补上对应 `inputs[pin.name]`
- 类型不对：按类型系统要求改（详见 [`../VALUE_TYPES.md`](../VALUE_TYPES.md)）
- Decimal/Ratio：建议用字符串（例如 `"10.2"`）

---

## 4) `DEFINITION_DEPENDENCY_*`（子蓝图 call_definition 相关）

### 现象

- `DEFINITION_DEPENDENCY_NOT_FOUND`：子图的 `definitionId/hash` 不存在
- `DEFINITION_DEPENDENCY_NOT_PUBLISHED`：子图没发布或不可执行
- `DEFINITION_DEPENDENCY_CYCLE`：子图依赖成环

### 人话解释

你的图里用了 `flow.call_definition` 调用别的图，但引用不对或依赖关系有问题。

### 怎么修

- 确保被调用的子图 release 已发布（published）
- 确保引用的是正确的 `definitionId + definitionHash`
- 避免循环依赖（A 调 B，B 又调 A）

---

## 5) “触发了 job，但一直没结果/页面不更新”

### 常见原因清单

- worker 没在消费 `compute.job.requested.v1`
- MQ 断连或 exchange/queue 配错
- Provider 没在消费结果事件（或没 ack，导致一直堆积）

### 怎么验证（按顺序）

1. RabbitMQ UI：看队列是否堆积、是否有消费者（`consumers`）
2. 看 worker 日志：是否有收到 job requested
3. 看 Provider 日志：是否有收到 succeeded/failed

### 怎么修

- 修 exchange/queue 配置（见 [`06_MQ_PROTOCOL.md`](06_MQ_PROTOCOL.md)）
- 重启 worker/provider（最常见）

---

## 6) Outbox backlog（事件发不出去/延迟很大）

### 人话解释

系统为了保证“数据库写入”和“发 MQ 事件”一致性，会用 outbox。  
如果 outbox 堆积，说明 MQ 发布失败或 worker/发布器卡住。

### 怎么验证

- `GET /admin/ops/stats` 看 outbox `pending/failed`
- RabbitMQ 是否正常、连接是否频繁断开

### 怎么修

- 先恢复 MQ（网络/账号/权限/端口）
- 然后重启相关进程（API/worker/outbox publisher）

---

## 7) RUNNER_TIMEOUT / 执行资源限制

### 人话解释

图跑得太久/步骤太多，触发了 runner 的保护限制（避免死循环把系统拖垮）。

### 怎么修

- 优化图（减少循环、减少节点数、减少深度）
- 调整 runnerConfig（需要你们运维允许；见权威文档）

---

## 8) 如果你不知道怎么描述问题（给你一个模板）

请把下面这些信息贴出来（越全越好）：

- 你用的是 `dev` 还是 `test` 模式
- 后端 `/ready` 是否通过
- `jobId`
- `GET /admin/jobs/:jobId` 的返回（尤其是 `error.code` 和 `details`）
- worker / provider 的日志片段（出现错误前后 30 行）
- RabbitMQ UI：相关队列的 `messages`、`consumers` 截图/数值

