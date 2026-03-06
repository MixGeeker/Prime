# Provider Guide（迁移说明）

> 本文件保留历史文件名，方便旧链接继续可达。

`Provider` 不再是本项目推荐的默认集成形态。新的默认路径是：
- 业务模块自行构建 flat `inputs`
- 使用 `sdk/` 发送 job / 订阅结果

请改读：
- `SDK_GUIDE.md`
- `../sdk/README.md`
- `integration/04_SDK_INTEGRATION.md`

如果你仍在维护历史 Provider 服务，可继续遵守以下底线：
- 输入契约只以 `flow.start` pins 为准
- 影响结果的字段必须进入声明过的 start pins
- `_meta` 默认不进入 `inputsHash`
- 结果消费必须按 `messageId` 去重
