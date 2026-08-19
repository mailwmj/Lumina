# Lumina 本地高清放大 V1 开发计划

> 文档状态：执行中
> 分支：`codex/realesrgan-upscale-v1`
> 最后更新：2026-08-20

## 1. 目标

在 Lumina 画布中提供一个本地、离线的“高清放大”节点。节点使用固定版本的 Real-ESRGAN ncnn Vulkan sidecar，对单张照片或真人图片生成 2x 或 4x 的 PNG 派生结果。

完成后，用户可以将一个图片节点连接到高清放大节点，选择倍率并运行；输入不会被覆盖，成功结果会作为项目拥有的 `exportImage` 派生节点保留其来源连线。

## 2. 固定决策

| 主题 | 决策 |
| --- | --- |
| 引擎 | `realesrgan-ncnn-vulkan`，固定 `realesrgan-x4plus` 模型 |
| 平台 | Windows x86_64、macOS x86_64/aarch64 universal；Vulkan 自动选卡 |
| 倍率 | 仅 `2x`、`4x`，默认 `2x` |
| 输入 | 单张项目内图片；未经 profile 标记的图片按 sRGB 解释；嵌入非 sRGB 或无法确认的 ICC profile 拒绝运行 |
| 颜色策略 | 不做 Display P3、Adobe RGB 或其他 profile 的转换；提示用户先导出为 sRGB |
| 预处理 | 在 Rust 中统一解码、应用 EXIF 方向、验证像素与文件大小后输出 sidecar 输入 PNG |
| 输出 | 固定 PNG，临时文件完成后原子写入项目 `outputs/images/` |
| 模型/参数 | 前端只能传 `projectId`、图片引用和倍率；模型、模型目录、二进制、GPU、tile 与线程参数均由 Rust 固定 |
| 并发 | 每进程同一时刻最多一个 GPU 作业；后续作业排队 |
| 缓存 | 全局不可变缓存，10 GiB LRU 上限；命中后硬链接或复制至项目输出目录 |
| 持久化 | 节点仅持久化稳定配置；作业 ID、进度、AbortController、错误详情放独立运行时 Store |
| 发布 | 复用现有 Windows/macOS 打包流程；本轮不增加签名或 notarization |
| 非目标 | GFPGAN、人脸修复、模型切换、ONNX、批量队列 UI、远程执行、色彩管理设置、通用 Graph Executor、独立 Asset 系统 |

## 3. 领域与架构

`upscaleNode` 是配置/执行节点，不承载最终图片资产。它接收一张图片输入；成功后应用层创建或更新与之相连的 `exportImage` 结果节点。这样输入、配置和结果均可追溯，且符合 Lumina 的“处理后生成新节点”约束。

```text
上游图片节点
  └─ image 输入边 ──> upscaleNode { scale }
                           │
                           ├─ UpscaleRuntimeStore（瞬态）
                           └─ UpscaleModule
                                │ start/status/cancel
                                v
                         Rust UpscaleService
                   ┌────────────┼─────────────┐
                   │ 输入授权与 │ 作业队列/取消 │ 缓存与 sidecar
                   │ sRGB/方向  │               │
                   └────────────┴─────────────┘
                                │
                                v
               {project}/outputs/images/<derived>.png
                                │
                                └─ result 边 ──> exportImage 节点
```

### 3.1 前端 Module 接口

前端调用者只认识一个小的 `UpscaleModule` 接口：

```ts
start(input: { nodeId: string; projectId: string; sourceImageUrl: string; scale: 2 | 4 }): Promise<UpscaleJobSnapshot>
getStatus(jobId: string): Promise<UpscaleJobSnapshot>
cancel(jobId: string): Promise<UpscaleJobSnapshot>
```

应用层负责把当前图数据转换成上述输入、轮询 snapshot、更新瞬态 Store，并在完成时物化派生结果。节点组件不直接调用 Tauri，也不保存任务状态到 `CanvasNodeData`。

### 3.2 Rust Module 接口

Tauri 命令使用同一组语义：

- `start_upscale_job`
- `get_upscale_job_status`
- `cancel_upscale_job`

`sourceImageUrl` 只是一项待验证引用，不是授权。Rust 必须把它规范化并确认其位于当前 `projectId` 的受允许输入或图片输出目录；拒绝任意路径、远程 URL、`data:` URL、模型参数和二进制参数。

