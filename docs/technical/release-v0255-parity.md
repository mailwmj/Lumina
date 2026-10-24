# v0.2.55 功能对齐记录

对应 GitHub [#3](https://github.com/mailwmj/Lumina/issues/3)、[#11](https://github.com/mailwmj/Lumina/issues/11)。基线为 main `73854c8` 与已发布版本 `7762a0b`。主线已经重构，采用逐项迁移，不直接覆盖主线文件或合并旧架构；因此 `git cherry` 仍会显示原提交为 `+`，以下记录每个提交的处理决定。

| 发布分支提交 | 主线处理 |
| --- | --- |
| `9855171` 生成状态反馈 | 恢复图片/视频结果节点的 `aria-busy` 和 300ms 计时器。保留主线已经使用的 danger/warning 状态样式；不移入没有调用方的额外 surface state 参数与闲置颜色分支。 |
| `067c16a` 过期任务保护 | 主线已有 `b54a7d2` 的等价实现，保留图片/视频任务写回前的 jobId 与运行状态校验及 `generationJobGuard` 测试。 |
| `1109323` 画布渲染与连接反馈 | 恢复 `CanvasHandle`、`CanvasConnectionLine`、中英文 `node.connection.*`、五种生成节点的输入子图订阅、文本输入解析缓存、`useViewportImage` 及图片懒加载。保留主线已有的分镜展示、窗口虚拟化、共享索引与性能计量能力。开发工具及重复 UI 提示的取舍见下文。 |
| `d4bd4d4` 对齐与快照发布 | 对齐改为只在松手时执行，启用网格吸附时跳过节点对齐；保留主线按屏幕距离与邻近节点筛选的策略。Agent 快照序列化与哈希移到发布防抖之后，关闭访问时不生成预览或轮询托管服务。 |
| `7762a0b` 图片元数据与多选连线 | 恢复 Rust `read_image_dimensions` 命令、共享尺寸缓存、`CanvasExternalAgentBridge`、React Flow 内部测量驱动的多选几何与 `ViewportPortal`。额外复用主线的 `resolveImageCommandSource`，保证 Windows 的 `http://asset.localhost/` 和 asset URL 也能走本地尺寸头部读取。 |

## 有意不移植的内容

- `profileCanvasNodes.tsx` 与节点渲染器的 React Profiler 包装：只用于开发期采样。主线保留既有的 `canvasPerformance` 计量函数，正常运行不增加 Profiler 包装。
- `scripts/canvas-benchmark*`、`canvas-drag-check.mjs`、`canvas-pan-check.mjs`、`canvas-pan-qa.mjs` 及对应 Playwright 开发依赖：这些是分支开发期的压测入口，不属于产品能力。本次通过现有 Vitest 与独立临时 Chrome 验证，不增加另一套压测框架。
- 分支的 `docs/performance/` 历史 JSON、截图与采样说明：它们描述旧分支和旧环境，不能作为当前版本的性能证据，不复制为新的验证结果。
- 生成按钮旁新增的模型缺失/运行阻塞原因文字：主线已有模型选择、按钮状态和错误提示，保留当前布局，遵循项目避免重复次级说明的界面规范。

## 验证记录

- 浏览器：独立临时 Chrome，当前代码和 `7762a0b` 使用同一组已安装依赖、同一浏览器运行；未使用真实供应商或用户项目。
- 多节点含连线粘贴：`2 节点 / 1 边 → 4 / 2 → 一次撤销 2 / 1 → 一次重做 4 / 2`；Alt 拖拽复制得到同样结果，历史只增加一项。
- 真实鼠标拖线时有 1 个候选端口，端口 tooltip 与连接线本地化反馈存在。合法与非法连接使用已有的统一校验。
- 6 个图片节点均具有 `loading="lazy"`；选择本地图片后通过模拟 IPC 收到一次 `read_image_dimensions`，参数为原始文件路径，并显示 `4096 × 3072`。
- 150 个可见节点（149 个图片/文本生成节点与 1 个文本注释节点），逐字符输入 28 个字符。排除预热轮后，v0.2.55 的三轮 ScriptDuration 为 `73.563 / 72.157 / 81.919 ms`，本次为 `72.416 / 76.006 / 79.269 ms`；中位数之比约 `1.03`，在 issue 要求的 `1.5` 以内。这是 dev 构建的相对对照，不代表生产环境绝对延迟。
- 回归测试包含图片视口加载、尺寸读取失败与过期响应、禁用时忽略视口更新、连接时快照防抖、输入子图选择、复制历史与 300 组确定性随机撤销/重做序列。
- 最终前端回归：`npx vitest run` 通过 112 个文件、550 个用例；`npx tsc --noEmit`、`npm run build` 与 `git diff --check` 均通过。
- 当前机器没有 Rust/Cargo 工具链，未执行 `cargo check` 或 Rust 测试；移植的图片头部读取 Rust 测试已保留，需要在带 Rust 工具链的环境补跑。
