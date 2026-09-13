/**
 * 验证：画布顶部的「运行所选/运行全部」按钮已被移除
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
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/no-runall.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-no-runall`, '--no-first-run'], { detached: true, stdio: 'ignore' });
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

log('=== 1. 进入画布视图 ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(2000);
check('画布视图已加载', await ev(`!!document.querySelector('.view-bar.cv-topbar')`));

log('\n=== 2. 检查顶部按钮 ===');
const hasRunAll = await ev(`!![...document.querySelectorAll('.view-bar.cv-topbar button')].find(b => /运行全部|运行所选/.test(b.innerText))`);
const btns = await ev(`[...document.querySelectorAll('.view-bar.cv-topbar button')].map(b => b.innerText).join(' | ')`);
log(`  顶部按钮: ${btns}`);
check('没有「运行所选/运行全部」按钮', !hasRunAll, String(hasRunAll));

log('\n=== 3. 截图 ===');
const shot = await send('Page.captureScreenshot', { format: 'png' }, session);
fs.writeFileSync(path.join(ROOT, 'test/shot-no-runall.png'), Buffer.from(shot.data, 'base64'));

log('\n=== 4. 收尾 ===');
check('无 console 异常', errs.length === 0, errs.join('; '));
await send('Target.closeTarget', { targetId });

log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
process.exit(fail ? 1 : 0);
