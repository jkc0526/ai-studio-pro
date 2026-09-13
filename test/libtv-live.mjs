/**
 * 用「克隆的浏览器 profile」启动一个带调试端口的 Edge 实例，
 * 复用用户已有登录态去访问 LibTV 工作台（不干扰正在运行的浏览器）。
 * 产出：test/libtv-live-state.txt（登录态判断）+ study-libtv-ingame.png（首屏截图）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SRC = 'C:/Users/HUAWEI/AppData/Local/Microsoft/Edge/User Data';
const DST = path.join(os.tmpdir(), 'edge-libtv-clone');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = 'E:/work Buddy/weave-canvas';

/* 1. 克隆登录态所需的最小文件集 */
log('===== 1. 克隆 profile =====');
fs.mkdirSync(path.join(DST, 'Default', 'Network'), { recursive: true });
const FILES = [
  ['Local State', 'Local State'],
  ['Default/Preferences', 'Default/Preferences'],
  ['Default/Network/Cookies', 'Default/Network/Cookies'],
  ['Default/Network/Cookies-journal', 'Default/Network/Cookies-journal'],
  ['Default/Login Data', 'Default/Login Data'],
  ['Default/Web Data', 'Default/Web Data'],
];
for (const [from, to] of FILES) {
  const src = path.join(SRC, from);
  try {
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(DST, to)); log(`  ✓ ${from}`); }
    else log(`  - 跳过（不存在）${from}`);
  } catch (e) { log(`  ✗ ${from} → ${e.message}`); }
}
// Local Storage / Session Storage（有些站点把 token 放这里）
for (const dir of ['Default/Local Storage', 'Default/Session Storage']) {
  try {
    const src = path.join(SRC, dir);
    if (fs.existsSync(src)) { fs.cpSync(src, path.join(DST, dir), { recursive: true }); log(`  ✓ ${dir}/`); }
  } catch (e) { log(`  ✗ ${dir} → ${e.message}`); }
}

/* 2. 启动带调试端口的实例（复用克隆登录态） */
log('\n===== 2. 启动实例 =====');
const child = spawn(EDGE, [
  `--user-data-dir=${DST}`,
  '--remote-debugging-port=9333',
  '--no-first-run',
  '--disable-features=msEdgeSidebarV2',
  'about:blank',
], { detached: true, stdio: 'ignore' });
child.unref();
log(`PID=${child.pid}`);

let ver = null;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  ver = await fetch('http://127.0.0.1:9333/json/version').then((r) => r.json()).catch(() => null);
  if (ver) break;
}
if (!ver) { log('调试端口未就绪，退出'); fs.writeFileSync(path.join(ROOT, 'test/libtv-live-state.txt'), LOG.join('\n'), 'utf8'); process.exit(1); }
log(`浏览器: ${ver.Browser}`);

/* 3. 打开 LibTV 工作台，判断登录态 */
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
const targets = await send('Target.getTargets');
const page = (targets.targetInfos || []).find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;

log('\n===== 3. 打开 LibTV =====');
await send('Page.navigate', { url: 'https://www.liblib.tv/' }, sessionId);
await sleep(9000);
const home = await ev(`(() => {
  const t = (document.body.innerText || '').replace(/\\n{2,}/g, '\\n');
  return { url: location.href, title: document.title,
    loggedIn: !/注册\\/登录/.test(t.slice(0, 600)) || /退出登录|个人中心|我的/.test(t),
    head: t.slice(0, 400) };
})()`);
log(`首页: ${home.title} | ${home.url}`);
log(`疑似已登录: ${home.loggedIn}`);
log(`顶部文案:\n${home.head}`);

await send('Page.navigate', { url: 'https://www.liblib.tv/project' }, sessionId);
await sleep(8000);
const proj = await ev(`(() => {
  const t = (document.body.innerText || '').replace(/\\n{2,}/g, '\\n');
  return { url: location.href, title: document.title,
    loginModal: /登录失效|请重新登录/.test(t),
    body: t.slice(0, 700) };
})()`);
log(`\n项目页: ${proj.title} | ${proj.url}`);
log(`出现登录失效弹窗: ${proj.loginModal}`);
log(`正文:\n${proj.body}`);
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(path.join(ROOT, 'study-libtv-ingame.png'), Buffer.from(shot.data, 'base64'));
log('\n截图: study-libtv-ingame.png');

fs.writeFileSync(path.join(ROOT, 'test/libtv-live-state.txt'), LOG.join('\n'), 'utf8');
process.exit(0);
