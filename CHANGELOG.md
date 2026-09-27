# 更新日志

## v0.7.13 — 2026-09-27

### 修复
- 修复分镜图生视频请求缺少生成模式的问题，兼容 Agnes 与 Seedance。

## v0.7.12 — 2026-09-27

### 更名与视觉更新
- 应用正式更名为「AI漫剧工作室」，窗口、侧栏、设置页及 Windows 安装包统一显示新名称。
- 更换为全新的电影画框与播放光标图标，并固定原有数据目录和更新身份，升级后继续沿用原配置与素材。

## v0.7.11 — 2026-09-27

### 新增
- 检查更新后先提示可用新版本，点击“下载更新”后才开始下载。
- 设置页展示最近三次正式版本的更新内容。

## v0.7.10 — 2026-09-27

- 模型中心新增管理员导出：设置管理密码后可导出/导入含 API Key 的完整配置

## v0.7.9 — 2026-09-27

### 修复
- GPT Image 参考图改用图片编辑接口及 multipart 文件格式，并按 `@图片N` 顺序传入全部参考图，避免多图编辑请求因参数类型错误失败。

## v0.7.8 — 2026-09-27

### 修复
- Agnes 视频任务完成后兼容 `metadata.url`、`video_url` 等结果地址字段，并在结果尚未就绪时继续短暂轮询，避免过早报错。

## v0.7.7 — 2026-09-27

### 新增
- Windows NSIS 安装包与 GitHub Releases 更新检查、下载及重启安装。
- 首次安装可导入绿色版数据；原数据目录保持不变，后续版本数据存放在稳定的用户目录。
- 推送 `v*` 标签后自动运行测试、构建 Windows 安装包并发布 GitHub Release。
- 修复 Agnes 视频任务已完成但前端未显示成片：结果轮询改用服务根路径 `/agnesapi`。

## v0.7.5 — 2026-09-13

### 点下游节点生成时跳过已完成的上游（不再重复生图）

用户反馈：点「生成视频」会把上游图片节点也重跑一遍，白白消耗额度。

- `engine.js` 新增 `existingOutput()`：从 `node.data` 复原 imageNode / videoNode / gridNode / llmNode 的产物
- 主调度：非目标节点且 `data.status === 'done'` 且有产物 → 标记 `skipped`，复用旧输出，
  并回吐 `done` 事件（带 imageUrl / videoUrl），前端状态不会卡在 running
- **目标节点（用户主动点的那个）永远重新执行**
- 不传 `targetIds`（全跑）时不跳过，保持原有语义
- 成败判定改用 `runSteps`（排除 skipped），避免目标失败被误判成 partial
- 新增 `test/engine-skip-verify.mjs`：本地 mock 网关 + 5 组场景，15/15 通过

## v0.7.4 — 2026-09-13

### 视频请求体移除 duration 字段
- 用户生成视频时上游返回 `400：duration is not an allowed request field`（agnes-video-2.5 等严格网关）。
- `builtinSpec(kind=video)` 不再发送 `duration`，只保留 `model / prompt / image / aspect_ratio`。
- 原因：不同网关/模型对视频字段名差异很大，统一发送容易触发严格字段校验；后续若某网关需要，可在 provider `extra_json` 里配置扩展字段。

## v0.7.3 — 2026-09-13

### 视频节点模型下拉随 provider 切换
- `App.jsx` `loadModels()` 默认会同时拉 thinking / image_gen / video 三个用途的模型并按 kind 合并，
  之前视频节点一直显示 thinking 用途供应商的模型。
- `video.js` `modelKind()` 增加 minimax / hailuo / h3 为 video 关键字，minimax-h3 等模型能进视频下拉。
- 新增 `test/video-models-verify.mjs`（5/5）。

### 严格网关不再被 image_url 拒绝
- aa.mate70.com 对 `/video/generations` 返回 400 `image_url is not an allowed request field`。
- `builtinSpec(kind=video/image)` 移除冗余的 `image_url` 字段，只保留标准 `image` 字段。
- 同步更新 `test/image-mention.mjs` 断言。

### 移除画布顶部「运行所选 / 运行全部」按钮
- 用户反馈误点后会执行全部节点 / 生成不必要的图片。
- 删除 `CanvasView.jsx` 顶栏 primary 运行按钮，只保留节点自身的生成按钮（点哪个就跑哪个）。
- 新增 `test/no-runall-verify.mjs`（3/3）。

## v0.7.2 — 2026-09-13

### 图片节点 @ 引用全链路打通（与视频节点对齐）

