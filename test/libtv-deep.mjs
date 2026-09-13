/**
 * LibTV 画布深度勘察（登录态已在克隆 profile 里，直接复用）
 * 只读探查：不点任何「生成 / 发送 / 扣积分」按钮
 * 产出：study-libtv-canvas-*.png + test/libtv-deep.json + test/libtv-deep.txt
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
const report = (f = 'test/libtv-deep.txt') => { try { fs.writeFileSync(path.join(ROOT, f), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureBrowser() {
  const alive = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
  if (alive) return null;
  const child = spawn(EDGE, [`--user-data-dir=${CLONE}`, '--remote-debugging-port=9333',
    '--no-first-run', 'about:blank'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) return child;
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
  log(`  截图: ${f}`);
};
const realClick = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }, sessionId);
};
/** 找出文字/提示匹配的按钮中心点（用于真实点击） */
const findBtn = async (kw) => ev(`(() => {
  const kws = ${JSON.stringify([].concat(kw))};
  const els = [...document.querySelectorAll('button,[role=button],div[class*=btn],a')];
  for (const el of els) {
    const t = ((el.innerText || '') + ' ' + (el.title || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
    if (!kws.some(k => t.includes(k))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) continue;
    return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), t: t.slice(0, 30) });
  }
  return null;
})()`);

/* ---------- 1. 进画布 ---------- */
log('===== 1. 进入画布 =====');
await send('Page.navigate', { url: 'https://www.liblib.tv/project' }, sessionId);
await sleep(9000);
const startBtn = await findBtn(['开始创作', '创建新的视频项目']);
log(`「开始创作」位置: ${startBtn || '(未找到)'}`);
if (startBtn) { const p = JSON.parse(startBtn); await realClick(p.x, p.y); }
await sleep(12000);
const cur = await ev(`({ url: location.href, title: document.title })`);
log(`当前: ${cur.title} | ${cur.url}`);
await shot('study-libtv-c1-canvas.png');

