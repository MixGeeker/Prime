# 09｜集成验收清单 & 上线前演练清单

## 这份文档适合谁

- 你要做集成验收（“到底算不算接好了？”）。
- 你要准备上线，想在发布前把常见故障场景演练一遍。

> 建议用法：每一条都能给出“证据”（截图/日志/jobId/接口返回），不要只打勾不留痕。

---

## A. 最小闭环验收（必做）

### A1) 环境可用性

- [ ] 后端 `GET /health` 返回正常
- [ ] 后端 `GET /ready` 返回正常（依赖已连接）
- [ ] Swagger 可打开：`/docs`
- [ ] RabbitMQ 管理台可打开（开发/测试环境）：`15672`，能看到 exchange/queue

### A2) Editor 能完成“发布”

- [ ] 能读取 Node Catalog（`GET /catalog/nodes`）并展示节点列表
- [ ] 能创建/读取/更新 draft（Draft 可保存并恢复）
- [ ] Validate 能返回错误，并在 UI 里可定位到节点/字段（至少能展示 message + path）
- [ ] Dry-run 能在 UI 里运行并显示 outputs（不走 MQ）
- [ ] Publish 成功后拿到 `definitionHash`
- [ ] 发布后能在 releases 列表里看到该版本（status=published）

### A3) SDK / 业务模块能完成“执行 + 收结果”

- [ ] 能选择一个已发布 release（`definitionId + definitionHash`）
- [ ] 能按 `flow.start` pins 生成 inputs 模板，并能正确填值
- [ ] 能投递 `compute.job.requested.v1`（commands exchange + routingKey 正确）
- [ ] 能消费 `compute.job.succeeded.v1` / `compute.job.failed.v1`
- [ ] 成功时能拿到 outputs 并写回业务侧（落库/回调/发事件，按你们系统定义）
- [ ] 失败时能把 `error.code/message/details` 记录下来并可追溯到 jobId

### A4) 运维可观测性（强烈建议）

- [ ] 能通过 `GET /admin/jobs/:jobId` 查到一次 job 的结果（排障闭环）
- [ ] 能通过 `GET /admin/ops/stats` 看到 outbox backlog（pending/failed）
- [ ] 能定位“消息堆积在哪个队列”（RabbitMQ UI/管理 API）

---

## B. 可靠性验收（建议做）

### B1) jobId 幂等

- [ ] 同一笔业务重试时复用同一个 `jobId`
- [ ] 重复投递同一个 `jobId` 不会导致业务侧重复写入（至少不会“写坏”）
- [ ] SDK / 业务模块能处理“发布超时但实际已发布”的情况（确认后再重试）

### B2) 结果事件去重（messageId）

- [ ] SDK / 业务模块保存已处理 `messageId` 的集合（持久化）
- [ ] 同一个结果事件重复投递时，不会重复落库/重复回调

### B3) 输入校验前置（体验优化）

- [ ] SDK / 业务模块或 Editor 能在投递前做 inputs 基本校验（缺字段/类型不对尽量早点提示）
- [ ] UI 层能提示“重复 pin name”（避免连线/显示异常）

---

## C. 上线前演练清单（故障注入）

> 目标：你们要在“可控的演练”里遇到一次故障，而不是上线后第一次遇到。

### C1) MQ 短暂不可用

- [ ] 停掉 RabbitMQ 30 秒再启动（或断网模拟）
- [ ] SDK / 业务模块能自动重连（不会永远挂死）
- [ ] outbox 会堆积但不会丢（恢复后会逐步清空）

### C2) 重复投递（至少一次语义）

- [ ] 手工把同一个 job 请求重复发 2 次（相同 jobId）
- [ ] 业务侧结果只写入一次（幂等）
- [ ] 手工模拟结果事件重复（相同 messageId）
  - SDK / 业务模块能去重并只处理一次

### C3) worker 重启

- [ ] job 执行过程中重启 worker（或 kill 进程再起）
- [ ] 系统不会“卡死在 running”（至少能恢复/重试/标记失败）
- [ ] 日志/告警能定位到故障窗口

### C4) 版本不一致（真实踩坑复现）

- [ ] 故意让 API 和 worker 跑不同版本一次（或只重启其中一个）
- [ ] 能识别典型现象：`GRAPH_SCHEMA_INVALID` 提到 `globals/entrypoints/outputs`
- [ ] 有明确 SOP：重启/回滚/统一版本（见 [`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)）

---

## D. 交付物清单（建议）

- [ ] 一份你们自己的“SDK 接入说明”（面向业务方：要填哪些 inputs、输出是什么）
- [ ] 一份“运维 Runbook”（如何看队列、如何重启、常见错误码）
- [ ] 一份“版本管理策略”（definitionHash 如何选择/回滚/弃用）


