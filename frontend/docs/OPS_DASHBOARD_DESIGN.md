# Ops（示例仪表盘）设计说明

> 目标：提供一个“可跑起来的运维面板样例”，覆盖 definitions/jobs/outbox/DLQ 的核心观测与操作。

## 1. 关键接口
- Definitions 列表：`GET /admin/definitions`
- Jobs 列表/详情：`GET /admin/jobs`、`GET /admin/jobs/:jobId`
- Ops Stats：`GET /admin/ops/stats`（outbox backlog + job 状态聚合）
- DLQ（危险）：`GET /admin/dlq/job-requested/stats`、`POST /admin/dlq/job-requested/replay`

## 2. 危险端点策略
- DLQ replay 默认禁用：需要后端启用 `ADMIN_DANGEROUS_ENDPOINTS_ENABLED=true`
- UI 需要在“设置”中配置 Admin Token，并以 `Authorization: Bearer <token>` 发送

## 3. 当前定位
- Ops 只展示 **Compute Engine 侧** 的状态与危险运维操作
- Job 的发送、结果回写、业务闭环由 SDK / 业务模块负责
- 前端不再对接 Provider Simulator，也不再维护独立 Provider 视图
