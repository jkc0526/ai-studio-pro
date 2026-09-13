/**
 * LibTV 补充勘察：Agent skills 目录（公开）+ 工作台壳页面截图
 * 产出：study-libtv-skills.png / study-libtv-project.png / study-libtv-canvas.png / study-libtv-skills.txt
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CDP = 'http://127.0.0.1:9222';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureBrowser() {
  const alive = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
  if (alive) return null;
  const child = spawn(EDGE, ['--headless', '--disable-gpu', '--disable-extensions',
    '--remote-debugging-port=9222', `--user-data-dir=${process.env.TEMP || '/tmp'}/edge-libtv-skills`,
    '--no-first-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) return child;
  }
  throw new Error('浏览器调试端口未就绪');
}

const browser = await ensureBrowser();
const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let mid = 0; const pending = new Map();
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`截图: ${f}`);
};

/* ---- 1. Agent skills 目录 ---- */
log('===== 1. LibTV Agent skills 目录 =====');
await send('Page.navigate', { url: 'https://www.liblib.tv/' }, sessionId);
await sleep(8000);
const opened = await ev(`(() => {
  const b = [...document.querySelectorAll('button,a')].find(el => /查看全部\\s*skills|全部Skill/.test(el.innerText || ''));
  if (!b) return null;
  b.click();
  return (b.innerText || '').trim();
})()`);
log(`点击: ${opened || '(没找到入口)'}`);
await sleep(3500);
const skills = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 12; };
  const panel = document.querySelector('[class*=drawer],[class*=modal],[role=dialog],[class*=panel]');
  const items = [...document.querySelectorAll('[class*=skill],[class*=Skill],[class*=card]')].filter(vis)
    .map(el => (el.innerText || '').replace(/\\s+/g, ' ').trim()).filter(x => x && x.length < 120);
  return {
    url: location.href,
    panelText: panel ? (panel.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 3000) : null,
    items: [...new Set(items)].slice(0, 80),
    body: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 2500),
  };
})()`);
log(`URL: ${skills.url}`);
log(`\n-- 面板/弹层内容 --\n${skills.panelText || '(无弹层)'}`);
log(`\n-- 卡片项去重 --\n${skills.items.join(' | ')}`);
log(`\n-- 页面正文 --\n${skills.body}`);
await shot('study-libtv-skills.png');

/* ---- 2. 工作台壳页面 ---- */
log('\n===== 2. 工作台壳页面（未登录状态能看到什么） =====');
for (const [route, file] of [['/project', 'study-libtv-project.png'], ['/canvas', 'study-libtv-canvas.png']]) {
  await send('Page.navigate', { url: `https://www.liblib.tv${route}` }, sessionId);
  await sleep(5000);
  const info = await ev(`(() => {
    const t = (el) => (el.innerText || '').replace(/\\n{2,}/g, '\\n').trim();
    const header = document.querySelector('header');
    const aside = document.querySelector('aside');
    return { url: location.href, title: document.title,
      header: header ? t(header).slice(0, 400) : null,
      aside: aside ? t(aside).slice(0, 400) : null,
      clicks: [...document.querySelectorAll('button,a')].map(el => (el.innerText || '').replace(/\\s+/g,' ').trim())
        .filter(x => x && x.length < 20).slice(0, 40),
      body: t(document.body).slice(0, 800) };
  })()`);
  log(`\n[${route}] → ${info.url} | ${info.title}`);
  log(`  顶栏: ${info.header || '(无)'}`);
  log(`  侧栏: ${info.aside || '(无)'}`);
  log(`  可点项: ${info.clicks.join(' | ')}`);
  log(`  正文: ${info.body.replace(/\n/g, ' / ')}`);
  await shot(file);
}

fs.writeFileSync(path.join(ROOT, 'study-libtv-skills.txt'), LOG.join('\n'), 'utf8');
log('\n结果已写入 study-libtv-skills.txt');
await send('Target.closeTarget', { targetId });
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(0);
