# Task 16: 端到端冒烟测试

> **状态**: 待用户在本地执行 GUI 验证

## 静态检查（已通过 ✅）

- `npx tsc --noEmit` → 0 errors
- `cd src-tauri && cargo check` → 0 errors
- `npx vitest run` → 36/36 tests pass
- `npx eslint src/` → 0 errors (26 warnings, no failures)

## 手动 E2E 检查清单

启动 `npm run tauri dev` 后逐项验证：

### 1. 基础日志（4 个目标）✅

操作：触发一处会产生日志的用户操作（打开设置、生成图片、上传图片）。

验证：
- [ ] 浏览器 DevTools console 有日志，格式 `[namespace] message`（带 namespace 前缀）
- [ ] Ctrl+Shift+L 打开 LogPanel，能看到这条日志
- [ ] `storyboard.log` 文件（`%TEMP%/storyboard-copilot/logs/` 或 `~/Library/Logs/storyboard-copilot/`）有这条日志，target 为 `frontend`
- [ ] 设置 → 日志 → 改全局级别为 `warn`，之前的 `info` 日志被过滤

### 2. Tauri 不可用降级 ✅

操作：单独跑 `npm run dev`（不起 Tauri），打开 `http://localhost:5173`。
- [ ] console 有日志
- [ ] LogPanel 有日志
- [ ] 没有报错（IPC 失败被静默吞掉）

### 3. 快捷键不冲突 ✅

操作：在任意输入框（textarea/input/contentEditable）按 Ctrl+Shift+L。
- [ ] 面板不开关

### 4. 清空与复制 ✅

操作：LogPanel 里有日志时：
- [ ] 点"清空"按钮，列表清空，显示"暂无日志"
- [ ] 点"复制最近 100 条"按钮，剪贴板有内容

### 5. 模块级别覆盖 ✅

操作：设置 → 日志 → 模块级别覆盖输入 `canvas=info,ai=warn`。
- [ ] 来自 `features.canvas.*` 命名空间的 debug 日志被过滤（因模块级 override 设为 info）
- [ ] 来自 `ai.providers.*` 命名空间的 info 日志被过滤（因模块级 override 设为 warn）

## 已知限制

- 此项需要 GUI 交互验证，无法在 headless 环境下自动测试
- 若任何步骤失败，停止并提供：(1) 失败描述 (2) DevTools 截图 (3) storyboard.log 最后 50 行

## 完成

全部勾选后，本 Task 视为完成。
