# 对标勘察：LibTV 画布结构与模仿落地

> 勘察时间：2026-09-13 · 通过用户浏览器会话（克隆 profile 复用登录态）实测
> 脚本：`test/libtv-canvas-study.mjs`（等登录→进画布）、`test/libtv-deep.mjs`、`test/libtv-ui.mjs`（结构精抓）
> 产物：`study-libtv-canvas-editor.png`、`study-libtv-u1~u3-*.png`、`test/libtv-ui.json`

---

## 一、访问过程（供复现）

LibTV 画布严格在登录后。自动复用登录态的两条路都不通：

| 尝试 | 结果 |
| --- | --- |
| 复制 Edge 的 Cookies 库 | **EBUSY** —— Edge 正在运行，Cookies 被独占锁定 |
| 复制 Chrome 的 Cookies 库 | 能复制，但里面**没有 liblib 相关 Cookie**（登录在 Edge 里） |
| 复制 Local Storage / Preferences / Login Data | 成功，但不足以恢复登录 |

最终方案：克隆 profile 副本 → 拉起带调试端口的 Edge → **由用户在该窗口扫码登录一次**（登录态落在副本里，不干扰其日常浏览器），之后所有勘察都由 CDP 自动完成。

> ⚠️ 关键坑：后台拉起的浏览器会随命令结束被回收，**必须把「启动+导航+等待+抓取」放在同一个长驻进程里**（`run_in_background`）。

---

## 二、画布 chrome 结构（实测坐标，1680×1000 视口）

### 顶栏
| 位置 | 元素 |
| --- | --- |
| 左 | 返回 / logo · `未命名工作区`（面包屑）· `画布 1` 下拉 · 工作流 · 故事板 |
| 右 | 图标 · 蓝点图标 · `开通会员 限时45折` · `⚡100`（积分）· 头像 · **`Agent`（aria=打开 Agent）** |

顶部标签页共四个：**画布 / 工作流 / 故事板 / 发布与分享**。

### 底部居中悬浮工具条（y≈747，8 个图标）
```
添加节点 · 移动 · 打开工具箱 · 素材库 · 角色库 · 生成历史 · 快捷键 · 教程
```

### 左下控件条（y≈754）
```
资产管理 | 整理画布(Alt+Shift+F) | 切换小地图 | 隐藏节点连线 | 网格吸附 | 100%(缩放)
```

### 空画布引导
- 中央提示：**「双击画布 · 自由生成节点」**（带光标图标）
- 4 张彩色快捷卡片：`故事脚本生成`（青绿）· `角色三视图`（红）· `全能参考生视频 SD 2.5`（蓝）· `音频生视频 SD 2.5`（紫）

### 「添加节点」菜单（220×475 @417,255）
```
[添加节点] ⌕
  文本 · 图片 · 视频 · 智能剪辑[Beta] · 导演台[NEW] · 逐帧拉片[SD 2.5] · 音频 · 脚本 › · 素材库 ›
[添加资源]
  上传 · 从生成历史选择
```

---

## 三、LibTV Agent 与 Skill 体系（本次最大收获）

Agent 面板结构（点右上角 Agent 打开）：

```
Skill 全开，故事走起
[Skill] [收藏] [我的] [推荐]
分类：专业影视 / 商业广告 / 短剧漫剧 / 动漫游戏 / 音乐MV / 自媒体创作 / 通用技能
类型：发现 / 视频 / 图片
```

**Skill 以斜杠命令标识**，每个 Skill 有：类型(视频/图片) · 命令 · 标题 · 描述 · 作者 · 使用量 · 「使用」按钮。实测抓到的目录（部分）：