所有失败返回稳定 `errorCode`，而非直接面向用户的 Rust 错误文本。第一版至少包括：

- `missing_input`
- `invalid_input_source`
- `unsupported_color_profile`
- `unsupported_image`
- `image_too_large`
- `sidecar_unavailable`
- `sidecar_failed`
- `cancelled`
- `cache_failed`

### 3.3 色彩和方向规则

1. 无嵌入 profile 的 JPEG/PNG/WebP 按 sRGB 处理。
2. 明确的 sRGB ICC profile 接受。
3. Display P3、Adobe RGB、CMYK、灰度/未知或无法可靠判定的 profile 以 `unsupported_color_profile` 拒绝；UI 应告诉用户“请先导出为 sRGB 后再放大”。
4. Sidecar 前应用 EXIF orientation；输出 PNG 不依赖 EXIF orientation 才能正确显示。
5. 不得以“允许但可能偏色”的方式绕过上述规则。

## 4. 实施阶段

### Phase 0：冻结可构建第三方输入

**目标：** 把 sidecar、模型和许可来源变成可审计的构建输入，而不是手工放入旧 release 文件。

**工作：**

1. 固定 Real-ESRGAN ncnn Vulkan 源码 commit、ncnn 依赖版本与构建选项。
2. 在版本化 manifest 中记录 `realesrgan-x4plus` 的下载来源、文件 SHA-256、许可证/notice 来源和预期目录布局。
3. 为模型下载加入哈希验证；禁止提交大型二进制或未经验证的模型。
4. 定义 Windows target triple 与 macOS arm64/x86_64/universal 的输出命名，使其符合 Tauri `externalBin` 规则。
5. 记录 Vulkan、MoltenVK、模型和 ncnn 的第三方 notice 需求。

**退出条件：**

- 干净机器可从固定脚本获得相同版本的源码、模型和哈希验证结果。
- 缺少编译器、Vulkan SDK、MoltenVK 或模型时脚本明确失败，不生成伪造产物。

### Phase 1：sidecar 与资源打包

**目标：** 让开发、CI 与 Tauri bundle 都能发现相同的引擎和模型资源。

**工作：**

1. 按现有 `canvas-agent` sidecar 模式新增 Real-ESRGAN 构建脚本。
2. Windows 生成 x86_64 sidecar；macOS 分别构建 arm64/x86_64 后以 `lipo` 形成 universal binary。
3. 在 Tauri bundle 配置中声明 external binary 和模型 resources。
4. Rust 通过资源目录解析模型，不能依赖当前工作目录。
5. CI 在打包后验证 sidecar 名称、目标架构、模型文件与 SHA-256；macOS 只维持现有签名状态。

**退出条件：**

- Windows bundle 包含正确 architecture-suffixed sidecar 与模型资源。
- macOS universal bundle 的 sidecar 同时包含 x86_64 与 arm64 slice。
- 构建脚本和 bundle 验证未引入签名、公证或私密凭据依赖。

### Phase 2：Rust `UpscaleService`

**目标：** 将输入验证、预处理、作业生命周期、缓存和 sidecar 细节隐藏在单一 Rust Module 后。

**工作：**

1. 新增作业状态机：`queued`、`running`、`succeeded`、`failed`、`cancelled`；同一 `jobId` 的迟到进程输出不能改写已取消/新任务结果。
2. 以应用状态维护单 GPU semaphore、取消句柄和结构化日志；不把进程状态写入项目 JSON。
3. 在启动 sidecar 前做项目范围路径授权、文件大小/像素限制、解码、EXIF orientation 与 sRGB profile 检查。
4. 固定调用参数：模型 `realesrgan-x4plus`、自动 GPU、自动 tile、固定并发参数和 PNG 输出；前端参数一律忽略或拒绝。
5. 使用私有 job 临时目录和输出临时文件；成功后原子移动到项目 `outputs/images/`。
6. 为 `projects.db` 增加自愈的 `upscale_cache` 表迁移。cache key 至少包含规范化输入内容、倍率、预处理版本、引擎版本和模型 SHA-256。
7. 将缓存 canonical 文件置于 app data；命中/完成后 hard-link，失败时 copy 到项目目录；按 `last_used_at` 清理到 10 GiB 以下。