/* ---------- 2. 顶栏 / 底部工具栏 逐个说明 ---------- */
log('\n===== 2. 顶栏与工具栏按钮（含 title/aria-label） =====');
const chrome = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 10 && r.height > 10 && s.display !== 'none' && s.visibility !== 'hidden'; };
  const info = (el) => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30),
      title: el.title || '', aria: el.getAttribute('aria-label') || '',
      cls: String(el.className || '').slice(0, 50) }; };
  const all = [...document.querySelectorAll('button,[role=button]')].filter(vis).map(info);
  const byY = (a, b) => a.y - b.y || a.x - b.x;
  return {
    top: all.filter(i => i.y < 70).sort(byY),
    left: all.filter(i => i.x < 80 && i.y >= 70).sort(byY),
    bottomBar: all.filter(i => i.y > innerHeight - 160 && i.x > innerWidth * 0.3).sort(byY),
    bottomLeft: all.filter(i => i.y > innerHeight - 110 && i.x < innerWidth * 0.3).sort(byY),
  };
})()`);
for (const [k, label] of [['top', '顶栏'], ['left', '左侧栏'], ['bottomBar', '底部工具条'], ['bottomLeft', '左下角']]) {
  log(`-- ${label} (${(chrome[k] || []).length}) --`);
  for (const b of chrome[k] || []) log(`  @${b.x},${b.y} ${b.w}x${b.h} 「${b.text}」${b.title ? ` title=${b.title}` : ''}${b.aria ? ` aria=${b.aria}` : ''}`);
}

/* ---------- 3. 添加节点菜单 ---------- */
log('\n===== 3. 添加节点菜单 =====');
const addBtn = await findBtn(['添加节点']);
log(`「添加节点」位置: ${addBtn || '(未找到)'}`);
if (addBtn) { const p = JSON.parse(addBtn); await realClick(p.x, p.y); await sleep(2500); }
await shot('study-libtv-c2-addmenu.png');
const menu = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 14; };
  const pop = [...document.querySelectorAll('[class*=popover],[class*=menu],[class*=Menu],[role=menu],[class*=dropdown],[class*=panel]')].filter(vis);
  const items = [];
  for (const p of pop) {
    const r = p.getBoundingClientRect();
    if (r.width < 80) continue;
    for (const it of p.querySelectorAll('button,li,[class*=item],[role=menuitem]')) {
      const t = (it.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length < 40) items.push(t);
    }
  }
  return { texts: [...new Set(items)].slice(0, 60),
    panelText: pop.length ? (pop[0].innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 800) : null };
})()`);
log(`菜单项: ${(menu.texts || []).join(' | ') || '(未捕获)'}`);
log(`菜单面板:\n${menu.panelText || '(无)'}`);
const menuDetail = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 14; };
  const pop = [...document.querySelectorAll('[class*=popover],[class*=menu],[role=menu],[class*=dropdown]')].filter(vis)
    .sort((a,b) => (b.innerText||'').length - (a.innerText||'').length)[0];
  if (!pop) return null;
  return [...pop.querySelectorAll('*')].filter(el => el.children.length === 0 && (el.innerText||'').trim())
    .map(el => { const r = el.getBoundingClientRect();
      return { t: el.innerText.trim().slice(0, 40), x: Math.round(r.x), y: Math.round(r.y) }; }).slice(0, 60);
})()`);
if (menuDetail) { log('-- 菜单条目明细 --'); for (const d of menuDetail) log(`  @${d.x},${d.y} 「${d.t}」`); }

/* ---------- 4. 建一个节点看卡片结构（不生成） ---------- */
log('\n===== 4. 节点卡片结构 =====');
const nodeItem = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 20 && r.height > 14; };
  const pop = [...document.querySelectorAll('[class*=popover],[class*=menu],[role=menu],[class*=dropdown]')].filter(vis)
    .sort((a,b) => (b.innerText||'').length - (a.innerText||'').length)[0];
  if (!pop) return null;
  const cand = [...pop.querySelectorAll('*')].filter(el => el.children.length <= 1 && /图片|文本|生图|素材/.test(el.innerText || ''))
    .map(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), t: el.innerText.trim().slice(0, 20) }; })
    .filter(o => o.x > 0 && o.y > 0);
  return cand[0] ? JSON.stringify(cand[0]) : null;
})()`);
log(`点节点类型: ${nodeItem || '(未找到)'}`);
if (nodeItem) { const p = JSON.parse(nodeItem); await realClick(p.x, p.y); await sleep(4000); }
await shot('study-libtv-c3-node.png');
const nodeStruct = await ev(`(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 40 && r.height > 30 && s.display !== 'none' && Number(s.opacity) > .05; };
  const box = (el) => { const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 120), cls: String(el.className || '').slice(0, 50) }; };
  const cards = [...document.querySelectorAll('[class*=node],[class*=Node]')].filter(vis).slice(0, 6).map(box);
  const panels = [...document.querySelectorAll('aside,[class*=panel],[class*=Panel],[class*=inspector]')].filter(vis).slice(0, 6).map(box);
  const inputs = [...document.querySelectorAll('textarea,input,[contenteditable=true]')].filter(vis).slice(0, 12)
    .map(el => ({ tag: el.tagName.toLowerCase(), ph: el.placeholder || '', ...box(el) }));
  return { cards, panels, inputs,
    body: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 1800) };
})()`);
log('-- 节点卡片 --');
for (const c of nodeStruct.cards) log(`  ${c.w}x${c.h} @${c.x},${c.y} ${c.cls} :: ${c.txt}`);
log('-- 面板 --');
for (const p of nodeStruct.panels) log(`  ${p.w}x${p.h} @${p.x},${p.y} ${p.cls} :: ${p.txt}`);
log('-- 输入 --');
for (const i of nodeStruct.inputs) log(`  ${i.tag}(${i.ph}) ${i.w}x${i.h} @${i.x},${i.y}`);
log(`-- 正文 --\n${nodeStruct.body}`);

/* ---------- 5. Agent 入口 ---------- */
log('\n===== 5. Agent 入口 =====');
const agentBtn = await findBtn(['^Agent$', 'Agent']);
const agentPos = agentBtn || await ev(`(() => {
  const el = [...document.querySelectorAll('button,div,a')].find(e => (e.innerText||'').trim() === 'Agent');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), t: 'Agent' });
})()`);
log(`Agent 按钮: ${agentPos || '(未找到)'}`);
if (agentPos) { const p = JSON.parse(agentPos); await realClick(p.x, p.y); await sleep(4000); }
await shot('study-libtv-c4-agent.png');
const agentPanel = await ev(`(() => {
  const t = (document.body.innerText || '').replace(/\\n{2,}/g, '\\n');
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 100; };
  const panels = [...document.querySelectorAll('aside,[class*=panel],[class*=drawer],[class*=modal]')].filter(vis).slice(0, 5)
    .map(el => { const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), txt: (el.innerText || '').replace(/\\n{2,}/g,'\\n').slice(0, 600) }; });
  return { panels, body: t.slice(0, 1500) };
})()`);
for (const p of agentPanel.panels) log(`  面板 ${p.w}x${p.h} @${p.x}: ${p.txt.replace(/\n/g, ' / ')}`);
log(`-- 正文 --\n${agentPanel.body}`);

fs.writeFileSync(path.join(ROOT, 'test/libtv-deep.json'), JSON.stringify({ chrome, menu, nodeStruct, agentPanel }, null, 2), 'utf8');
report();
log('\n完成：test/libtv-deep.txt / test/libtv-deep.json');
process.exit(0);