- 图片节点的前端 @ 引用 UI（参考行 / 内联 chip / 选择器 / 点击放大）此前已就位，但有两处断点导致实际不生效：
  1. **前端**：`ImageNode` 没把 `refs` 同步写进 `node.data.mediaRefs` → 后端 `pickRefUrl` 拿不到编号表。
     补上与 `VideoNode` 一致的同步 effect。
  2. **后端**：`builtinSpec(kind=image)` 构建请求体时丢掉了 `vars.image` —— 传了参考图但没发出去。
     现在与视频同款：有参考图时 body 带 `image` + `image_url`（编辑型模型如 gemini-image 会消费）。
- `imageNode` handler 的参考图 URL 加了与视频节点相同的协议白名单（http / data: / /outputs/）。
- 回归：`ref-mention.mjs` 的 DOM 断言从旧版 textarea 选择器迁移到 MentionInput（`.mi-box` / `.mi-picker` / `.mi-chip`），
  contenteditable 输入改用 `execCommand('insertText')` 走真实输入路径。

### 测试

- 新增 `test/image-mention.mjs` 12 项：image 请求体带/不带参考图、`pickRefUrl` / `stripMentions` / `mentionKeys` 图片节点场景
- 全绿：ref-mention 29 / ref-insert 7 / chip-click 7 / ref-live 11，无回归

## v0.7.1 — 2026-09-13

### 修复：视频节点提示词里的内联 @图片N 缩略图点击无法放大

- 根因：`MentionInput` 通过原生 `addEventListener('mousedown')` 给每个 `contentEditable=false` 的 chip 绑事件，
  这些子节点会被频繁重建，且 `contenteditable` 内部对非编辑子节点的鼠标事件处理不可靠，导致用户点击无反应。
- 修复：改成**容器级事件委托**（React `onMouseDown` 挂在 `.mi-box` 上），通过 `e.target.closest('[data-mention]')` 找到 chip，
  读取 `data-mention` 查表并打开 `MediaPreview` 放大预览。更稳定，且不受 chip 重建影响。
- 新增回归测试：`test/chip-click-verify.mjs`，创建已连线的图片→视频节点，写入含 `@图片1` 的提示词，
  用真实 CDP 鼠标点击内联缩略图，断言 `.mp-mask` 放大预览出现，7 项全绿。
- UX 补强：视频节点在生成中（`status=running` 且无 `videoUrl`）时，卡片占位区不再只显示静态视频图标，
  而是显示 spinner +「生成中…」文案，避免用户以为视频「该显示却没显示」。
- 点击「参考」缩略图插入 @ 引用：修复 blur 后 `MentionInput` 丢失光标位置、导致插入位置错乱或失效的问题；
  现在 blur 前记住 caret 偏移，`insert` 时先 focus 再恢复到原位，再插入 `@图片N `。
- 验证：
  - `chip-click-verify.mjs` 7/7 通过
  - `ref-insert-verify.mjs` 7/7 通过
  - `video-loading-verify.mjs` 4/4 通过
  - 既有 `ref-live-verify.mjs` 11/11 通过，无回归

## v0.7.0 — 2026-09-13

- 新增「Skill 套路」体系（对齐 LibTV 的 skill 市场）：一个 Skill = 风格 + 镜头参数 + 步骤 recipe + 提示词增强
- Agent 应用新增 Skill 套路库：类型 tab（全部/图片/视频）+ 题材分类 chips + 卡片（斜杠命令 / 描述 / 作者 / 使用量 / 镜头参数），一键「使用」
- 套用一个 Skill 会自动：按模板填好目标文案、切到套路指定岗位、把风格与镜头参数落到剧本、写进运行记录
- 编排引擎按套路执行：期望步骤链 + 剧本/分镜/提示词三项专属规范注入 System 提示词；运行快照 Skill 保证历史可复现
- 内置 8 个套路：精品女频短剧 / 古典武侠片 / POP MV / 梦核美学 / A24 电影感 / 美妆 UGC 测评 / 电商带货 UGC / 角色三视图
- 新增接口：`GET|POST /api/skills`、`PUT|DELETE /api/skills/:id`、`GET /api/skills/meta`、`POST /api/skills/:id/apply`（套用预览零花费）
- 画布顶栏按 LibTV 改造：视图标签页（画布/工作流/故事板）+ Agent 入口；底部悬浮工具条与左下控件条（整理画布 / 小地图 / 隐藏连线 / 网格吸附 / 缩放）
- 修复**事后连线不传图**：节点只读 CanvasView 的 ref，而 ref 在 effect 中更新导致新建连线后节点读不到 → 节点改用 React Flow store 订阅，连线即时生效
- 修复 Skill 新建时 INSERT 参数错位导致 spec_json 丢失；编辑 Skill 时 spec 被整体覆盖 → 改为深合并
- 修复 `loadAgent(undefined)` 把 undefined 绑到 SQLite 参数导致「只选 Skill 不选岗位」直接报错
- 新增测试：skill-e2e（38）、skill-ui-verify（22）、ref-live-verify（11，覆盖事后连线场景）

