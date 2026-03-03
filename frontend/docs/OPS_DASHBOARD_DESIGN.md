# Ops（示例仪表盘）设计说明

> 目标：提供一个“可跑起来的运维面板样例”，覆盖 definitions/jobs/outbox/DLQ 的核心观测与操作。

## 1. 关键接口
- Definitions 列表：`GET /admin/definitions`
- Jobs 列表/详情：`GET /admin/jobs`、`GET /admin/jobs/:jobId`
- Ops Stats：`GET /admin/ops/stats`（outbox backlog + job 状态聚合）
- DLQ（危险）：`GET /admin/dlq/job-requested/stats`、`POST /admin/dlq/job-requested/replay`

## 2. 危险端点策略
- DLQ replay 默认禁用：需要后端启用 `ADMIN_DANGEROUS_ENDPOINTS_ENABLED=true`
- UI 需要在 “设置” 中配置 Admin Token，并以 `Authorization: Bearer <token>` 发送

## 3. Provider Simulator 联调
- Provider Simulator 用于演示端到端：
  - 管理 `inputs.globals`（全局 facts）
  - 触发 `compute.job.requested.v1`（MQ）
  - 订阅 `compute.job.succeeded/failed.v1` 并展示结果
- 前端通过 `VITE_PROVIDER_SIMULATOR_BASE_URL` 对接（默认 `http://localhost:4020`）

