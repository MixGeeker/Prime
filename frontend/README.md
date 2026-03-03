# Prime Engine 前端示例（Studio + Ops）

本目录提供一个**可运行的示例前端**，用于演示如何对接 Compute Engine 后端：
- **Studio（编辑器）**：基于 Node Catalog 进行建图、连线、参数配置；调用 `validate/dry-run/publish`。
- **Ops（仪表盘）**：查看 definitions/jobs/outbox/DLQ 等运维信息；联调端到端示例。

## 前置要求
- Node.js >= 20
- 后端服务可访问（默认：`http://localhost:4010`）
- （可选）Provider Simulator 可访问（默认：`http://localhost:4020`）

## 配置
复制环境变量示例并按需修改：
```bash
cp .env.example .env
```

## 本地运行
```bash
npm i
npm run dev
```

## 端到端演示（推荐）

1) 启动后端（HTTP）：默认 `http://localhost:4010`
2) 启动后端 Worker（MQ consumer + outbox dispatcher）
3) 启动 Provider Simulator：默认 `http://localhost:4020`
4) 启动本前端：默认 `http://localhost:5173`

在 UI 中可完成：
- Studio：创建/编辑草稿 → 校验 → dry-run → 发布（得到 definitionHash）
- Ops/Provider：填入 `{definitionId, definitionHash}` → 触发一次 job → 查看结果事件与 job 详情

## 构建
```bash
npm run build
```

## 设计文档
- Studio：`docs/EDITOR_SAMPLE_DESIGN.md`
- Ops：`docs/OPS_DASHBOARD_DESIGN.md`
