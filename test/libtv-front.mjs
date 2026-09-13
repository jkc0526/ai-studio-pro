/** 把克隆实例调到前台并打开首页，方便用户手动登录 */
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CDP = 'http://127.0.0.1:9333';
const CLONE = path.join(os.tmpdir(), 'edge-libtv-clone');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  const child = spawn(EDGE, [`--user-data-dir=${CLONE}`, '--remote-debugging-port=9333',
    '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) break;
  }
}

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
const targets = await send('Target.getTargets');
const page = (targets.targetInfos || []).find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url: 'https://www.liblib.tv/' }, sessionId);
await sleep(6000);
await send('Page.bringToFront', {}, sessionId);
const info = await send('Runtime.evaluate', {
  expression: `({ url: location.href, title: document.title, screen: [screen.width, screen.height] })`,
  returnByValue: true,
}, sessionId);
console.log(JSON.stringify(info?.result?.value));
process.exit(0);