## v0.6.0 — 2026-09-13

- 新增「Agent 应用」视图（侧边栏常驻）：多 Agent 剧组编排，一句话目标 → Agent 自动调度整条流水线
- 编排引擎（server/agents.js）：提示词约定 + JSON 决策（不依赖网关 function calling），解析复用截断兜底，连续失败自动软停止
- 工具注册表（server/tools.js）：15 个工具全部为现有 pipeline/export 函数的薄封装，按 kind 分级（read/text/image/video），图像视频类默认「花钱前必须确认」
- 三道护栏 + 确认闸门：已有正文拒绝无脑覆盖、已有镜头必须显式指定重拆/追加、有素材时重拆需用户点头；预算四重上限（步数/生图/生视频/时限），触顶软停止保留现场
- 预置 5 个岗位：制片人（统筹）/ 编剧 / 分镜师 / 美术指导 / 剪辑师，人设、工具白名单、预算、全自动开关均可编辑
- 实时时间线（SSE）：snapshot + step/ask/budget/done/fatal 事件，思考-工具-观察逐卡展示，产物缩略图内联；刷新页面自动接上最近一次运行
- 全状态落库（agent / agent_run / agent_step）：支持从任意失败步「从此步重跑」，已完成步骤不重复花钱
- 运行台：目标输入、启停、成本预算条、确认卡（快捷选项 + 意见输入）、产物墙（图/视频/成片）
- 修复编排循环中 fixCount 变量遮蔽导致「间歇性解析失败」被误判为连续失败的问题
- 补齐缺失的 npm test 入口（test/smoke.mjs → Agent 端到端 47 项）；新增 test:ui 无头浏览器验收（27 项）

## v0.5.0 — 2026-09-11

- 界面按 LibTV / OiiOii 重做布局：左侧竖栏（导航 + 我的剧本列表）+ 顶部状态栏 + 主内容区
- 新增「创作台」首页：一句话输入即自动写剧本并拆分镜，附 6 个快捷入口与剧本封面网格
- 分镜页新增右侧检查器：大图预览、逐项编辑、视频参数（5/8/10 秒 · 9:16/16:9/1:1）、版本择优、提示词查看
- 新增素材库视图（成片与镜头视频）与风格库视图（可视化卡片切换）
- 模型可用性改为实测探测（缺参数探测法，不消耗生成额度），修正此前用网关 403 白名单硬过滤导致的模型缺失：
  视频模型恢复为 4 个（含 agnes-video-2.5 / 2.5-flash），图像恢复为 3 个（含 agnes-image-2.5-flash）
- shot 表新增 ratio 字段，视频生成支持比例参数

## v0.4.0 — 2026-09-11

- 多供应商支持：内置 12 个常见网关预设（OpenAI / Anthropic / Gemini / 硅基流动 / 百炼 / 火山方舟 / DeepSeek / Kimi / 智谱 / OpenRouter / Ollama / 自建中转）
- 自定义 API 接口适配器：任意 REST 接口可通过占位符模板 + 字段路径 + 异步轮询接入，支持界面内试跑
- 模型用途拆分为文本 / 图像 / 视频三类，各自可独立选择来源（直填 / 供应商 / 自定义接口）
- 账号模型权限自愈：解析网关返回的可用模型白名单并据此过滤下拉
- 打包为 Windows 桌面应用（Electron，免安装绿色版）
- 加入 Git 版本管理、CHANGELOG 与一键发布脚本

## v0.3.0 — 2026-09-11

- 图生视频（单镜 + 批量），自动轮询异步任务，429 限流退避重试
- 成片导出：ffmpeg 拼接竖屏 MP4 + SRT 字幕，自动跳过空镜
- 多版本择优：每镜一次生成 1/2/4 版并挑选定稿
- 修复重复拆分镜造成镜头堆积、导出遇空镜整体失败

## v0.2.0 — 2026-09-11

- 漫剧创作流水线：剧本 → 一键拆分镜 → 角色档案 → 多宫格分镜 → 批量生图
- 角色形象锁定（跨镜一致性）与 12 款内置风格库
- 拆分镜 JSON 截断容错解析

## v0.1.0 — 2026-09-10

- 首个版本：无限节点画布 + 文本/大模型/图像/备注四类节点 + 拓扑执行引擎
- SQLite 本地存储、提示词片段库、多画布管理、撤销重做
