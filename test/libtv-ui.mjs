/**
 * LibTV 画布 UI 结构精抓：顶栏 / 底部悬浮工具条 / 左下控件 / 添加节点菜单 / 节点卡片 + 参数面板
 * 只读：不点任何生成、发送、扣积分按钮
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
const report = (f = 'test/libtv-ui.txt') => { try { fs.writeFileSync(path.join(ROOT, f), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureBrowser() {
  const alive = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
  if (alive) return;
  const child = spawn(EDGE, [`--user-data-dir=${CLONE}`, '--remote-debugging-port=9333',
    '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) return;
  }
  throw new Error('实例调试端口未就绪');
}

await ensureBrowser();
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
const { targetInfos = [] } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`  截图: ${f}`);
};
const realClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
};
const posOf = async (kw) => ev(`(() => {
  const kws = ${JSON.stringify([].concat(kw))};
  for (const el of document.querySelectorAll('button,[role=button],a,div')) {
    const t = ((el.innerText||'') + ' ' + (el.title||'') + ' ' + (el.getAttribute('aria-label')||'')).trim();
    if (!kws.some(k => t.includes(k))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), t: t.slice(0, 30) });
  }
  return null;
})()`);

/* ---------- 1. 进画布：点第一个项目卡 ---------- */
log('===== 1. 打开一个已有项目（画布） =====');
await send('Page.navigate', { url: 'https://www.liblib.tv/project' }, sessionId);
await sleep(9000);
const opened = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 100 && r.height > 80; };
  const cards = [...document.querySelectorAll('div,li,a')].filter(el => vis(el) && /未命名|项目|\\d{4}-\\d{2}-\\d{2}/.test(el.innerText || '') && el.innerText.length < 60);
  const target = cards.sort((a,b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
  if (!target) return null;
  const r = target.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + 40), y: Math.round(r.y + 60), t: target.innerText.replace(/\\s+/g,' ').slice(0,30) });
})()`);
log(`项目卡: ${opened || '(未找到)'}`);
if (opened) { const p = JSON.parse(opened); await realClick(p.x, p.y); }
await sleep(12000);
const cur = await ev(`({ url: location.href, title: document.title })`);
log(`当前: ${cur.title} | ${cur.url}`);
await shot('study-libtv-u1-canvas.png');

/* ---------- 2. 画布 chrome 全景（含 title/aria） ---------- */
log('\n===== 2. 画布 chrome 按钮明细 =====');
const chrome = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 10 && r.height > 10 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const info = (el) => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 26),
      title: el.title || '', aria: el.getAttribute('aria-label') || '' }; };
  const all = [...document.querySelectorAll('button,[role=button]')].filter(vis).map(info);
  const srt = (a, b) => a.y - b.y || a.x - b.x;
  return {
    topLeft: all.filter(i => i.y < 70 && i.x < innerWidth * .6).sort(srt),
    topRight: all.filter(i => i.y < 70 && i.x >= innerWidth * .6).sort(srt),
    bottomCenter: all.filter(i => i.y > innerHeight - 170 && i.x > innerWidth * .3 && i.x < innerWidth * .72).sort(srt),
    bottomLeft: all.filter(i => i.y > innerHeight - 120 && i.x < innerWidth * .3).sort(srt),
  };
})()`);
for (const [k, label] of [['topLeft', '顶栏左'], ['topRight', '顶栏右'], ['bottomCenter', '底部悬浮工具条'], ['bottomLeft', '左下控件']]) {
  log(`-- ${label} (${(chrome[k] || []).length}) --`);
  for (const b of chrome[k] || []) log(`  @${b.x},${b.y} ${b.w}x${b.h} 「${b.text}」${b.title ? ` title=${b.title}` : ''}${b.aria ? ` aria=${b.aria}` : ''}`);
}
fs.writeFileSync(path.join(ROOT, 'test/libtv-ui.json'), JSON.stringify(chrome, null, 2), 'utf8');

/* ---------- 3. 添加节点菜单 ---------- */
log('\n===== 3. 添加节点菜单 =====');
const addPos = await posOf(['添加节点']);
log(`按钮: ${addPos || '(未找到)'}`);
if (addPos) { const p = JSON.parse(addPos); await realClick(p.x, p.y); await sleep(2500); }
await shot('study-libtv-u2-addmenu.png');
const menu = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 14; };
  const pops = [...document.querySelectorAll('[class*=popover],[class*=menu],[role=menu],[class*=dropdown],[class*=Panel]')].filter(vis)
    .filter(el => el.getBoundingClientRect().width < innerWidth * .8);
  const out = [];
  for (const p of pops) {
    for (const el of p.querySelectorAll('*')) {
      if (el.children.length > 1) continue;
      const t = (el.innerText || '').trim();
      if (!t || t.length > 30) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8) continue;
      out.push({ t, x: Math.round(r.x), y: Math.round(r.y) });
    }
  }
  return out.slice(0, 70);
})()`);
log('-- 菜单条目 --');
for (const m of menu || []) log(`  @${m.x},${m.y} 「${m.t}」`);

/* ---------- 4. 建节点看卡片 + 参数面板 ---------- */
log('\n===== 4. 节点卡片与参数面板 =====');
const pick = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 14; };
  const pops = [...document.querySelectorAll('[class*=popover],[class*=menu],[role=menu],[class*=dropdown]')].filter(vis);
  for (const p of pops) {
    for (const el of p.querySelectorAll('*')) {
      if (el.children.length > 1) continue;
      const t = (el.innerText || '').trim();
      if (!/图片/.test(t) || t.length > 12) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8) continue;
      return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), t });
    }
  }
  return null;
})()`);
log(`选节点类型: ${pick || '(未找到图片项)'}`);
if (pick) { const p = JSON.parse(pick); await realClick(p.x, p.y); await sleep(5000); }
await shot('study-libtv-u3-node.png');
const nodeStruct = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 40 && r.height > 24 && s.display !== 'none' && Number(s.opacity) > .05; };
  const box = (el) => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      cls: String(el.className || '').slice(0, 46),
      txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 200) }; };
  return {
    nodes: [...document.querySelectorAll('[class*=node],[class*=Node]')].filter(vis).slice(0, 8).map(box),
    panels: [...document.querySelectorAll('aside,[class*=panel],[class*=Panel],[class*=inspector],[class*=Inspector]')].filter(vis).slice(0, 8).map(box),
    inputs: [...document.querySelectorAll('textarea,input,[contenteditable=true]')].filter(vis).slice(0, 12)
      .map(el => ({ tag: el.tagName.toLowerCase(), ph: (el.placeholder || '').slice(0, 60), ...box(el) })),
    body: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 1600),
  };
})()`);
log('-- 节点 --');
for (const n of nodeStruct.nodes) log(`  ${n.w}x${n.h} @${n.x},${n.y} :: ${n.txt}`);
log('-- 面板 --');
for (const p of nodeStruct.panels) log(`  ${p.w}x${p.h} @${p.x},${p.y} :: ${p.txt}`);
log('-- 输入框 --');
for (const i of nodeStruct.inputs) log(`  ${i.tag}(ph=${i.ph}) ${i.w}x${i.h} @${i.x},${i.y} :: ${i.txt}`);
log(`-- 正文 --\n${nodeStruct.body}`);
fs.writeFileSync(path.join(ROOT, 'test/libtv-ui-node.json'), JSON.stringify(nodeStruct, null, 2), 'utf8');

report();
log('\n完成：test/libtv-ui.txt / libtv-ui.json / libtv-ui-node.json');
process.exit(0);
