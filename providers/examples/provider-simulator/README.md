# Provider Simulator（历史示例服务）

这个目录保留为 **迁移参考**，不再是项目推荐的主集成路径。

当前默认方案：
- 业务模块自行构建 flat `inputs`
- 使用 `sdk/` 负责 `sendJob`、结果订阅去重与 inputs builder

如果你在排查历史联调链路，仍可按这里的方式启动本示例；但新接入请优先使用 `sdk/`。

## 历史职责
- 管理“全局 facts”并在投递时合并进 `inputs`
- 发布 `compute.job.requested.v1`
- 订阅 `compute.job.succeeded.v1 / compute.job.failed.v1`
- 维护本地 job 视图

## 运行（仅供历史链路排查）

```bash
cd providers/examples/provider-simulator
cp .env.example .env
npm i
npm run dev
```
