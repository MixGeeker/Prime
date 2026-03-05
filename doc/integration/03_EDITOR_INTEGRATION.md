# 03｜Editor 集成（你做自己的 Studio/管理台）

## 这份文档适合谁

- 你们要把 Engine 接到自己的产品里，需要做一套自己的“蓝图编辑器 / 管理台 / 配置台”。
- 你不想照抄仓库 `frontend/`，而是要把关键接口、数据结构、校验/预览流程搞清楚。

> 重要提醒：`frontend/` 只是示例实现。你们可以用任何前端技术（React/Vue/Flutter/桌面端都行），甚至可以不做画布，只做表单化配置。
> 但你们必须遵守：Graph v2 结构、HTTP Admin API 语义、校验错误格式、发布物引用方式（definitionRef）。

---

## Editor 要负责什么

把 Engine 当成一个“计算内核”，Editor 要做的就是：

- **让用户能编辑**一张计算图（Graph v2）
- **实时校验**（Validate）：告诉用户哪里不符合规则（图结构、类型、pins 等）
- **快速试跑**（Dry-run）：用户填一组 inputs，立刻看到 outputs（不落库、不走 MQ）
- **发布**（Publish）：把草稿变成不可变的 Release，得到 `definitionHash`
- **查看版本**（Releases）：让用户选择旧版本、对比、回滚（可选）
- **查看执行记录**（Jobs）：给运维/排障用（可选但强烈建议）

---

## 最小你需要调用哪些 HTTP（严格版）

下面这些接口来自权威文档：[`../API_DESIGN.md`](../API_DESIGN.md)。
你可以先只实现“最小闭环”，再逐步补齐。

### A. Node Catalog（必须）

用于告诉 Editor：有哪些节点、每个节点有哪些 ports、参数表单怎么渲染。

- `GET /catalog/nodes`

### B. Draft（建议）

用于保存编辑中的草稿（可变）。

- `POST /admin/definitions`（创建 draft）
- `GET /admin/definitions/:definitionId/draft`（读取 draft）
- `PUT /admin/definitions/:definitionId/draft`（保存 draft）

### C. Validate / Dry-run / Publish（必须）

- `POST /admin/definitions/validate`
- `POST /admin/definitions/dry-run`
- `POST /admin/definitions/:definitionId/publish`

### D. Releases / Jobs（强烈建议）

用于版本选择与排障。

- `GET /admin/definitions`（列表 + 搜索）
- `GET /admin/definitions/:definitionId/releases`
- `GET /admin/definitions/:definitionId/releases/:definitionHash`
- `GET /admin/jobs`、`GET /admin/jobs/:jobId`

---

## Graph v2 的“编辑器视角”要点

### 1) 解释：pins 就是“契约”

- `flow.start` 上声明的 pins = 这张图要求调用方提供哪些 inputs（参数表）
- `flow.end` 上声明的 pins = 这张图对外承诺会产出哪些 outputs（返回值）

所以 Editor 里 **pin 的 name 不是装饰**：它决定了 inputs/outputs 的 JSON key。

### 2) 严格规则（必须遵守）

- 图顶层必须是：

```json
{ "schemaVersion": 2, "locals": [], "nodes": [], "edges": [], "execEdges": [] }
```

- 必须且只能有一个 `flow.start` 和一个 `flow.end`
- `flow.start.params.dynamicOutputs[]` 中每个 pin 的 `name` 必须唯一且合法（详见 [`../GRAPH_SCHEMA.md`](../GRAPH_SCHEMA.md)）
- `flow.end.params.dynamicInputs[]` 同理

> 注意：你在 UI 里看到的“两个 pin 名字一样会显示错/连线乱”，本质原因就是 **机器世界不能有重复 key**。所以 Editor 最好在本地就提示“重复 name”。

---

## `paramsSchema` 怎么用（不绑定任何前端框架）

### 解释

Node Catalog 里的 `paramsSchema` 就是一份“表单说明书”。
Editor 读到它后就可以动态渲染表单，用户填的值写到 graph 的 `node.params` 里。

### 严格定义

- `paramsSchema` 使用 JSON Schema（draft-07）
- 引擎侧也会按同一份 schema 做校验（Validate / Publish / Execute）
- 如果某节点没有 `paramsSchema`：那它在图里的 `params` 应该为空 `{}` 或缺省

### 示例：读 Node Catalog（PowerShell）

```powershell
$base = "http://localhost:4010"
Invoke-RestMethod "$base/catalog/nodes" -Method Get
```

