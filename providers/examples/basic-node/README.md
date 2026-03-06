# basic-node（历史占位示例）

本目录保留为**历史最小占位示例**，用于说明过去 Provider 侧的 `inputs` / MQ 约定。

默认推荐路径已经迁移到：
- `sdk/README.md`
- `sdk/examples/full-chain-demo.ts`

## 仍然有效的约定

- `inputs` 是一个单一 object：`inputs.<pinName>`（对应 Graph v2 的 `flow.start` pins）
- 未声明字段允许存在，但默认不会进入 `inputsHash`
- 影响结果的元信息应进入声明过的 start pins，而不是仅放在 `_meta`
