# basic-node provider 示例（最小占位）

本示例用于约定 **inputs 命名空间** 与 **job.requested** 的投递形态，便于后续按项目需要替换为：
- NestJS Module / SDK（推荐起步）
- 独立微服务（集中治理）

## inputs 约定（建议）

- `inputs.globals.*`：全局变量（如公司配置、币种精度、汇率快照等）
- `inputs.facts.*`：对象事实（如某个 product / customer 的事实数据）
- `inputs.params.*`：调用方本次请求的本地参数
- `inputs._meta.*`：来源与追溯信息（建议进入 `inputsHash`）

## Job Requested（概念示意）

```json
{
  "schemaVersion": 1,
  "jobId": "01J...ULID/UUID",
  "definitionRef": { "definitionId": "pricing.retail", "version": 1 },
  "inputs": {
    "globals": { "company": { "id": "c1" } },
    "facts": { "product": { "id": "p1" } },
    "params": { "quantity": "2" },
    "_meta": { "fxRateAsOf": "2026-03-02T00:00:00Z" }
  }
}
```

更完整的契约请以仓库文档为准：
- `../../../../COMPUTE_ENGINE_DESIGN.md`
- `../../../../API_DESIGN.md`

