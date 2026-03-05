# Provider Simulator（示例服务）

这是一个用于演示 Compute Engine 端到端链路的 **Provider 模拟器**：
- 管理 “全局 facts”（Provider 内部存储；投递时合并进 `inputs`）
- 接收 “业务输入（inputs + 其它字段）”
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

## 性能基线（优化前）

> 说明：该基线用于对比优化效果；实际数值会受机器性能、磁盘、Docker/WSL、DB/MQ 负载影响。

- `500` 总数 / `10` 并发：约 **281 req/s**（端到端完成）
- `5000` 总数 / `100` 并发：约 **41.6 req/s**（提交吞吐成为瓶颈）

（以上为本机实测输出节选）

## 吞吐优化（已实现）

本服务的吞吐瓶颈通常不在 Compute Engine（worker/DB），而在 Provider Simulator 自身：

- **本地存储写盘**：从“每次更新都全量写 JSON 文件”改为**异步批量落盘**（可调时间窗）。
- **MQ confirm**：从“每条消息都 `waitForConfirms()`”改为**批处理确认**（可调时间窗/批次大小）。

### 可调参数（见 `.env.example`）

- `STORAGE_FLUSH_INTERVAL_MS`：写盘合并窗口（ms）。压测建议 100~500。
- `STORAGE_PRETTY_JSON`：是否输出 pretty JSON（更慢；压测建议 `false`）。
- `MQ_PUBLISH_CONFIRM_INTERVAL_MS`：发布 confirm 合并窗口（ms）。
- `MQ_PUBLISH_CONFIRM_BATCH_SIZE`：待确认数达到阈值时触发一次 confirm flush。

### 优化后参考结果（本机实测）

- `5000` 总数 / `100` 并发：**提交吞吐约 4000 req/s**；端到端完成约 **560 req/s**（此时瓶颈转为 Compute Engine 消费/落库链路）。

