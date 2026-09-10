# 画布节点性能与交互验证

本次优化覆盖按节点订阅、输入缓存、统一连接反馈、分镜排序与窗口渲染、视口图片加载及节点渲染统计。无需改变项目数据格式或运行 AI 任务。

## 实现边界

| 需求 | 实现 | 验证证据 |
| --- | --- | --- |
| 按节点 ID 的 Store selector | `createNodeInputGraphSelector` 只投影当前节点及上游依赖，所有生成节点及分镜结果节点已接入；节点、连线索引用 WeakMap 按快照共享 | `canvasNodeSelectors.test.ts`：拖拽、无关数据修改、祖先变化、连线顺序、断开、循环与独立缓存 |
| 应用层输入缓存 | `createTextGenerationInputsResolver` 配合稳定的图投影缓存文本与图片输入；其他生成节点保留已有 useMemo，改用范围更小的依赖 | `textGenerationInputs.test.ts`：全图与局部图输出一致，生成结果优先、断开后输入更新 |
| 连接预览和端口反馈 | 所有节点 Handle 使用 `CanvasHandle`，通过现有 `isCanvasConnectionValid` 判断；连接线使用 `CanvasConnectionLine`；合法/非法颜色、提示文案统一，不修改端口定位 transform | 浏览器鼠标连线成功、重复连线拒绝；既有 `canvasConnection.test.ts` 覆盖容量、类型、端口与依赖约束 |
| 分镜排序与图片渲染 | `StoryboardFrameCard` 独立 memo；hover 不写 Store，松手提交、pointercancel 取消；图片使用预览来源，查看器保留完整原图列表 | 浏览器验证 hover 不改变 order、drop 提交、取消不改变 order、编辑内容保留 |
| 视口图片加载 | `CanvasNodeImage` 使用共享 IntersectionObserver，附近 320px 预载、离开后移除 src/srcSet；显式 eager 和缺少 observer 时可回退；保留已有受限高清图解码/焦点策略 | `CanvasNodeImage.test.tsx` 验证 source 挂载/释放；浏览器离开画布区域后图片来源数量为 0；既有图片质量与解码队列测试 |
| 大量分镜帧虚拟化 | 分镜结果节点用 `VirtualStoryboardGrid` 按可见行加两行缓冲挂载，固定几何、焦点/拖拽帧保留、边缘自动滚动。帧数据、导出及查看器不受窗口影响 | 300 帧仅挂载 15 帧；浏览器滚动卸载/恢复编辑、到达第 300 帧、缩放后逻辑高度稳定；`virtualGrid.test.ts` 验证窗口、边界、删除后范围与固定帧 |
| 节点级埋点 | 开发模式所有注册节点使用 React Profiler；按节点 ID 和类型聚合实际 render duration；输入解析与分镜排序另计 | 浏览器报告 `profiledNodes` 与各类型统计；`canvasPerformance.test.ts` 验证关闭统计、返回值及异常语义 |
| 50/100/300 节点压测 | 实际 `Canvas`、节点注册表、Store、React Flow 与连接逻辑；固定混合节点场景 | `canvas-benchmark.json`，由 `npm run benchmark:canvas` 生成 |

分镜生成节点的 1–9 行、1–9 列整体构图预览继续保持完整显示；大量分镜结果的可滚动帧列表采用窗口虚拟化。

## 复现

```bash
npm ci
npx playwright install chromium
npm run benchmark:canvas
# 仅交互回归，结果另写 canvas-qa.json
node scripts/canvas-benchmark.mjs --qa-only
```

脚本在独立的 headless 浏览器上下文中启动本地 Vite（127.0.0.1:1437），直接挂载生产 Canvas 组件。无活动项目、无 API 请求，不使用用户项目或已登录浏览器。结束后关闭浏览器和服务。

场景包含文本生成、图片生成、图片结果、上传图片、分镜结果、视频生成、文本注释与视频结果。画布原有 `onlyRenderVisibleElements` 保持开启，报告同时记录总节点数与视口内挂载数，不能把总节点数等同于同时可见数。

每种规模进行实际鼠标拖拽、90 次逐帧平移（去掉前 5 帧后统计）、缩放概览。另进行应用层对比：修改无关文本注释时，原有整图投影配合输入 memo，与新的局部图投影配合相同输入 resolver 各测量 100 次，前 10 次预热。两边调用实际业务函数，没有复制一套简化图算法。`readyMsIncludingSettle` 包含固定 700ms 稳定等待，不能作为纯挂载耗时。

报告使用开发版 React Profiler 和 Chromium，图片为固定本地 SVG 夹具，视频节点未播放真实视频。它反映当前机器上的可重复前端负载，不代表 Tauri WebKit、大型真实图片解码、GPU/内存压力或线上模型耗时。时间计量分辨率会使极短样本显示为 0，不应据此计算无限加速比。全量生产构建验证与压测分开执行。

## 诊断 API

普通会话默认不计时。开发者可在 Vite 页面的控制台启用：

```js
const perf = await import('/src/features/canvas/application/canvasPerformance.ts');
perf.resetCanvasPerformanceSnapshot();
perf.setCanvasPerformanceEnabled(true);
// 操作画布后读取计数、总耗时、最大耗时和均值
perf.getCanvasPerformanceSnapshot();
perf.setCanvasPerformanceEnabled(false);
```

`node:<id>` 用于定位具体节点；`node-render:<type>` 按类型聚合。最多保留 1024 个统计键，重置可清空。生产构建不包裹 React Profiler。统计仅包含耗时和标识，不包含提示词、媒体内容或供应商凭据。

## 完成检查

- 前端完整构建：`npm run build`。
- 全量单元测试：`npx vitest run`，81 个文件、391 个测试通过。
- 浏览器回归及规模压测：见同目录最终 JSON 和截图。
- 图片来源释放的断言证明 DOM 已移除来源，不声称浏览器立即释放全部图片缓存或 GPU 内存。

## 本次记录

节点规模 | 平移帧间隔 P95（ms） | 无关编辑旧路径 P95（ms） | 局部输入路径 P95（ms）
--- | --- | --- | ---
50 | 17.50 | 0.100 | 0.100
100 | 17.50 | 0.200 | 0.100
300 | 17.50 | 0.900 | 0.100
