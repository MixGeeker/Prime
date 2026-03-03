# Provider Simulator（示例服务）

这是一个用于演示 Compute Engine 端到端链路的 **Provider 模拟器**：
- 管理 “全局 facts（inputs.globals）”
- 接收 “业务输入（inputs.params + 其它字段）”
- 发布 `compute.job.requested.v1` 到 RabbitMQ
- 订阅 `compute.job.succeeded.v1 / compute.job.failed.v1` 并落地结果（便于 Ops 仪表盘展示）

## 运行

```bash
cd providers/examples/provider-simulator
cp .env.example .env
npm i
npm run dev
```

启动后默认：
- HTTP：`http://localhost:4020`

## HTTP API（摘要）

- `GET /health`
- `GET /facts/global` / `PUT /facts/global`
- `POST /jobs`（触发一次 job）
- `GET /jobs` / `GET /jobs/:jobId`（查询本模拟器的 job 视图）

> 结果事件为 at-least-once：本服务会按 AMQP `messageId` 去重（messageId=outbox.id）。

