# 集成文档

这份目录是给 **第一次接触 Compute Engine 的集成方** 准备的。你不需要读完所有设计文档，只要按这里的步骤，就能把引擎接入到你们自己的系统里。

> 重要说明：仓库里的 `frontend/` 是 **示例/参考实现**；默认集成方式是 `sdk/`。
> - 你们可以完全自研 UI（甚至不用画布）
> - 你们也可以直接在自己的业务模块里构建 `inputs`
> - 但 **HTTP/MQ 协议、Graph v2 语义、hash 与幂等规则** 是必须遵守的

## 你应该先看哪一篇

- **只想跑通一条链路**：[`01_QUICKSTART.md`](01_QUICKSTART.md)
- **想先搞懂概念**：[`02_CONCEPTS.md`](02_CONCEPTS.md)
- **你要做自己的 Editor**：[`03_EDITOR_INTEGRATION.md`](03_EDITOR_INTEGRATION.md)
- **你要接入 SDK / 构建 inputs / 投递 job / 收结果**：[`04_SDK_INTEGRATION.md`](04_SDK_INTEGRATION.md)
- **只想要可复制的 HTTP 调用示例**：[`05_HTTP_API_COOKBOOK.md`](05_HTTP_API_COOKBOOK.md)
- **只想要 MQ 协议与 Node.js 示例**：[`06_MQ_PROTOCOL.md`](06_MQ_PROTOCOL.md)
- **遇到问题先查这里**：[`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)
- **术语不懂就查字典**：[`08_GLOSSARY.md`](08_GLOSSARY.md)
- **准备上线/验收**：[`09_CHECKLIST.md`](09_CHECKLIST.md)

## 这套系统到底在做什么（一句话版）

**Compute Engine 负责“纯计算”**：
你把计算规则做成一个蓝图（Definition），发布后得到一个不可变版本（`definitionHash`）。
运行时由业务模块通过 SDK 把数据拼成 `inputs`，投递一个 job，引擎执行后发出成功/失败事件。

## 想深入读“权威规范”

- 协议权威（HTTP + MQ）：[`../API_DESIGN.md`](../API_DESIGN.md)
- 图语义权威（Graph v2）：[`../GRAPH_SCHEMA.md`](../GRAPH_SCHEMA.md)
- hash 权威：[`../HASHING_SPEC.md`](../HASHING_SPEC.md)
- 类型系统权威：[`../VALUE_TYPES.md`](../VALUE_TYPES.md)
- SDK 指南：[`../SDK_GUIDE.md`](../SDK_GUIDE.md)
- Editor 指南：[`../EDITOR_GUIDE.md`](../EDITOR_GUIDE.md)


