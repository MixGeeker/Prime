# 02｜核心概念（全部用人话解释）

## 这份文档适合谁

- 你已经能跑起来，但不知道“Definition / Release / hash / job”到底是什么。
- 你要给同事做技术对齐，希望有一份 **不说黑话**的解释材料。
- 你要做自己的 Editor 或 Provider，但想先把名词搞明白。

## 先给你一张“心智地图”（不看细节也能懂）

把它想成一条流水线：

1. **你在 Studio 里做一张“蓝图”**（它描述怎么计算，不做 IO）
2. **你把蓝图发布** → 得到一个不可变版本（`definitionHash`）
3. **Provider 负责收集业务数据** → 拼成 `inputs` → 投递一个 `job`
4. **Engine 执行 job** → 发出 `succeeded/failed` 结果事件

下面我们把每个词拆开讲。

---

## Definition（定义）

### 人话解释

**Definition 就是一份“计算配方”的名字**。它代表“我要算什么”，但还没固定版本。

### 严格定义

- Definition 用 `definitionId` 唯一标识（例如：`tax_discount` 或中文名都可以，取决于系统约束）。
- 一个 Definition 会有多个版本（Release），每个版本由 `definitionHash` 唯一标识。

### 示例（JSON）

```json
{ "definitionId": "测试" }
```

---

## Draft（草稿）

### 人话解释

Draft 是 **“还在编辑中的配方”**。你可以反复改它，不会影响已经发布出去的版本。

### 严格定义

- Draft 是可变状态：允许增删节点、改参数、改 pins。
- Draft 通常带有修订号（revision）用于并发控制（防止多人覆盖）。

### 常见误解

- 误解：改了 Draft 就等于上线。
  事实：**必须 Publish 才会产出 Release**，运行时只看 Release。

---

## Release（已发布版本）

### 人话解释

Release 是 **“盖章的配方”**。一旦发布，它就不能再变；你要改只能发新版本。

### 严格定义

- Release = `{ definitionId, definitionHash, content, runnerConfig, createdAt, ... }`
- 引擎执行时必须引用一个 Release（也就是要有 `definitionHash`）。

### 示例（definitionRef）

```json
{
  "definitionRef": {
    "definitionId": "测试",
    "definitionHash": "3e425483de312fcc5db5bed310df0d7c8e358f191c858794f4b489cdefae72b2"
  }
}
```

---

## definitionHash（版本指纹）

### 人话解释

把 `definitionHash` 当成“这份发布版本的指纹”。
只要 hash 不变，就表示 **图内容 + runnerConfig** 没变。

### 严格定义

- `definitionHash` 是对 Release 内容做规范化后计算出的 SHA-256（详见 [`../HASHING_SPEC.md`](../HASHING_SPEC.md)）。
- 同一个 Definition 可以有多个 Release；hash 不同表示版本不同。

### 常见误解

- 误解：hash 是随机的。
  事实：它由内容决定（内容相同 → hash 相同）。

---

## Graph v2（图的版本/语义）

### 人话解释

Graph v2 的核心是：**输入输出不是“随便写 JSON”**，而是由图里的两个特殊节点定义“契约”：

- `flow.start`：声明 **我需要哪些 inputs**
- `flow.end`：声明 **我会产出哪些 outputs**

你可以把 pins 当成“函数参数表”和“返回值结构”。

### 严格定义（你只要记住这几点）

- 引擎只接受 `schemaVersion = 2` 的图（Hard cut）。
- 必须且只能有一个 `flow.start` 和一个 `flow.end`。
- 输入契约来自：`flow.start.params.dynamicOutputs[]`（每个元素是一个 PinDef）
- 输出契约来自：`flow.end.params.dynamicInputs[]`

权威细节见：[`../GRAPH_SCHEMA.md`](../GRAPH_SCHEMA.md)

### 示例（PinDef）

```json
{
  "name": "basePrice",
  "label": "基础价格",
  "valueType": "Decimal",
  "required": true,
  "defaultValue": "0"
}
```

> 小白提示：
> - `name` 是“机器要用的 key”（inputs/outputs 的键），必须唯一。
> - `label` 是“人看的名字”（UI 显示），可以重复但不推荐。
> - `valueType` 决定校验规则（例如 Decimal 允许字符串数字）。