---

## Validate 错误怎么展示

### 解释

Validate 返回一组 errors。每个 error 通常带 `path`，告诉你“错在图的哪个位置”。
Editor 的工作是把它翻译成用户能理解的提示（最好还能定位到具体节点/字段）。

### 严格定义（响应结构）

见 [`../API_DESIGN.md`](../API_DESIGN.md)：

- `ok: boolean`
- `errors: Array<{ code, severity, path?, message }>`

### 示例（curl）

```bash
curl.exe -sS -X POST "http://localhost:4010/admin/definitions/validate" -H "Content-Type: application/json" -d '{"definition":{"contentType":"graph_json","content":{"schemaVersion":2,"locals":[],"nodes":[],"edges":[],"execEdges":[]}}}'
```

> 提示：如果你不想处理 `curl` 的 JSON 转义，直接用 PowerShell 的 `Invoke-RestMethod` 更省心（示例见 [`05_HTTP_API_COOKBOOK.md`](05_HTTP_API_COOKBOOK.md)）。

---

## Dry-run（预览）怎么接

### 解释

Dry-run 就是“我先试跑一次看看输出”，它不会落库、不会发 MQ、不会影响线上。
非常适合 Editor 里做“预览/调参”。

### 严格定义（最常用 body）

```json
{
  "definitionRef": { "definitionId": "测试", "definitionHash": "..." },
  "inputs": { "basePrice": "100" },
  "options": {}
}
```

> 关于 `entrypointKey`：这是一个预留字段。当前 Graph v2 的执行不区分入口（统一从 `flow.start` 开始），所以 Editor 不需要把它做成用户必填项。
> 你可以一直不传，或固定传 `"main"`。

---

## Publish（发布）怎么做

### 解释

发布就是“把草稿盖章成不可变版本”。
发布成功后你会得到 `definitionHash`，之后 Provider/运行时必须用它来触发执行。

### 严格定义

- `POST /admin/definitions/:definitionId/publish`
- body 至少要带 `draftRevisionId`（用于并发控制）

---

## `flow.call_definition`（子蓝图调用）在 Editor 里怎么做得更不容易出错

### 解释

`flow.call_definition` 就像“函数调用另一个函数”。
它需要你选一个已发布的子图（`definitionId + definitionHash`），然后把输入传进去，再拿到输出。

### 严格建议（强烈推荐这么做）

当用户在 UI 里选择了 `definitionId/definitionHash` 后：

1. Editor 调 `GET /admin/definitions/:definitionId/releases/:definitionHash` 拿到子图的 `content`
2. 从子图 content 里读取：
   - `flow.start.params.dynamicOutputs` → 子图需要的 inputs pins
   - `flow.end.params.dynamicInputs` → 子图会产出的 outputs pins
3. 用这两份 pin 列表去填充/同步 `flow.call_definition` 的参数区（例如 `calleeInputPins/calleeOutputPins`）  
   这样用户就不用手工抄 pin，错误率会低很多。

> 提示：如果你允许用户手工改这些 pins，一定要在 UI 层做“重复 name”的提示，否则画布/连线渲染很容易出问题。

---

## Node.js 示例：搜索 definitions 并选择最新发布 hash（可直接搬走）

> 这个示例只展示“怎么找最新版本”，实际项目你可以封装成 SDK。

```javascript
const base = process.env.BASE_URL ?? "http://localhost:4010";
const definitionId = "测试";

async function main() {
  // Node.js 18+ 自带 fetch；如果你用更老的 Node，请升级或自行引入 HTTP 客户端。
  const url = `${base}/admin/definitions/${encodeURIComponent(definitionId)}/releases`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const releases = await res.json();
  const list = Array.isArray(releases) ? releases : (releases.items ?? []);
  const published = list.filter(r => r.status === "published");
  if (published.length === 0) throw new Error("没有已发布版本");
  // 约定：按 publishedAt/createdAt 排序，取最新
  published.sort((a, b) => String(b.publishedAt ?? b.createdAt).localeCompare(String(a.publishedAt ?? a.createdAt)));
  console.log("latest hash =", published[0].definitionHash);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
```

---

## 深入阅读（权威）

- Graph v2 规范：[`../GRAPH_SCHEMA.md`](../GRAPH_SCHEMA.md)
- HTTP/MQ 协议：[`../API_DESIGN.md`](../API_DESIGN.md)
- 类型系统：[`../VALUE_TYPES.md`](../VALUE_TYPES.md)

