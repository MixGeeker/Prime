# SDK 集成指南

> 这是新的默认集成路径。历史上名为“Provider”的职责，现在收敛为：**业务模块构建 flat `inputs` + SDK 负责协议封装**。

另见：
- Graph schema（Graph v2）：`GRAPH_SCHEMA.md`
- Hash 规范：`HASHING_SPEC.md`
- 值类型：`VALUE_TYPES.md`
- 代码级快速上手：`../sdk/README.md`

---

## 1. SDK 的边界

### 1.1 SDK 负责
- 封装 `compute.job.requested.v1` 的发布协议
- 封装 `compute.job.succeeded.v1 / failed.v1` 的订阅与 `messageId` 去重辅助
- 提供模块化 `inputs` builder，把多个业务模块产出的片段合并成 flat `inputs`

### 1.2 SDK 不负责
- 不拥有业务 facts 的权威数据
- 不决定具体读哪个业务模块/写回哪个业务系统
- 不把业务结果直接落库；结果回写由业务模块负责

---

## 2. 标准 inputs 结构（Graph v2）

Graph v2 的输入契约由 `flow.start` 动态 pins 定义；发送 job 时应使用**单一 `inputs` object**：

```json
{
  "inputs": {
    "companyName": "Prime Inc.",
    "taxRate": "0.13",
    "payload": { "price": { "base": "100" } },
    "_meta": { "source": "billing-module" }
  }
}
```

规则：
- `inputs.<name>` 必须与 `flow.start.params.dynamicOutputs[].name` 对齐
- 未声明字段允许存在，但默认不会进入 `inputsHash`
- 如果某些上下文必须参与回放/对账，应把它们声明成 start pin（通常用一个 `Json` pin 聚合）

---

## 3. 模块化构建方式

推荐把 inputs 的构建责任放回业务模块：

1. 业务模块读取自己拥有的 facts / 请求参数
2. 每个模块输出一段 flat `inputs` 片段
3. SDK 的 `inputsBuilder` 负责 merge，并在 key 冲突时直接失败
4. SDK 发布 `compute.job.requested.v1`

这意味着：
- 不再需要独立 Provider 服务去做“统一全局参数注入”
- 是否使用缓存、降级、批量加载，由业务模块自己决定
- 引擎只接收已经物化完成的最终 `inputs`

---

## 4. 结果消费

结果事件是 **at-least-once**：
- `compute.job.succeeded.v1`
- `compute.job.failed.v1`

SDK 推荐做法：
- 以 `messageId` 为去重键
- 成功消费后再标记已处理
- 真正的业务落库 / 回调 / 发业务事件，由业务模块回调完成

---

## 5. 迁移建议

如果你之前把 Provider 当成“全局参数注入层”：
- 现在把注入逻辑拆回业务模块
- 统一通过 SDK 的 `inputsBuilder` 合并为 flat `inputs`
- 不再维护 Provider 的独立运行时、配置、监控与持久化视图
