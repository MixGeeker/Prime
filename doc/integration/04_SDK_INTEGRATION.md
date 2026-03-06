# 04｜SDK 集成（构建 inputs、投递 job、收结果）

## 这份文档适合谁

- 你们要把 Engine 的计算能力接到自己的业务系统里（计费、风控、报价、规则计算）
- 你们准备通过共享 SDK 接入，而不是维护独立 Provider 服务
- 你们想抓住必守规则：inputs 契约、幂等、去重、错误处理

---

## SDK 到底负责什么

SDK 可以理解成“协议适配层”：

- 帮你把 flat `inputs` 封装进 `compute.job.requested.v1`
- 帮你生成/复用 `jobId`
- 帮你通过 RabbitMQ 投递 job
- 帮你订阅 `compute.job.succeeded.v1 / failed.v1`
- 帮你做 `messageId` 去重

业务模块负责：
- 读取自己的业务数据
- 构建 inputs 片段
- 决定结果怎么落库/回调/发业务事件

---

## inputs 怎么拼（最关键）

### 解释：只看 `flow.start` 声明的 pins

Graph v2 里，图的输入契约来自 `flow.start.params.dynamicOutputs[]`。
发送 job 时，**只有这些 pin.name 对应的字段会被读取/校验**。

### 严格规则

- `inputs` 必须是一个 JSON object
- 对于 `Decimal/Ratio`：推荐用 **字符串** 表示
- 缺必填字段（required 且最终值为 null）会触发 `INPUT_VALIDATION_ERROR`
- 影响结果的元信息必须进入声明过的 start pins，而不是只放在 `_meta`

### 示例

```json
{
  "inputs": {
    "basePrice": "100",
    "taxRate": "0.13",
    "meta": { "requestedBy": "billing-module" },
    "_meta": { "traceId": "debug-only" }
  }
}
```

---

## 模块化构建方式

推荐把 inputs 的构建拆给多个业务模块：

1. `pricing-module` 输出 `{ basePrice, taxRate }`
2. `company-module` 输出 `{ companyName }`
3. `audit-module` 输出 `{ meta }`
4. SDK `inputsBuilder` 合并这些片段，并在 key 冲突时直接失败

这样可以避免：
- 单独维护一个 Provider 服务
- 再做一层全局参数注入系统
- 为了拼 inputs 多维护一套运维与部署面

---

## jobId 幂等怎么做

- 重试必须复用同一个 `jobId`
- 最简单是 UUID，但不能在重试时重新生成
- 更稳妥是业务主键派生（例如 `hash(orderId + definitionHash + window)`）

---

## 结果事件为什么要去重（messageId）

`succeeded/failed` 事件是 **至少一次（at-least-once）**，所以消费方必须去重。

SDK 推荐：
- 用 `messageId` 做去重键
- 成功执行你的业务回调后，再标记已处理

---

## 最小实践建议

- **默认方案**：业务模块 + 共享 SDK
- **不推荐默认方案**：再起一个独立 Provider 服务
- **例外**：只有当你们确实需要集中治理、统一缓存、跨团队共享集成运行时，才考虑独立服务
