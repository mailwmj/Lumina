---
status: accepted
---

# 内置 Agent 在 WebView 内用 AI SDK 运行，画布是图片状态的唯一真相源

画布右侧的内置 Agent 面板不走 ADR 0001 的 MCP 桥接。MCP 解决的是“进程外的外部 Agent 如何受控地读写活动画布”，需要 companion、认证、revision 校验和轮询；内置 Agent 与画布同在 WebView 进程内，直接调用画布应用层（`applyAgentChangeSet`、`runImageGenerationNodes`、`buildCanvasAgentNodeImages`、`importCanvasAgentImages`）即可，绕一圈本机桥接只会增加延迟、故障面和状态同步问题。Agent 循环使用 Vercel AI SDK v7 的 `ToolLoopAgent` 与 `DirectChatTransport`，模型经 `@ai-sdk/openai-compatible` 接入用户已配置的文本 API，请求走 `@tauri-apps/plugin-http` 以绕开 CORS；不自写 Agent 循环。生图全自动执行、不逐次确认，护栏是每轮图片额度和停止按钮。

对话中的图片卡片只保存结果节点 ID，渲染时读取节点的实时状态。生成任务属于节点而不属于对话：停止只结束 LLM 流和等待，已提交的任务继续由节点跑完；重启后由画布既有的 `generationJobId` 恢复轮询把节点恢复，卡片自然随之恢复；重试复用节点自己的重试；用户手动修改或删除节点，对话如实反映，并在下一轮通过“当前画布状态”上下文告知模型。由此消息里不保存任何 base64（`view_images` 的预览在持久化前剥离），也不会干扰 `prune_unreferenced_images`。

用户上传、粘贴或拖入的图片在消息发送时先落成画布 `upload` 节点，再以节点 ID 作为引用。这样上传图与画布图走同一条引用、预览和资产生命周期，模型和后续回合只需理解“节点 ID”一种引用形态。画布图片只能由用户手动加入对话（节点工具条按钮或 `@`），选中不会自动带入。

每轮额度为设置上限与用户本轮明确要求张数中的较大值；“明确要求的张数”在发送时从用户消息解析并写入消息 metadata，不由模型自报。已用张数从对话记录推导（最后一条用户消息之后各次 `generate_image` 的实际张数之和），因此 `ask_user` 回填后的续跑和应用重启都不会重置额度；从未提交到供应商的尝试不计入额度。

会话、消息和节点来源持久化在 SQLite 的 `agent_threads`、`agent_messages`、`agent_node_origins` 三张表，随项目删除级联清除；`parts_json` 对后端是不透明文本。写入只发送内容变化的消息，流式期间节流，窗口关闭时并入 App 唯一的关闭守卫统一 flush。画布不依赖 agent 模块：节点工具条通过 `canvasEventBus` 发出“加入对话”“查看对话”意图，并从画布侧的只读索引读取引用与来源状态。
