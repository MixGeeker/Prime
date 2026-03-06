# 业务样例蓝图：tax-discount

这个示例演示一个最简单的 Graph v2 定价规则：

```text
final = round((basePrice + basePrice * taxRate) * (1 - discountRate), 2)
```

## 文件
- `graph.json`：BlueprintGraph（`contentType=graph_json` 的 `content`）
- `draft-create.json`：用于 `POST /admin/definitions` 的请求体示例
- `sample-job.json`：用于 SDK / 业务模块发送 job 的请求体示例（需要替换 `definitionHash`）

## 使用步骤（本地）
1) 启动后端（HTTP + Worker）与 RabbitMQ
2) 用 Studio 导入 `draft-create.json`（或直接复制其中的 content）并发布
3) 把发布得到的 `definitionHash` 填到 `sample-job.json`
4) 使用 `sdk/examples/full-chain-demo.ts` 或你自己的业务模块发送 job，并在 Ops 查看 Jobs / 结果
