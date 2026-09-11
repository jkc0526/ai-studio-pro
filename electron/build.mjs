// 打包脚本：@electron/packager 生成免安装的绿色版（release/WeaveCanvas-win32-x64/WeaveCanvas.exe）
import { packager } from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// 默认走国内镜像，避免直连 GitHub 下载 Electron 二进制时被 reset
if (!process.env.ELECTRON_MIRROR) {
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
}

const paths = await packager({
  dir: root,
  // 按版本号输出，避免覆盖旧目录时触发系统的批量删除保护
  out: path.join(root, 'release', `v${pkg.version}`),
  name: 'WeaveCanvas',
  appVersion: pkg.version,
  platform: 'win32',
  arch: 'x64',
  asar: false,
  overwrite: false,
  prune: true,
  ignore: [
    /^\/data($|\/)/,
    /^\/release($|\/)/,
    /^\/test($|\/)/,
    /^\/\.git($|\/)/,
    /^\/screenshot-.*\.png$/,
    /^\/\.workbuddy($|\/)/,
    /^\/electron\/build\.mjs$/,
  ],
  win32metadata: {
    CompanyName: 'WeaveCanvas',
    FileDescription: 'AI 漫剧创作流水线（剧本 · 分镜 · 角色 · 视频 · 成片）',
    ProductName: 'WeaveCanvas',
    InternalName: 'WeaveCanvas',
  },
});

const dir = paths[0];
console.log('打包完成:', dir);

// 放一个说明文件在产物旁边
fs.writeFileSync(path.join(dir, '使用说明.txt'), [
  'WeaveCanvas · AI 漫剧创作流水线',
  '',
  '1. 双击 WeaveCanvas.exe 启动（首次启动会自动创建 WeaveCanvas-data 数据目录）',
  '2. 进入后点右上角「设置」，填 Base URL / API Key / 模型名（支持 OpenAI、Anthropic、Gemini、硅基流动、火山方舟、DeepSeek、Kimi、智谱、OpenRouter、本地 Ollama 等预设，也可自定义任意 REST 接口）',
  '3. 剧本 → 一键拆分镜 → 提取角色 → 分镜批量生图 → 图生视频 → 导出成片（MP4 + SRT）',
  '',
  '数据位置：WeaveCanvas-data/（数据库与生成产物都在这里，整个文件夹拷走即可迁移）',
  '封面截图：见同目录 screenshot-*.png',
].join('\r\n'), 'utf8');

for (const f of fs.readdirSync(root)) {
  if (/^screenshot-.*\.png$/.test(f)) fs.copyFileSync(path.join(root, f), path.join(dir, f));
}
console.log('已附使用说明与截图');
