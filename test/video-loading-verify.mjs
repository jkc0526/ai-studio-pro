/**
 * 验证：视频节点在生成中（status=running 且无 videoUrl）时显示 loading 动画，而不是空白图标
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
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/video-loading.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => (await fetch(`${APP}${p}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
})).json().catch(() => null);

for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__video_loading_test__') await api(`/api/canvases/${c.id}`, 'DELETE');
}
const created = await api('/api/canvases', 'POST', { title: '__video_loading_test__' });
const canvasId = created?.data?.id;
await api(`/api/canvases/${canvasId}`, 'PUT', {
  canvas: {
    nodes: [
      { id: 'v1', type: 'videoNode', position: { x: 300, y: 200 }, data: { label: '生成中视频', mode: 'text', status: 'running', prompt: '测试生成中状态' } },
    ],
    edges: [],
  },
});

let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-video-loading`, '--no-first-run'], { detached: true, stdio: 'ignore' });
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
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: APP }, sessionId);
await sleep(4800);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;

log('=== 1. 打开临时画布（视频节点 status=running，无 videoUrl） ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1500);
await ev(`(() => {
  const sel = document.querySelector('.cv-picker');
  const opt = [...sel.options].find(o => o.text.includes('__video_loading_test__'));
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(2500);

log('\n=== 2. 校验 loading 状态 ===');
check('节点状态 pill 显示「生成中」', await ev(`document.querySelector('.oii-node-video .oii-badge')?.innerText === '生成中'`),
  await ev(`document.querySelector('.oii-node-video .oii-badge')?.innerText`));
check('占位区显示 spinner', await ev(`!!document.querySelector('.oii-node-video .oii-spinner')`));
check('占位区显示「生成中…」文字', await ev(`document.querySelector('.oii-node-video .oii-ph.loading small')?.innerText === '生成中…'`),
  await ev(`document.querySelector('.oii-node-video .oii-ph.loading small')?.innerText`));
const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(path.join(ROOT, 'test/shot-video-loading.png'), Buffer.from(s.data, 'base64'));
log('  截图: test/shot-video-loading.png');

log('\n=== 3. 收尾 ===');
check('无 console 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
await api(`/api/canvases/${canvasId}`, 'DELETE');
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
