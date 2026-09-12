/**
 * 冒烟测试入口：跑一遍 Agent 端到端（覆盖后端全链路，Mock 模型零花费）。
 * 历史上的 smoke.mjs 从未入库，这里把它扶正为统一入口。
 * UI 级验收（无头浏览器）走：npm run test:ui
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(process.execPath, [path.join(root, 'test', 'agent-e2e.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 1);
