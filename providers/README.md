# Integration SDK（迁移说明）

`providers/` 目录保留为**历史迁移区**：

- 这里的内容用于解释过去如何用 Provider 组织 inputs / 投递 MQ
- 现在的默认集成方式已经改为 `sdk/`
- 新项目不再推荐创建独立 Provider 服务，优先使用共享 SDK / 模块化 inputs builder

## 当前建议

- **发送端**：业务模块读取事实数据并构建 flat `inputs`
- **集成层**：通过 `sdk/` 发送 `compute.job.requested.v1`
- **结果端**：业务模块消费 `compute.job.succeeded.v1 / failed.v1`

## 历史目录

- `./examples/basic-node/`：最小历史占位示例，现已由 `sdk/` 取代
- `./examples/provider-simulator/`：旧的独立 Provider 服务参考实现，仅供迁移参考
- `./examples/tax-discount/`：业务样例蓝图
