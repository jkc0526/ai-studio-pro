/**
 * 验证：点下游节点生成时，上游已完成的节点会被跳过（复用旧产物，不重复调 API）
 *
 * 本地 mock 网关只接管 image 接口（video 走的是 resolveTarget('video') 分支，
 * 会忽略传入的 config 直接查库，因此视频节点会打到真实网关并被额度不足 403 秒拒，
 * 不产生费用也不重试）。核心断言一律看 step 的 status，不依赖真实调用结果。
 */
import http from 'node:http';
import { runWorkflow, ProgressEmitter } from '../server/engine.js';

let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };

const hits = [];
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    hits.push({ url: req.url, body });
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'mock: no-op' } }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockBase = `http://127.0.0.1:${mock.address().port}/v1`;

const configs = {
  image_gen: { purpose: 'image_gen', base_url: mockBase, api_key: 'test', model_id: 'mock-image' },
  video: { purpose: 'video', base_url: mockBase, api_key: 'test', model_id: 'mock-video' },
  thinking: { purpose: 'thinking', base_url: mockBase, api_key: 'test', model_id: 'mock-text' },
};

const img = (id, extra = {}) => ({
  id, type: 'imageNode', position: { x: 0, y: 0 },
  data: { label: id, prompt: '一只猫', status: 'done', imageUrl: '/outputs/cat.png', ...extra },
});
const vid = (id, extra = {}) => ({
  id, type: 'videoNode', position: { x: 300, y: 0 },
  data: { label: id, prompt: '猫在跳舞', mode: 'image', ...extra },
});

console.log('=== 1. 上游已完成 → 跳过，不重复调 API（目标也是图片节点，全走 mock） ===');
{
  hits.length = 0;
  const r = await runWorkflow({
    nodes: [img('i1'), img('i2')],
    edges: [{ source: 'i1', target: 'i2' }],
    targetIds: ['i2'],
    configs,
  });
  const byId = Object.fromEntries(r.steps.map((s) => [s.nodeId, s.status]));
  console.log('   steps:', JSON.stringify(r.steps.map((s) => `${s.nodeId}:${s.status}`)));
  check('上游 i1 被跳过', byId.i1 === 'skipped', String(byId.i1));
  check('目标 i2 仍执行（mock 400 → error）', byId.i2 === 'error', String(byId.i2));
  check('跳过的节点没进 errors', !r.errors.some((e) => e.nodeId === 'i1'), JSON.stringify(r.errors));
  // 关键：只应有目标节点的一次请求，被跳过的上游一次都没发
  check('只发了 1 次 API 请求（上游被跳过）', hits.length === 1, String(hits.length));
  check('请求是图片生成接口', hits[0]?.url?.includes('/images/generations'), JSON.stringify(hits.map((h) => h.url)));
  // 被跳过的上游其旧产物应直接透传给下游使用
  check('失败判定为 failed 而非 partial', r.status === 'failed', r.status);
}

console.log('\n=== 2. 上游未完成 → 照常执行（会打 mock） ===');
{
  hits.length = 0;
  const r = await runWorkflow({
    nodes: [img('i1', { status: null, imageUrl: undefined }), img('i2')],
    edges: [{ source: 'i1', target: 'i2' }],
    targetIds: ['i2'],
    configs,
  });
  const byId = Object.fromEntries(r.steps.map((s) => [s.nodeId, s.status]));
  console.log('   steps:', JSON.stringify(r.steps.map((s) => `${s.nodeId}:${s.status}`)));
  check('上游 i1 未被跳过', byId.i1 !== 'skipped', String(byId.i1));
  check('上游执行了（mock 400 → error）', byId.i1 === 'error', String(byId.i1));
  check('两个节点都发了请求', hits.length === 2, String(hits.length));
}

console.log('\n=== 3. 目标节点即使已完成也重新执行（视频节点） ===');
{
  const r = await runWorkflow({
    nodes: [img('i1'), vid('v1', { status: 'done', videoUrl: '/outputs/old.mp4' })],
    edges: [{ source: 'i1', target: 'v1' }],
    targetIds: ['v1'],
    configs,
  });
  const byId = Object.fromEntries(r.steps.map((s) => [s.nodeId, s.status]));
  check('目标 videoNode 未被跳过', byId.v1 !== 'skipped', String(byId.v1));
  check('上游仍被跳过', byId.i1 === 'skipped', String(byId.i1));
}

console.log('\n=== 4. 不传 targetIds（全跑）→ 不跳过 ===');
{
  const r = await runWorkflow({
    nodes: [img('i1'), img('i2')],
    edges: [{ source: 'i1', target: 'i2' }],
    targetIds: [],
    configs,
  });
  const byId = Object.fromEntries(r.steps.map((s) => [s.nodeId, s.status]));
  check('上游 i1 未被跳过', byId.i1 !== 'skipped', String(byId.i1));
}

console.log('\n=== 5. 跳过节点回吐的 SSE 事件字段正确 ===');
{
  const emitter = new ProgressEmitter();
  const seen = [];
  emitter.on('node', (e) => seen.push(e));
  await runWorkflow({
    nodes: [img('i1'), img('i2')],
    edges: [{ source: 'i1', target: 'i2' }],
    targetIds: ['i2'],
    configs,
    emitter,
  });
  const skipEvt = seen.find((e) => e.nodeId === 'i1' && e.status === 'done');
  console.log('   i1 event:', JSON.stringify(skipEvt));
  check('跳过节点回吐 done 事件', !!skipEvt, JSON.stringify(seen.map((s) => `${s.nodeId}:${s.status}`)));
  // cached 里也有 kind（媒体类型 image），不能顶掉节点类型
  check('kind 是节点类型 imageNode 而非媒体类型', skipEvt?.kind === 'imageNode', String(skipEvt?.kind));
  check('带回已有 imageUrl，前端可复用', skipEvt?.imageUrl === '/outputs/cat.png', String(skipEvt?.imageUrl));
}

mock.close();
console.log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
