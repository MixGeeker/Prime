# 集成文档

这份目录是给 **第一次接触 Compute Engine 的集成方**准备的。你不需要读完所有设计文档，只要按这里的步骤，就能把引擎接入到你们自己的系统里。

> 重要说明：仓库里的 `frontend/`（Studio + Ops）和 `providers/examples/provider-simulator/` 都是 **示例/参考实现**。
> - 你们可以完全自研 UI（甚至不用画布）。
> - 你们也可以用自己的 Provider 服务/SDK 来拼 inputs、投递 job。
> - 但 **HTTP/MQ 协议、Graph v2 语义、hash 与幂等规则** 是必须遵守的。

## 你应该先看哪一篇

- **只想跑通一条链路**（推荐第一篇）：[`01_QUICKSTART.md`](01_QUICKSTART.md)  
  从启动环境 → 发布一个图 → 触发一次 job → 看到结果。
- **想先搞懂概念（不看黑话）**：[`02_CONCEPTS.md`](02_CONCEPTS.md)  
  用最直白的类比解释 Definition / Release / Job / 三个 hash。
- **你要做自己的 Editor（前端/管理台）**：[`03_EDITOR_INTEGRATION.md`](03_EDITOR_INTEGRATION.md)  
  你需要调用哪些 HTTP、怎么渲染 params 表单、怎么做 validate/dry-run/publish。
- **你要做自己的 Provider（拼 inputs + 投递 job + 收结果）**：[`04_PROVIDER_INTEGRATION.md`](04_PROVIDER_INTEGRATION.md)  
  inputs 怎么拼、jobId 幂等怎么做、结果事件怎么去重。
- **只想要可复制的 HTTP 调用示例**：[`05_HTTP_API_COOKBOOK.md`](05_HTTP_API_COOKBOOK.md)  
  PowerShell / curl 都给你写好。
- **只想要 MQ 协议与 Node.js 示例**：[`06_MQ_PROTOCOL.md`](06_MQ_PROTOCOL.md)  
  RabbitMQ 基础解释 + 发布/订阅示例 + 去重策略。
- **遇到问题先查这里**：[`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)  
  “看到什么错 → 可能原因 → 怎么验证 → 怎么修”。
- **术语不懂就查字典**：[`08_GLOSSARY.md`](08_GLOSSARY.md)  
  每个词给出通俗解释与严格定义。
- **准备上线/验收**：[`09_CHECKLIST.md`](09_CHECKLIST.md)  
  集成验收清单 + 上线前演练清单。

## 这套系统到底在做什么（一句话版）

**Compute Engine 负责“纯计算”**：  
你把计算规则做成一个“蓝图”（Definition），发布后得到一个不可变版本（`definitionHash`）。  
运行时 Provider 把业务数据拼成 `inputs`，投递一个 job，引擎执行后发出成功/失败事件。

## 最常见的坑（提前避雷）

- **API/Worker 版本不一致**：你可能会看到校验报错里出现 `globals/entrypoints/outputs`（Graph v1 字段），这是典型的“某个进程还在跑旧版本”。解决方法见 [`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)。
- **jobId 不复用导致重复执行**：重试/补偿时必须复用同一个 `jobId`，否则引擎会把它当成新的 job 再执行一次。
- **结果事件重复**：结果事件语义是 at-least-once（可能重复），下游必须按 `messageId` 去重。

## 想深入读“权威规范”

这些是更“严格/完整”的文档（不是新手必读，但更权威）：

- 协议权威（HTTP + MQ）：[`../API_DESIGN.md`](../API_DESIGN.md)
- 图语义权威（Graph v2）：[`../GRAPH_SCHEMA.md`](../GRAPH_SCHEMA.md)
- hash 权威：[`../HASHING_SPEC.md`](../HASHING_SPEC.md)
- 类型系统权威：[`../VALUE_TYPES.md`](../VALUE_TYPES.md)
- Provider/Editor 现有指南：[`../PROVIDER_GUIDE.md`](../PROVIDER_GUIDE.md)、[`../EDITOR_GUIDE.md`](../EDITOR_GUIDE.md)
