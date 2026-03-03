# tax-discount（业务示例）

目标：演示一个“税费 + 折扣”的确定性计算蓝图：

```
final = round((basePrice + basePrice * taxRate) * (1 - discountRate), 2)
```

## 文件
- `graph.json`：BlueprintGraph（`contentType=graph_json` 的 `content`）
- `draft-create.json`：用于 `POST /admin/definitions` 的请求体示例
- `sample-job.json`：用于 Provider Simulator `POST /jobs` 的请求体示例（需要替换 definitionHash）

## 使用步骤（本地）
1) 启动后端（HTTP + Worker）与 RabbitMQ
2) 用 Studio 导入 `draft-create.json`（或直接复制其中的 content）并发布
3) 把发布得到的 `definitionHash` 填到 `sample-job.json`
4) 用 Provider Simulator 触发 `POST /jobs`，并在 Ops 查看 Jobs/结果

