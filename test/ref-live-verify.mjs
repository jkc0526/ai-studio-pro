/**
 * 回归：**先开着页面、事后连线**也要能传图（用户报的 bug）
 * 场景：图片节点（已有图）+ 视频节点，初始无连线 → 通过真实鼠标拖拽连线 → 参考行必须立刻出现
 * 全程临时画布，跑完删除
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const APP = 'http://127.0.0.1:8787';
const CDP = 'http://127.0.0.1:9222';
const ROOT = 'E:/work Buddy/weave-canvas';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/ref-live.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => (await fetch(`${APP}${p}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
})).json().catch(() => null);

/* 准备：图片节点带图 + 视频节点（模式=全能参考），初始不连线 */
for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__ref_live_test__') await api(`/api/canvases/${c.id}`, 'DELETE');
}
const media = (await api('/api/media'))?.data || [];
const img = (media.find((m) => m.kind === 'image') || media[0])?.file_path;
const created = await api('/api/canvases', 'POST', { title: '__ref_live_test__' });
const canvasId = created?.data?.id;
await api(`/api/canvases/${canvasId}`, 'PUT', {
  canvas: {
    nodes: [
      { id: 'p1', type: 'imageNode', position: { x: 120, y: 180 }, data: { label: '图片节点 1', imageUrl: img, ratio: '16:9', quality: '1K' } },
      { id: 'v1', type: 'videoNode', position: { x: 620, y: 180 }, data: { label: '视频节点 1', mode: 'omni', prompt: '在草地上奔跑' } },
    ],
    edges: [],
  },
});

/* 浏览器 */
let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-ref-live`, '--no-first-run'], { detached: true, stdio: 'ignore' });
  browser.unref();
  for (let i = 0; i < 40; i++) { await sleep(400); if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) break; }
}
const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const errs = [];
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') errs.push((msg.params.exceptionDetails?.exception?.description || '').slice(0, 160));
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 940, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: APP }, sessionId);
await sleep(4800);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra }, sessionId);

log('=== 1. 打开临时画布（无连线） ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1500);
const switched = await ev(`(() => {
  const sel = document.querySelector('.cv-picker');
  const opt = [...sel.options].find(o => o.text.includes('__ref_live_test__'));
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
check('切换到临时画布', switched === true);
await sleep(2500);
check('初始没有连线', (await ev(`document.querySelectorAll('.react-flow__edge').length`)) === 0);
check('初始「参考」行为空（符合预期）', (await ev(`document.querySelectorAll('.oii-node-video .oii-ref').length`)) === 0);

log('\n=== 2. 用真实鼠标拖拽连线（复现用户操作） ===');
const pts = JSON.parse(await ev(`(() => {
  const img = document.querySelector('.react-flow__node[data-id="p1"]');
  const vid = document.querySelector('.react-flow__node[data-id="v1"]');
  const src = img?.querySelector('.react-flow__handle-right');
  const dst = vid?.querySelector('.react-flow__handle-left');
  if (!src || !dst) return 'null';
  const a = src.getBoundingClientRect(); const b = dst.getBoundingClientRect();
  return JSON.stringify({
    from: { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) },
    to: { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) },
  });
})()`) || 'null');
check('拿到两侧连接桩坐标', !!pts && pts.from && pts.to, JSON.stringify(pts));

// 悬停显示桩 → 按下 → 拖 → 松开
await mouse('mouseMoved', pts.from.x, pts.from.y);
await sleep(300);
await mouse('mousePressed', pts.from.x, pts.from.y, { clickCount: 1 });
await sleep(250);
for (let i = 1; i <= 6; i++) {
  const x = pts.from.x + ((pts.to.x - pts.from.x) * i) / 6;
  const y = pts.from.y + ((pts.to.y - pts.from.y) * i) / 6;
  await mouse('mouseMoved', Math.round(x), Math.round(y));
  await sleep(120);
}
await mouse('mouseReleased', pts.to.x, pts.to.y, { clickCount: 1 });
await sleep(1500);

log('\n=== 3. 连线后立即校验 ===');
const edgeCount = await ev(`document.querySelectorAll('.react-flow__edge').length`);
check('连线已建立', edgeCount >= 1, String(edgeCount));
check('「参考」行立刻出现（本次修复的核心）', (await ev(`!!document.querySelector('.oii-node-video .oii-refs')`)),
  `refs=${await ev(`document.querySelectorAll('.oii-node-video .oii-ref').length`)}`);
check('参考缩略图编号为「图片1」', (await ev(`document.querySelector('.oii-node-video .oii-ref b')?.innerText`)) === '图片1',
  await ev(`document.querySelector('.oii-node-video .oii-ref b')?.innerText`));
check('缩略图渲染为图片', await ev(`!!document.querySelector('.oii-node-video .oii-ref img')`));
await sleep(2200);
const c2 = (await api(`/api/canvases/${canvasId}`))?.data;
const j2 = typeof c2.canvas_json === 'string' ? JSON.parse(c2.canvas_json) : c2.canvas_json;
const vnode = (j2.nodes || []).find((n) => n.id === 'v1');
check('mediaRefs 已落库（后端可解析 @图片1）', Array.isArray(vnode?.data?.mediaRefs) && vnode.data.mediaRefs.length === 1,
  JSON.stringify(vnode?.data?.mediaRefs));
const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(path.join(ROOT, 'test/shot-ref-live.png'), Buffer.from(s.data, 'base64'));
log('  截图: test/shot-ref-live.png');

log('\n=== 4. 收尾 ===');
check('无 console 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
await api(`/api/canvases/${canvasId}`, 'DELETE');
const left = (await api('/api/canvases'))?.data || [];
check('临时画布已删除', !left.some((c) => c.id === canvasId));
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
