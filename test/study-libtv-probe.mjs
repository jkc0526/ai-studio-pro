/**
 * LibTV 工作台入口探测：点「新建画布创作」看是否要求登录 + 试常见路由
 * 产出：study-libtv-login.png / study-libtv-routes.txt
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
    '--remote-debugging-port=9222', `--user-data-dir=${process.env.TEMP || '/tmp'}/edge-libtv-probe`,
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

await send('Page.navigate', { url: 'https://www.liblib.tv/' }, sessionId);
await sleep(8000);

log('===== 1. 点「新建画布创作」 =====');
await ev(`(() => { const b=[...document.querySelectorAll('button,a')].find(el=>/新建画布创作/.test(el.innerText||'')); b?.click(); return !!b; })()`);
await sleep(3500);
const s1 = await ev(`(() => {
  const modal = document.querySelector('[class*=modal],[class*=Modal],[role=dialog]');
  return { url: location.href,
    modal: modal ? (modal.innerText || '').replace(/\\n{2,}/g,'\\n').slice(0, 500) : null,
    hasCanvas: !!document.querySelector('[class*=react-flow],[class*=canvas],[class*=workspace]'),
    text: (document.body.innerText || '').replace(/\\n{2,}/g,'\\n').slice(0, 700) };
})()`);
log(`URL: ${s1.url}`);
log(`出现弹窗: ${s1.modal ? '是' : '否'}\n${s1.modal || ''}`);
log(`画布元素: ${s1.hasCanvas}`);
log(`页面正文:\n${s1.text}`);
await shot('study-libtv-login.png');

log('\n===== 2. 探测工作台路由 =====');
const routes = ['/canvas', '/create', '/studio', '/workspace', '/project', '/projects', '/app', '/agent', '/home', '/editor'];
for (const r of routes) {
  try {
    await send('Page.navigate', { url: `https://www.liblib.tv${r}` }, sessionId);
    await sleep(3500);
    const info = await ev(`({ url: location.href, title: document.title, body: (document.body.innerText||'').replace(/\\n{2,}/g,'\\n').slice(0,220) })`);
    log(`\n[${r}] → ${info.url}`);
    log(`  标题: ${info.title}`);
    log(`  正文: ${info.body.replace(/\n/g, ' / ')}`);
  } catch (e) { log(`[${r}] 失败: ${e.message}`); }
}

fs.writeFileSync(path.join(ROOT, 'study-libtv-routes.txt'), LOG.join('\n'), 'utf8');
log('\n结果已写入 study-libtv-routes.txt');
await send('Target.closeTarget', { targetId });
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(0);
