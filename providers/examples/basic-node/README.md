# basic-node provider 示例（最小占位）

本示例用于约定 **inputs 命名空间** 与 **job.requested** 的投递形态，便于后续按项目需要替换为：
- NestJS Module / SDK（推荐起步）
- 独立微服务（集中治理）

## inputs 约定（建议）

- `inputs.globals`：全局输入（对应 BlueprintGraph 的 `globals[]` 声明）
- `inputs.params`：入口参数（对应 BlueprintGraph 的 `entrypoints[key].params[]` 声明）
- **允许多余字段**：`inputs` 可携带其它字段（例如 `inputs._meta/inputs.facts/inputs.resolved`），但 Compute Engine 默认不会读取，也不会把未声明字段纳入 `inputsHash`。
  - 若希望某些元信息进入 `inputsHash`：应把它们声明为 `globals/params`（可用 `Json` 聚合字段，例如 `globals.meta`）。

## Job Requested（概念示意）

```json
{
  "schemaVersion": 1,
  "jobId": "01J...ULID/UUID",
  "definitionRef": {
    "definitionId": "pricing.retail",
    "definitionHash": "<definitionHash>"
  },
  "entrypointKey": "main",
  "inputs": {
    "globals": { "companyId": "c1", "meta": { "fxRateAsOf": "2026-03-02T00:00:00Z" } },
    "params": { "quantity": "2" },
    "_meta": { "debug": "allowed but ignored by default" }
  }
}
```

更完整的契约请以仓库文档为准：
- `../../../../COMPUTE_ENGINE_DESIGN.md`
- `../../../../API_DESIGN.md`

