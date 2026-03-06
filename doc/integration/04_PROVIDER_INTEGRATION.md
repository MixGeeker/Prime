# 04｜Provider 集成（历史入口）

> 本文件保留旧路径，方便历史链接继续可达。

默认推荐路径已经迁移到：
- `04_SDK_INTEGRATION.md`
- `../SDK_GUIDE.md`
- `../../sdk/README.md`

如果你仍在维护旧 Provider 服务，请至少遵守：
- 输入契约只以 `flow.start` pins 为准
- 影响结果的字段必须进入声明过的 start pins
- 结果消费按 `messageId` 去重
- 新项目优先改为 SDK + 模块化 inputs builder
