/**
 * 试试未登录状态下能走到哪一步：点「开始创作」/「新建画布创作」看是否放行画布
 * 产出：test/libtv-creator-try.txt + study-libtv-try*.png
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const CDP = 'http://127.0.0.1:9333';
const ROOT = 'E:/work Buddy/weave-canvas';
const CLONE = path.join(os.tmpdir(), 'edge-libtv-clone');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/libtv-creator-try.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 端口没开就用克隆 profile 自己拉起（进程挂在脚本内，脱离 shell 生命周期） */
async function ensureBrowser() {
  const alive = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
  if (alive) { log('（复用已开的克隆实例）'); return null; }
  log('（端口未开，用克隆 profile 拉起实例）');
  const child = spawn(EDGE, [`--user-data-dir=${CLONE}`, '--remote-debugging-port=9333',
    '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) return child;
  }
  throw new Error('克隆实例调试端口未就绪');
}

await ensureBrowser();
const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const errors = [];
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push((msg.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
};
await new Promise((r) => { ws.onopen = r; });
const targets = await send('Target.getTargets');
const page = (targets.targetInfos || []).find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`截图: ${f}`);
};

log('===== A. 项目页 → 点「开始创作」 =====');
await send('Page.navigate', { url: 'https://www.liblib.tv/project' }, sessionId);
await sleep(9000);
log(`项目页文案: ${(await ev(`(document.body.innerText||'').replace(/\\n{2,}/g,' / ').slice(0,400)`))}`);
await shot('study-libtv-try0.png');

const a = await ev(`(() => {
  const b = [...document.querySelectorAll('button,a,div')].find(el => {
    const t = (el.innerText || '').trim();
    return (t === '开始创作' || t === '创建新的视频项目') && el.getBoundingClientRect().width > 40;
  });
  if (!b) return null;
  b.click();
  return b.innerText.trim();
})()`);
log(`点击: ${a || '(没找到)'}`);
await sleep(7000);
const afterA = await ev(`(() => {
  const t = (document.body.innerText||'').replace(/\\n{2,}/g,' / ');
  return { url: location.href, title: document.title, len: t.length, text: t.slice(0, 600),
    hasCanvas: !!document.querySelector('canvas, .react-flow, [class*=node], [class*=canvas]'),
    dialogs: [...document.querySelectorAll('[role=dialog],[class*=modal]')].map(d => (d.innerText||'').replace(/\\n{2,}/g,' / ').slice(0,200)) };
})()`);
log(`URL: ${afterA.url} | ${afterA.title}`);
log(`有画布类元素: ${afterA.hasCanvas}`);
log(`弹窗: ${afterA.dialogs.join(' || ') || '(无)'}`);
log(`正文:\n${afterA.text}`);
await shot('study-libtv-try1.png');

log('\n===== B. 首页 → 点「新建画布创作」 =====');
if (!afterA.hasCanvas && !/canvas|editor|studio|project\//.test(afterA.url)) {
  await send('Page.navigate', { url: 'https://www.liblib.tv/' }, sessionId);
  await sleep(8000);
  const b = await ev(`(() => {
    const el = [...document.querySelectorAll('button,a,div')].find(x => /新建画布创作/.test(x.innerText || ''));
    if (!el) return null;
    el.click();
    return '新建画布创作';
  })()`);
  log(`点击: ${b || '(没找到)'}`);
  await sleep(7000);
  const afterB = await ev(`(() => {
    const t = (document.body.innerText||'').replace(/\\n{2,}/g,' / ');
    return { url: location.href, title: document.title, text: t.slice(0, 500),
      hasCanvas: !!document.querySelector('canvas, .react-flow, [class*=node]') };
  })()`);
  log(`URL: ${afterB.url} | 有画布类元素: ${afterB.hasCanvas}`);
  log(`正文:\n${afterB.text}`);
  await shot('study-libtv-try2.png');
}

log(`\n页面异常: ${errors.length ? errors.slice(0, 3).join(' | ') : '(无)'}`);
report();
process.exit(0);
