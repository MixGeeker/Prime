# Compute Inputs Provider（规范 + 示例）

Compute Inputs Provider 的定位：**负责所有 IO（DB/HTTP/gRPC）**，聚合并注入 `inputs`（单一 object；key 对齐蓝图 `flow.start` pins），Compute Engine 仅做 **校验/规范化/hash/纯计算执行**。

参考文档：
- `../doc/PROVIDER_GUIDE.md`
- `../doc/COMPUTE_ENGINE_DESIGN.md`

## 示例

- `./examples/basic-node/`：最小示例（仅演示 inputs 结构与投递 job 的约定）
- `./examples/provider-simulator/`：**可运行示例服务**（管理 facts、投递 job、订阅结果事件）
- `./examples/tax-discount/`：业务样例蓝图（税费 + 折扣）

