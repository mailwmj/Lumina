---
status: accepted
---

# 通过本机 MCP 桥接外部 Agent 与活动画布

Lumina 的外部 Agent 接入采用与 Infinite Canvas 同型的链路：通用 stdio MCP companion 通过受认证的本机桥接请求当前活动项目，再由前端画布控制层读取或执行操作；Codex 是首个验收客户端。TypeScript Canvas Agent 以一个独立可执行文件提供常驻本机桥接服务和 `mcp` stdio 两种模式。该文件在构建期由 Bun 编译、作为 Tauri `externalBin` 随安装包分发，并由 Tauri 创建配置、启动和停止，终端用户不依赖源码、Node.js 或 Bun。

Lumina 前端向桥接服务同步实时画布快照并接收变更请求，Tauri 和 SQLite 都不充当画布事实源。用户启用外部 Agent 访问后，变更不再经过逐批弹窗审批；前端依据当前项目、revision、`nodeRegistry` 能力白名单和既有连线规则重新校验，通过后调用 `CanvasChangeSet` 应用服务直接原子写入，并生成一个历史检查点供整批撤销。该方案只对齐 Infinite Canvas 的桥接拓扑，不复用宽松字段 patch 或完整工具权限。
