# Compute Inputs Provider（规范 + 示例）

Compute Inputs Provider 的定位：**负责所有 IO（DB/HTTP/gRPC）**，聚合并注入 `inputs`（globals / facts / params），Compute Engine 仅做 **校验/规范化/hash/纯计算执行**。

参考文档：
- `../PROVIDER_GUIDE.md`
- `../COMPUTE_ENGINE_DESIGN.md`

## 示例

- `./examples/basic-node/`：最小示例（仅演示 inputs 结构与投递 job 的约定）

