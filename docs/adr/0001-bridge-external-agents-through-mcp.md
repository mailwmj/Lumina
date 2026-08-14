---
status: accepted
---

# 通过本机 MCP 桥接外部 Agent 与活动画布

Lumina 的外部 Agent 接入采用与 Infinite Canvas 同型的链路：通用 stdio MCP companion 通过受认证的本机桥接请求当前活动项目，再由前端画布控制层读取或执行操作；Codex 是首个验收客户端。首版沿用其 TypeScript Canvas Agent 双模式结构，由独立进程同时提供常驻本机桥接服务和 `mcp` stdio 入口，Lumina 前端向桥接服务同步实时画布快照并接收工具请求，Tauri 不直接充当 MCP Server。该方案只对齐核心体验和桥接拓扑，不直接复用 Infinite Canvas 的宽松字段 patch、默认自动写入和完整工具权限；Lumina 仍以 `nodeRegistry`、`CanvasChangeSet`、应用内审批和原子历史作为节点与写入规则的事实源，且 MCP 不直接读写 SQLite。
