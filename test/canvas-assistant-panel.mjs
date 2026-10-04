import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCanvasTaskRows } from '../src/canvasTaskRows.js';

const rows = buildCanvasTaskRows([
  { id: 'job-1', kind: 'image', status: 'running', total: 4, done: 2, failed: 1, create_time: '2026-09-27T10:00:00Z' },
  { id: 'job-2', kind: 'shot.video', status: 'done', total: 3, done: 2, failed: 1, create_time: '2026-09-27T09:00:00Z' },
], [
  { id: 'run-1', agent_id: 'agent-1', script_id: 'script-a', goal: '生成一集漫剧', status: 'failed', create_time: '2026-09-27T11:00:00Z' },
], [{ id: 'agent-1', name: '漫剧导演' }]);

assert.equal(rows.length, 3, '任务中心合并批量任务和 Agent 运行');
assert.equal(rows[0].id, 'agent:run-1', '任务按最近创建时间倒序排列');
assert.equal(rows[0].title, '生成一集漫剧');
assert.equal(rows[0].subtitle, '漫剧导演');
assert.equal(rows[0].status, '失败');
assert.equal(rows[0].scriptId, 'script-a', '失败记录保留其剧本，用于打开对应的运行详情');
assert.equal(rows[1].id, 'job:job-1');
assert.equal(rows[1].progress, 75, '批量任务进度包含成功和失败项');
assert.equal(rows[2].status, '部分失败', '批次完成但有失败项时明确显示部分失败');

const canvas = fs.readFileSync(new URL('../src/views/CanvasView.jsx', import.meta.url), 'utf8');
const panel = fs.readFileSync(new URL('../src/components/CanvasAssistantPanel.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(canvas, /CanvasAssistantPanel/, '画布页面挂载右侧工作面板');
assert.match(panel, /任务中心/);
assert.match(panel, /工作流/);
assert.match(panel, /Agent/);
assert.match(panel, /listJobs|listAgentRuns/);
assert.match(panel, /startAgentRun/);
assert.match(panel, /加载更多任务/, '任务中心应有查看较早记录的入口');
assert.match(panel, /if \(!open\) return undefined;/, '面板收起时应停止轮询');
assert.match(styles, /cv-assistant-panel/);

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-task-history-'));
process.env.WEAVE_DATA_DIR = dataDir;
const { db, q } = await import('../server/db.js');
try {
  for (let i = 0; i < 25; i++) {
    const id = String(i).padStart(2, '0');
    q.run('INSERT INTO job (id, kind, status, total, create_time) VALUES (?, ?, ?, ?, ?)',
      `job-${id}`, 'shot.video', 'done', 1, `2026-09-27T10:${id}:00Z`);
    q.run('INSERT INTO agent_run (id, agent_id, goal, status, create_time) VALUES (?, ?, ?, ?, ?)',
      `run-${id}`, 'agent-1', `任务 ${id}`, 'done', `2026-09-27T10:${id}:00Z`);
  }
  const { listJobs } = await import('../server/pipeline.js');
  const { listRuns } = await import('../server/agents.js');
  assert.equal(listJobs({ limit: 25 }).length, 25, '任务中心可以翻看超过默认 20 条的批量任务');
  assert.equal(listRuns({ limit: 25 }).length, 25, '任务中心可以翻看超过默认 20 条的 Agent 记录');
  const { app } = await import('../server/index.js');
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const jobsResponse = await (await fetch(`${base}/api/jobs?limit=25`)).json();
    const runsResponse = await (await fetch(`${base}/api/agent-runs?limit=25`)).json();
    assert.equal(jobsResponse.data.length, 25);
    assert.equal(runsResponse.data.length, 25);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log('✅ canvas assistant panel: task aggregation and canvas panel contract');
