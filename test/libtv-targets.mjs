/** 诊断：列出克隆实例里所有页面目标，找出真正的 LibTV 页面 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const CDP = 'http://127.0.0.1:9333';
const CLONE = path.join(os.tmpdir(), 'edge-libtv-clone');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = 'E:/work Buddy/weave-canvas/test/libtv-targets.txt';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = [];

if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  L.push('端口未开 → 拉起实例');
  const child = spawn(EDGE, [`--user-data-dir=${CLONE}`, '--remote-debugging-port=9333', '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) { await sleep(500); if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) break; }
}
const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
L.push(`浏览器: ${ver.Browser}`);

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

const { targetInfos = [] } = await send('Target.getTargets');
const pages = targetInfos.filter((t) => t.type === 'page');
L.push(`\n页面目标共 ${pages.length} 个：`);
for (const p of pages) {
  L.push(`  [${p.targetId.slice(0, 8)}] ${p.title || '(无标题)'} — ${p.url}`);
}
/* 逐个 attach 看正文长度，判断哪个是真实页面 */
for (const p of pages) {
  try {
    const { sessionId } = await send('Target.attachToTarget', { targetId: p.targetId, flatten: true });
    const r = await send('Runtime.evaluate', {
      expression: `({ len: (document.body?.innerText||'').trim().length, url: location.href, title: document.title })`,
      returnByValue: true,
    }, sessionId);
    const v = r?.result?.value || {};
    L.push(`  → ${p.targetId.slice(0, 8)} 正文 ${v.len} 字 | ${v.title} | ${v.url}`);
    await send('Target.detachFromTarget', { sessionId });
  } catch (e) { L.push(`  → ${p.targetId.slice(0, 8)} 读取失败: ${e.message}`); }
}
fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(L.join('\n'));
process.exit(0);