| 命令 | 标题 | 作者 | 使用量 |
| --- | --- | --- | --- |
| `/xingrannvpin` | 精品女频短剧一键成片 | 星燃AI | 1.6w |
| `/hujinquanwuxia` | 古典武侠电影全流程导演 | 虾饺o | 1.4w |
| `/casting-director` | 选角 Casting | 苏打绿豆 | 5.3k |
| `/xianxia-drama-planner` | 东方巨构美学短剧 | 鱿鱼chill | 3.7k |
| `/absurdist-comedy-maker` | 无厘头喜剧 | 捏捏AI | 3.7k |
| `/pop-music-video` | POP MV | 鱿鱼chill | 2.5k |
| `/wes-anderson-aesthetics` | 韦斯安德森电影美学 | omom | 2.7k |
| `/cinematic-vfx-creator` | 影视打斗特效 skill | 星曜AG | 2.3k |
| `/a24-cinematic-aesthetic` | A24 电影美学 | 鱿鱼chill | 1.3k |
| `/beauty-blogger-reviewer` | 真人感美妆 UGC 产品测评 | 刘不住Wander | 1.9k |
| `/ai-model-talkshow-producer` | AI 模特脱口秀 skill | 刘不住Wander | 1.2k |
| `/dreamcore-generator` | 梦核美学 | 鱿鱼chill | 1.2k |
| `/ecommerce-ugc-ad-planner` | 北美电商出海 UGC | 星星 | 1.0k |
| `/oriental-aesthetic-film` | 仙侠氛围美学短片 | 鱿鱼chill | 2.0k |
| `/cuyezhuyi` | 苏联粗野主义 | 翻山计划 | 389 |
| `/wander-high-energy-fashion-ad` | 高机能时尚风配饰酷炫广告 | 刘不住Wander | 241 |
| `/conceptual-character-creator` | 概念角色 SSS 级技能展示 | Rick | 844 |

**规律**：Skill 是「一个创作套路」的完整封装——风格定位 + 提示词体系 + 步骤编排，用户只需一句话。带作者与使用量，说明它是**可分享的创作资产**。

---

## 四、本次已落地的模仿（v0.6.1）

| LibTV 元素 | WeaveCanvas 落地 | 说明 |
| --- | --- | --- |
| 底部居中悬浮工具条 | ✅ `.cv-dock`（8 个按钮） | 添加节点 / 适应视图 / 片段库 / 素材库 / 角色库 / 生成历史 / 快捷键 / 教程 |
| 左下控件条 | ✅ `.cv-corner` | 节点数 / **整理画布(Alt+Shift+F)** / 小地图 / 隐藏连线 / 网格吸附 / 缩放% |
| 整理画布 | ✅ `autoLayout()` | 560×440 网格重排 + 自动 fitView，实测重叠 0 对 |
| 网格吸附 | ✅ React Flow `snapToGrid` | 默认开，可切换 |
| 隐藏节点连线 | ✅ 一键隐藏/恢复 | 实测线段数 0 ↔ 恢复 |
| 小地图按需显示 | ✅ 默认隐藏 | 对齐 LibTV「切换小地图」 |
| 顶栏标签页 | ✅ 画布 / 工作流 / 故事板 | 后两者跳到我们的生产线、分镜页 |
| 顶栏 Agent 入口 | ✅ 画布右上角 `Agent` 按钮 | 一键进 Agent 应用 |
| 空画布引导 | ✅ 双击提示 + 4 张彩色卡片 | 故事脚本生成 / 角色三视图 / 图片生成 / 图生视频 |
| 快捷键面板 | ✅ 画布内浮层 | 含 Alt+Shift+F 整理画布 |

验收：`test/canvas-chrome-verify.mjs` 26 项 + `test/canvas-empty-verify.mjs` 7 项，全绿，零 console 报错，临时画布跑完即删。

---

## 五、尚未模仿（建议排期）

1. **Skill 成套化（最高价值）**：把「风格 + 提示词 + 参数 + 步骤」打成 Skill 包，Agent 输入框下方列 chips 一键套用。
   参考 LibTV：斜杠命令 + 标题 + 描述 + 作者 + 使用量。我们的零件（风格库/片段库/Agent 岗位/15 个工具）已经齐了。
2. **Agent 面板内的 Skill 分类浏览**：`发现 / 视频 / 图片` + 7 个题材分类 tab。
3. **节点内联参数面板**：LibTV 图片节点带「尝试：图生图 / 图片高清 / 参考 / 标记 / 风格」+ 「智能引用 AutoLink」+ 参数行 `16:9 · 标准画质 · 2K · 1张`。
4. **添加节点菜单的二级结构**：素材库 › / 脚本 › 是我们的 palette 还没做的分组展开。
5. 发布与分享（我们是本地工具，暂不做）。
