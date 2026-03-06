# 05｜HTTP Admin API 食谱（PowerShell + curl 可复制）

## 这份文档适合谁

- 你要接 Editor 或运维台，需要调 HTTP Admin API。
- 你只想要“照抄就能跑”的命令，不想先读完整设计文档。
- 你在 Windows 上，希望直接用 PowerShell/curl 验证。

> 权威来源：[`../API_DESIGN.md`](../API_DESIGN.md)
> 本文按“任务”组织，不按路由堆接口。

---

## 0) 先设置 baseUrl（非常重要）

默认（test/dev 默认端口）：

```powershell
$base = "http://localhost:4010"
```

> 提示：如果你用 `node scripts/start.mjs` 启动，脚本可能因端口冲突自动 +1。
> 以脚本输出的端口为准，然后把 `$base` 改成对应端口。

---

## 1) 我想列出 definitions（并搜索）

### 解释

Definition 列表可以让你看到：

- 有哪些 definitionId
- 是否有 draft（可编辑草稿）
- 最新发布的 hash（如果有）

### PowerShell

```powershell
$q = "测" # 模糊搜索，可为空
$url = "$base/admin/definitions?q=$([uri]::EscapeDataString($q))&limit=50"
Invoke-RestMethod $url -Method Get
```

### curl（建议用 curl.exe，避免 PowerShell 别名冲突）

```bash
curl.exe -sS "http://localhost:4010/admin/definitions?q=%E6%B5%8B&limit=50"
```

---

## 2) 我想找到某个 definition 的“最新已发布 hash”

### 解释

SDK / 业务模块触发执行时必须给 `definitionHash`。
最常见需求是“选最新发布版本”。

### PowerShell（取最新 published）

```powershell
$definitionId = "测试"
$idEsc = [uri]::EscapeDataString($definitionId)
$releases = Invoke-RestMethod "$base/admin/definitions/$idEsc/releases" -Method Get

$published = @($releases | Where-Object { $_.status -eq "published" })
if ($published.Count -eq 0) { throw "没有已发布版本" }

$latest = $published | Sort-Object { $_.publishedAt } -Descending | Select-Object -First 1
$latest.definitionHash
```

---

## 3) 我想读取某个发布物（拿到图 content）

### 解释

这通常用于：

- Editor 做 diff/回放
- SDK / 工具生成 inputs 模板（读取 `flow.start` pins）

### PowerShell

```powershell
$definitionId = "测试"
$definitionHash = "3e425483de312fcc5db5bed310df0d7c8e358f191c858794f4b489cdefae72b2"

$idEsc = [uri]::EscapeDataString($definitionId)
$hashEsc = [uri]::EscapeDataString($definitionHash)
Invoke-RestMethod "$base/admin/definitions/$idEsc/releases/$hashEsc" -Method Get
```

---

## 4) 我想 Validate（校验）一个发布物/草稿

### 解释

Validate 会返回一组结构化错误：你可以在 UI 里把它翻译成用户能看懂的提示。
它不会执行图，只做“合法性检查”。

### A. 校验一个 release（definitionRef）

PowerShell：

```powershell
$body = @{
  definitionRef = @{
    definitionId = "测试"
    definitionHash = "3e425483de312fcc5db5bed310df0d7c8e358f191c858794f4b489cdefae72b2"
  }
} | ConvertTo-Json -Depth 50

Invoke-RestMethod "$base/admin/definitions/validate" -Method Post -ContentType "application/json" -Body $body
```

curl：

```bash
curl.exe -sS -X POST "http://localhost:4010/admin/definitions/validate" -H "Content-Type: application/json" -d '{"definitionRef":{"definitionId":"测试","definitionHash":"..."}}'
```

### B. 校验一份“临时 definition”（不落库）

适合 Editor 在本地还没保存草稿时做校验：

```powershell
$graph = @{
  schemaVersion = 2
  locals = @()
  nodes = @()
  edges = @()
  execEdges = @()
}

$body = @{
  definition = @{
    contentType = "graph_json"
    content = $graph
    runnerConfig = @{}
  }
} | ConvertTo-Json -Depth 50

Invoke-RestMethod "$base/admin/definitions/validate" -Method Post -ContentType "application/json" -Body $body
```

---

## 5) 我想 Dry-run（预览执行，不走 MQ）

### 解释

Dry-run 是最适合新手调试的接口：
你给定 definition + inputs，它直接返回 outputs（不落库、不发 MQ）。

### PowerShell（按 release dry-run）