**退出条件：**

- Rust 单元/集成测试覆盖路径拒绝、sRGB 拒绝、EXIF 方向、缓存命中、取消、进程失败、原子输出和 LRU 清理。
- `cargo fmt --check`、`cargo check` 与相关测试通过。
- 任何失败不会在项目输出目录留下半成品，也不会覆盖输入。

### Phase 3：画布节点与运行时状态

**目标：** 通过注册表、应用层和瞬态 Store 提供符合 Lumina 交互规则的节点体验。

**工作：**

1. 在 `canvasNodes.ts` 增加显式 `upscaleNode` 数据类型，只持久化 `scale` 和必要的显示数据。
2. 在 `nodeRegistry.ts` 注册默认数据、image 输入/输出能力和由注册表推导的菜单能力；禁止在 `Canvas.tsx` 写类型白名单。
3. 新增节点组件，复用 node control/token/toolbar 基础设施，提供 2x/4x 选择、开始、排队/进度、取消、重试和错误提示。
4. 新增 `UpscaleRuntimeStore` 与 `UpscaleModule` adapter。项目切换、节点删除或项目关闭时清理瞬态条目与轮询。
5. 通过应用层创建/更新派生 `exportImage` 节点和 provenance 连线，保持输入不变；连接、删除、撤销、重载均不得产生孤立边。
6. 在中文/英文 locale 同步加入所有按钮、状态和错误码映射；非 sRGB 错误需要可操作的转换提示。

**退出条件：**

- 节点创建、连线、2x/4x、成功、取消、重试、删除和项目重载都有明确行为。
- jobId、进度和错误详情不出现在持久化的节点数据中。
- 输入节点、配置节点和结果节点的追溯关系可见，且成功不会覆盖输入图片。
- `npx tsc --noEmit` 与聚焦 Vitest 通过。

### Phase 4：端到端验证与 CI

**目标：** 在真实打包路径上验证功能可交付性，而不仅是 TypeScript/Rust 编译成功。

**工作：**

1. 为 DTO、节点默认值、错误映射、派生产物和运行态清理增加前端测试。
2. 为 sidecar manifest、资源完整性和 target triple 增加构建脚本/CI 验证。
3. 在 Windows NVIDIA 与 AMD 驱动上做真实 2x/4x 冒烟：照片、PNG、JPEG、EXIF 旋转 JPEG、无 profile 图片、Display P3/非 sRGB 拒绝、取消和缓存命中。
4. 在 macOS x86_64/arm64 实机或 CI 环境验证启动、模型解析和一张样图输出；签名/公证保持当前项目状态并如实记录。
5. 运行 `npx vitest run`、`npx tsc --noEmit`、`cargo check` 和 `npm run build`；影响 Tauri bundle 时运行对应平台 bundle 检查。

**退出条件：**

- 真实 Windows GPU 生成成功，AMD 与 NVIDIA 至少各有一条可复查记录。
- 非 sRGB 输入稳定拒绝并显示中英文可理解提示；未标记的常规 sRGB 图片可完成生成。
- 打包产物不丢失 sidecar/模型，且所有自动化检查通过。

### Phase 5：提交并由 GitHub Actions 打包

**目标：** 使用仓库现有远端工作流验证可提交的跨平台打包结果。

**工作：**

1. 确认工作区只包含本计划范围内的文件，审阅最终 diff。
2. 运行本地可用的类型检查、Rust 检查、测试和 bundle 预检。
3. 提交并推送 `codex/realesrgan-upscale-v1`；当前工作流不在普通分支推送时自动运行。
4. 在该分支上用 `workflow_dispatch` 手动启动现有 `Build Lumina` 工作流，保持 `release_tag` 为空，因此只打包、不创建 Release。
5. 持续查看 Actions 状态与日志；若失败，按失败原因修复、推送并再次手动触发。
6. 记录 GitHub run、目标平台、产物检查和已知外部前提。

**退出条件：**

- 当前分支已推送，GitHub Actions 的目标打包任务有可复查结果。
- 不创建 tag、GitHub Release 或 Pull Request；macOS 签名/notarization 仍保持仓库当前状态。