---

## Job（一次执行请求）

### 人话解释

Job 就是“请把这份配方跑一遍”。它包含：

- 跑哪一份发布版本（`definitionRef`）
- 这次喂进去的输入（`inputs`）
- 一些可选开关（`options`）

### 严格定义

一个 job 请求消息（MQ）会包含：

- `jobId`：这次执行的唯一 ID（也是幂等主键）
- `definitionRef`：`{definitionId, definitionHash}`
- `inputs`：一个 object
- `options`：一个 object（可为空）

> 注意：协议里的 `schemaVersion: 1` 指的是 **job 消息协议版本**，不是 Graph v1/v2。Graph 仍然必须是 v2。

### 示例（JSON，最小可用）

```json
{
  "schemaVersion": 1,
  "jobId": "2665a5be-723d-4672-b382-8bf64202cb92",
  "definitionRef": {
    "definitionId": "测试",
    "definitionHash": "3e425483de312fcc5db5bed310df0d7c8e358f191c858794f4b489cdefae72b2"
  },
  "inputs": {
    "basePrice": "100",
    "_meta": { "provider": "my-provider", "requestedAt": "2026-03-04T23:44:42.266Z" }
  },
  "options": {}
}
```

---

## jobId（幂等）

### 人话解释

`jobId` 就像“订单号”。
**重试同一笔业务时必须用同一个 jobId**，否则引擎会当成新订单再算一遍。

### 严格定义

- `jobId` 是引擎侧的幂等主键（同一个 `jobId` 再投递通常会被拒绝/复用结果，取决于实现策略）。
- 推荐：由 Provider 用 UUID 生成；或用“业务主键 + 版本 + 时间窗口”稳定生成（只要能保证不冲突、可复用即可）。

### 常见误解

- 误解：消息重复投递就会重复执行。
  事实：协议本身是“至少一次”（可能重复），所以必须靠 `jobId` 幂等兜底。

---

## inputs / options / outputs（输入、开关、输出）

### 人话解释

- `inputs`：你喂给配方的原料（业务数据）
- `options`：这次运行的开关（例如某些 runner 限制、调试开关；没有就 `{}`）
- `outputs`：配方跑完交付的成品（结构由 `flow.end` pins 决定）

### 严格定义

- 引擎只会读取并校验 `flow.start` 声明过的 pins（未声明字段会被剔除，不参与 hash，也不能在图里访问）。
- outputs 只会产出 `flow.end` 声明的 pins（key 来自 pin.name）。

### 示例（inputs 允许带 meta）

```json
{
  "inputs": {
    "basePrice": "100",
    "taxRate": "0.13",
    "_meta": { "asOf": "2026-03-04T00:00:00Z", "source": "crm" }
  }
}
```

---

## inputsHash / outputsHash（可追溯性）

### 人话解释

把 `inputsHash` / `outputsHash` 当成“这次运行喂了什么/产出了什么”的指纹。
它的目的不是给你看好玩，而是方便：

- 查问题（同样输入是否总是同样输出？）
- 审计（这份结果对应的输入到底是什么？）
- 去重/缓存（可选）

### 严格定义（你只要知道会做规范化）

- 计算 hash 前会对数据做 canonicalize（例如 key 排序、类型规范化），避免“同值不同写法”导致 hash 不同。
- 细节见：[`../HASHING_SPEC.md`](../HASHING_SPEC.md)

---

## Provider（集成方的运行时适配层）

### 人话解释

Provider 就是“翻译官/适配器”：

- 从你们系统拿到业务数据
- 按 `flow.start` 的 pins 把数据拼成 `inputs`
- 投递 job
- 收到结果事件后，把 outputs 写回你们系统/回调给调用方

### 严格定义

- Provider **不需要懂图怎么跑**，只要懂输入/输出契约、幂等与去重即可。
- Provider 只依赖：HTTP（查 definition/release 可选）+ MQ（投递 job、消费结果）

下一篇从“怎么接 Provider”开始：[`04_PROVIDER_INTEGRATION.md`](04_PROVIDER_INTEGRATION.md)

