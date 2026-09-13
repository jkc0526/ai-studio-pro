/**
 * 验证：视频节点提示词里的内联 @图片N 缩略图，点击能放大预览
 * 场景：图片节点(带图) → 连线 → 视频节点(提示词含 @图片1)
 * 通过 CDP 真实点击内联缩略图，断言放大预览( .mp-mask )出现
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
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/chip-click.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => (await fetch(`${APP}${p}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
})).json().catch(() => null);

/* 准备：图片节点带图 + 视频节点(提示词含 @图片1)，并连线 */
for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__chip_click_test__') await api(`/api/canvases/${c.id}`, 'DELETE');
}
const media = (await api('/api/media'))?.data || [];
const img = (media.find((m) => m.kind === 'image') || media[0])?.file_path;
if (!img) { log('⚠️ 没有可用图片素材，跳过'); report(); process.exit(0); }
const created = await api('/api/canvases', 'POST', { title: '__chip_click_test__' });
const canvasId = created?.data?.id;
await api(`/api/canvases/${canvasId}`, 'PUT', {
  canvas: {
    nodes: [
      { id: 'p1', type: 'imageNode', position: { x: 120, y: 180 }, data: { label: '图片节点 1', imageUrl: img, ratio: '16:9', quality: '1K' } },
      { id: 'v1', type: 'videoNode', position: { x: 620, y: 180 }, data: { label: '视频节点 1', mode: 'omni', prompt: '@图片1 在草地上奔跑' } },
    ],
    edges: [{ id: 'e1', source: 'p1', target: 'v1' }],
  },
});

/* 浏览器 */
let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-chip-click`, '--no-first-run'], { detached: true, stdio: 'ignore' });
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

log('=== 1. 打开临时画布（已连线，提示词含 @图片1） ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1500);
await ev(`(() => {
  const sel = document.querySelector('.cv-picker');
  const opt = [...sel.options].find(o => o.text.includes('__chip_click_test__'));
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(2800);

log('\n=== 2. 校验内联缩略图已渲染 ===');
const chipHtml = await ev(`(() => {
  const c = document.querySelector('.oii-node-video .mi-chip[data-mention="图片1"]');
  if (!c) return 'NO_CHIP';
  return c.outerHTML.slice(0, 120);
})()`);
check('提示词里 @图片1 渲染成内联 chip', chipHtml && chipHtml !== 'NO_CHIP', String(chipHtml));
check('内联 chip 是带图的缩略图', await ev(`!!document.querySelector('.oii-node-video .mi-chip[data-mention="图片1"] img')`));
check('点击放大前没有预览遮罩', !(await ev(`!!document.querySelector('.mp-mask')`)));

log('\n=== 3. 真实点击内联缩略图 ===');
const rect = await ev(`(() => {
  const c = document.querySelector('.oii-node-video .mi-chip[data-mention="图片1"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
})()`);
check('拿到 chip 坐标', !!rect, String(rect));
if (rect) {
  const { x, y } = JSON.parse(rect);
  await mouse('mouseMoved', x, y);
  await sleep(120);
  await mouse('mousePressed', x, y, { clickCount: 1 });
  await sleep(120);
  await mouse('mouseReleased', x, y, { clickCount: 1 });
  await sleep(900);
}
check('点击后放大预览(.mp-mask)出现', await ev(`!!document.querySelector('.mp-mask')`));
check('预览里是同一张图片', await ev(`(() => {
  const m = document.querySelector('.mp-mask'); const i = document.querySelector('.oii-node-video .mi-chip[data-mention="图片1"] img');
  return m && i ? m.querySelector('img')?.src === i.src : false;
})()`));
const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(path.join(ROOT, 'test/shot-chip-click.png'), Buffer.from(s.data, 'base64'));
log('  截图: test/shot-chip-click.png');

log('\n=== 4. 收尾 ===');
check('无 console 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
await api(`/api/canvases/${canvasId}`, 'DELETE');
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