## 5. 文件责任划分

| 切面 | 预期位置 | 责任 |
| --- | --- | --- |
| 构建与资源 | `scripts/`、`.github/workflows/`、`src-tauri/tauri.bundle.conf.json`、`src-tauri/resources/` | 固定依赖、构建 sidecar、资源与 artifact 验证 |
| 本地执行 | `src-tauri/src/commands/`、`src-tauri/src/upscale/`、`project_state.rs` | 授权、预处理、作业、缓存、sidecar 调用 |
| 命令 adapter | `src/commands/`、`src/features/canvas/application/` | Tauri DTO、轮询和派生产物编排 |
| 运行时状态 | `src/features/canvas/stores/` 或同层 feature state | 仅运行期 job/progress/error/取消信息 |
| 节点定义与展示 | `canvasNodes.ts`、`nodeRegistry.ts`、`nodes/`、`nodes/index.ts` | 配置、连线能力和视觉交互 |
| 本地化 | `src/i18n/locales/zh.json`、`src/i18n/locales/en.json` | 所有用户可见状态与错误提示 |

## 6. 验收矩阵

| 场景 | 期望 |
| --- | --- |
| 未连接输入 | 运行按钮不可用，并提供连接提示 |
| sRGB JPEG/PNG | 输出项目拥有的 PNG 派生结果，输入不变 |
| 无 profile 图片 | 按 sRGB 正常处理 |
| Display P3 / Adobe RGB / 未知 ICC | 拒绝运行，说明需导出 sRGB |
| EXIF 旋转 JPEG | 输出的像素方向正确 |
| 连续发起两个节点 | 第二个排队；任一取消不影响另一个 |
| 运行中取消 | 不生成结果节点，不遗留半成品 |
| 相同输入/参数再次运行 | 命中缓存，仍在当前项目产出可追溯结果 |
| 删除节点或切换项目 | 运行时 UI 清理；迟到结果不写入错误项目 |
| Windows NVIDIA/AMD | 均可完成一条 2x 与一条 4x 实测 |
| macOS universal bundle | sidecar 与模型资源存在且架构正确；签名状态不做扩展 |

## 7. 风险、门槛与回退

| 风险 | 最早验证 | 处置 |
| --- | --- | --- |
| 上游 ncnn/Real-ESRGAN 构建漂移 | Phase 0 | 固定 commit、依赖和 hash；脚本失败即停止，不退回旧 release binary |
| Vulkan 驱动差异 | Phase 1/4 | 先在 NVIDIA、AMD 跑真实样图；报告具体 GPU/driver，不静默 CPU 回退 |
| ICC 解析能力不足 | Phase 2 | 将“无法确认”视为拒绝；不能绕过为可能偏色的输出 |
| 缓存占满磁盘 | Phase 2 | 固定 10 GiB LRU、原子写入、清理失败返回稳定错误 |
| sidecar 无法启动 | Phase 2 | 返回 `sidecar_unavailable` 或 `sidecar_failed`，保留 stderr 的脱敏诊断日志 |
| macOS 签名/公证前提缺失 | Phase 4 | 保持当前项目状态，记录为发布外部前提，不扩大本需求 |

## 8. Definition of Done

只有在以下条件都满足时，V1 才完成：

1. Sidecar 与模型可从固定来源重建、校验并被 Tauri bundle 正确打包。
2. 画布可创建并运行高清放大节点，2x/4x 两档可用。
3. 只接受 sRGB；非 sRGB/未知 profile 有本地化且可操作的拒绝提示。
4. 输入未被覆盖，输出在项目目录中且通过连线保持可追溯。
5. 作业支持排队、进度、取消、失败与重试，运行态不进入项目持久化数据。
6. 缓存安全、可复用、有 10 GiB LRU 上限，项目不直接引用可淘汰的全局缓存文件。
7. 中英文 locale 完整；注册表、节点控件和工具栏符合现有 Lumina 约束。
8. Rust/TypeScript 测试、类型检查、构建和 Windows NVIDIA/AMD 冒烟验证均有证据。
9. 当前分支已推送，并有 GitHub Actions 的跨平台打包结果；未创建 tag、Release 或 PR。
10. macOS bundle 延续现有项目的签名状态，不虚假声称已完成 notarization。
