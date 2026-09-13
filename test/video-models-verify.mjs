/**
 * 验证：视频节点模型下拉随 video purpose 的 provider 变化，且 minimax-h3 出现在列表中
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
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/video-models.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => (await fetch(`${APP}${p}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
})).json().catch(() => null);

for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__video_models_test__') await api(`/api/canvases/${c.id}`, 'DELETE');
}
const created = await api('/api/canvases', 'POST', { title: '__video_models_test__' });
const canvasId = created?.data?.id;
await api(`/api/canvases/${canvasId}`, 'PUT', {
  canvas: {
    nodes: [
      { id: 'v1', type: 'videoNode', position: { x: 300, y: 200 }, data: { label: '视频模型测试', mode: 'text', prompt: '测试' } },
    ],
    edges: [],
  },
});

let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-video-models`, '--no-first-run'], { detached: true, stdio: 'ignore' });
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
const session = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
await send('Runtime.enable', {}, session);
await send('Page.enable', {}, session);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 940, deviceScaleFactor: 1, mobile: false }, session);
await send('Page.navigate', { url: APP }, session);
await sleep(4800);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, session))?.result?.value;

log('\n=== 1. 打开测试画布 ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1500);
const switched = await ev(`(() => {
  const sel = document.querySelector('.cv-picker');
  const opt = [...sel.options].find(o => o.text.includes('__video_models_test__'));
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
check('切换到临时画布', switched === true);
await sleep(2500);
check('视频节点存在', await ev(`!!document.querySelector('.oii-node-video')`));

log('\n=== 2. 展开模型下拉 ===');
await send('Runtime.evaluate', { expression: `document.querySelector('.oii-node-video select').click()` }, session);
await sleep(400);
const options = await send('Runtime.evaluate', {
  expression: `Array.from(document.querySelectorAll('.oii-node-video select option')).map(o => o.value || o.textContent)`,
  returnByValue: true,
}, session).then((r) => r?.result?.value || []);
log(`  下拉选项: ${JSON.stringify(options)}`);
check('包含 minimax-h3', options.includes('minimax-h3'), JSON.stringify(options));
check('不包含旧网关 agnes-video 模型', !options.some((o) => /agnes-video/i.test(o)), JSON.stringify(options));

log('\n=== 3. 截图 ===');
const shot = await send('Page.captureScreenshot', { format: 'png' }, session);
fs.writeFileSync(path.join(ROOT, 'test/shot-video-models.png'), Buffer.from(shot.data, 'base64'));

log('\n=== 4. 收尾 ===');
check('无 console 异常', errs.length === 0, errs.join('; '));
await api(`/api/canvases/${canvasId}`, 'DELETE');
await send('Target.closeTarget', { targetId });

log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
process.exit(fail ? 1 : 0);