```powershell
$body = @{
  definitionRef = @{
    definitionId = "测试"
    definitionHash = "3e425483de312fcc5db5bed310df0d7c8e358f191c858794f4b489cdefae72b2"
  }
  inputs = @{
    basePrice = "100"
    _meta = @{ asOf = (Get-Date).ToString("o") }
  }
  options = @{}
} | ConvertTo-Json -Depth 50

Invoke-RestMethod "$base/admin/definitions/dry-run" -Method Post -ContentType "application/json" -Body $body
```

### curl

```bash
curl.exe -sS -X POST "http://localhost:4010/admin/definitions/dry-run" -H "Content-Type: application/json" -d '{"definitionRef":{"definitionId":"测试","definitionHash":"..."},"inputs":{"basePrice":"100"},"options":{}}'
```

> 关于 `entrypointKey`：目前是预留字段（Graph v2 不区分入口）。你可以不传或固定传 `"main"`。

---

## 6) 我想创建/更新 draft（给 Editor 保存）

> 如果你只是集成 SDK / 业务模块，不需要这一段。它主要给 Editor 端使用。

### A. 创建 draft：`POST /admin/definitions`

PowerShell（最小示例：一个空图）：

```powershell
$graph = @{
  schemaVersion = 2
  locals = @()
  nodes = @()
  edges = @()
  execEdges = @()
}

$body = @{
  definitionId = "测试"
  contentType = "graph_json"
  content = $graph
  runnerConfig = @{}
  changelog = "init"
} | ConvertTo-Json -Depth 50

Invoke-RestMethod "$base/admin/definitions" -Method Post -ContentType "application/json" -Body $body
```

### B. 读取 draft：`GET /admin/definitions/:definitionId/draft`

```powershell
$idEsc = [uri]::EscapeDataString("测试")
Invoke-RestMethod "$base/admin/definitions/$idEsc/draft" -Method Get
```

### C. 更新 draft：`PUT /admin/definitions/:definitionId/draft`

更新时要带 `draftRevisionId`（防止并发覆盖）。
你可以先 `GET draft` 拿到 revision，再 PUT。

```powershell
$definitionId = "测试"
$idEsc = [uri]::EscapeDataString($definitionId)
$draft = Invoke-RestMethod "$base/admin/definitions/$idEsc/draft" -Method Get

# 这里示例：原样保存（实际是把你编辑后的 content/runnerConfig 填回去）
$body = @{
  definitionId = $definitionId
  contentType = $draft.contentType
  content = $draft.content
  runnerConfig = $draft.runnerConfig
  outputSchema = $draft.outputSchema
  draftRevisionId = $draft.draftRevisionId
} | ConvertTo-Json -Depth 50

Invoke-RestMethod "$base/admin/definitions/$idEsc/draft" -Method Put -ContentType "application/json" -Body $body
```

---

## 7) 我想 Publish（发布）一个 draft

### 解释

发布成功后得到 `definitionHash`，后续执行必须引用它。
发布不会删除 draft（取决于实现策略），但通常意味着“此版本可被执行”。

### PowerShell

```powershell
$definitionId = "测试"
$idEsc = [uri]::EscapeDataString($definitionId)
$draft = Invoke-RestMethod "$base/admin/definitions/$idEsc/draft" -Method Get

$body = @{
  draftRevisionId = $draft.draftRevisionId
  changelog = "publish from cookbook"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod "$base/admin/definitions/$idEsc/publish" -Method Post -ContentType "application/json" -Body $body
```

---

## 8) 我想查 jobs（排障/对账）

### A. 列表：`GET /admin/jobs`

```powershell
$definitionId = "测试"
$url = "$base/admin/jobs?definitionId=$([uri]::EscapeDataString($definitionId))&limit=50"
Invoke-RestMethod $url -Method Get
```

### B. 详情：`GET /admin/jobs/:jobId`

```powershell
$jobId = "2665a5be-723d-4672-b382-8bf64202cb92"
Invoke-RestMethod "$base/admin/jobs/$jobId" -Method Get
```

---

## 9) 常见错误（先看这一页就够用）

- `GRAPH_SCHEMA_INVALID` 且提示 `globals/entrypoints/outputs`：Graph v1 字段 → **进程版本不一致/旧 worker 没重启**（详见 [`07_TROUBLESHOOTING.md`](07_TROUBLESHOOTING.md)）。
- `DEFINITION_NOT_FOUND`：definitionId 不存在或拼错。
- `DEFINITION_NOT_PUBLISHED`：你引用了一个没发布/已弃用的 hash。
- `INPUT_VALIDATION_ERROR`：inputs 缺字段或类型不对（回到 `flow.start` pins 看契约）。


