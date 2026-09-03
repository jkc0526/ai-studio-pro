# AI Studio Pro（agnes-studio）

基于 Electron + Express 的桌面 AI 图片/视频生成工具，对接 Agnes AI 开放平台 API（`apihub.agnes-ai.com`）。

## 开发运行

- 桌面模式：`npm start`（Electron 主进程会自动启动内置服务并打开窗口）
- 仅服务模式（浏览器访问 http://127.0.0.1:3000）：`npm run dev`（即 `node server.js`）

本地服务默认只监听 `127.0.0.1`，如需改监听地址可设置环境变量 `AI_STUDIO_HOST`（例如 `0.0.0.0`）。

## 打包

- 生成安装版与便携版：`npm run build`（等价 `electron-builder --win`）
- 仅生成解包目录便于本地调试：`npm run build-dir`

## 说明与现状

- **API Key 存储**：Electron 桌面版通过系统级加密（safeStorage/DPAPI）存入 userData；Web 模式回退 localStorage。
- **dist 为过期产物**：当前 `dist/` 下安装包为 v2.0.0，而源码版本为 v2.1.0；如需分发请重新执行 `npm run build`。
- **自动更新未配置**：`package.json` 中 `build.win.publish.url` 仍为占位地址，未配置真实更新源，因此启动时不会发起更新检查；配置真实地址后再执行 `npm run publish` 生成 `latest.yml` 方可使用自动更新。
- 用户生成数据（`data/`、`media/`）不纳入版本管理。
