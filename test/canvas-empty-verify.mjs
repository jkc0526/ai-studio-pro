/** 空画布引导验收（LibTV 风格：双击提示 + 4 张快捷卡片） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const APP = 'http://127.0.0.1:8787';
const CDP = 'http://127.0.0.1:9222';
const ROOT = 'E:/work Buddy/weave-canvas';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/cv-empty.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => (await fetch(`${APP}${p}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
})).json().catch(() => null);

for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__cv_empty_test__') await api(`/api/canvases/${c.id}`, 'DELETE');
}
const created = await api('/api/canvases', 'POST', { title: '__cv_empty_test__' });
const canvasId = created?.data?.id;
check('临时空画布已创建', !!canvasId, JSON.stringify(created?.data?.node_count));

/* 端口没开就自己拉一个无头 Edge（脚本自管生命周期） */
let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-cv-empty`, '--no-first-run'], { detached: true, stdio: 'ignore' });
  browser.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) break;
  }
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

await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1500);
await ev(`(() => {
  const sel = document.querySelector('.cv-picker');
  const opt = [...sel.options].find(o => o.text.includes('__cv_empty_test__'));
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(2200);

check('空画布出现引导层', await ev(`!!document.querySelector('.cv-empty')`));
check('引导含「双击画布」提示', /双击画布/.test(await ev(`document.querySelector('.cv-empty-tip')?.innerText || ''`)),
  await ev(`document.querySelector('.cv-empty-tip')?.innerText || '(无)'`));
check('4 张快捷卡片', (await ev(`document.querySelectorAll('.cv-empty-cards .cv-ecard').length`)) === 4,
  String(await ev(`document.querySelectorAll('.cv-empty-cards .cv-ecard').length`)));
check('卡片文案正确', JSON.stringify(await ev(`[...document.querySelectorAll('.cv-empty-cards .cv-ecard b')].map(b=>b.innerText)`)) === '["故事脚本生成","角色三视图","图片生成","图生视频"]',
  JSON.stringify(await ev(`[...document.querySelectorAll('.cv-empty-cards .cv-ecard b')].map(b=>b.innerText)`)));
const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(path.join(ROOT, 'test/shot-cv-empty.png'), Buffer.from(s.data, 'base64'));
log('  截图: test/shot-cv-empty.png');

check('无 console 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
await api(`/api/canvases/${canvasId}`, 'DELETE');
const left = (await api('/api/canvases'))?.data || [];
check('临时画布已删除', !left.some((c) => c.id === canvasId));
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
