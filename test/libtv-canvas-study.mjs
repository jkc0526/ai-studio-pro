/**
 * 登录后勘察 LibTV 画布工作台：布局结构 + 截图（只读探查，绝不点生成/发送）
 * 产出：study-libtv-canvas-*.png + test/libtv-canvas-struct.json + test/libtv-canvas.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const CDP = 'http://127.0.0.1:9333';
const ROOT = 'E:/work Buddy/weave-canvas';
const CLONE = path.join(os.tmpdir(), 'edge-libtv-clone');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const WAIT_LOGIN_MS = Number(process.env.WAIT_LOGIN_MS || 110000);
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = (f = 'test/libtv-canvas.txt') => { try { fs.writeFileSync(path.join(ROOT, f), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
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
const shot = async (f, beyond = false) => {
  const s = await send('Page.captureScreenshot', beyond ? { format: 'png', captureBeyondViewport: true } : { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`截图: ${f}`);
};

/* ---- 0. 打开页面并置于前台（必须在同一个进程里，否则窗口会被回收） ---- */
await send('Page.navigate', { url: 'https://www.liblib.tv/' }, sessionId);
await sleep(6000);
await send('Page.bringToFront', {}, sessionId);
log('已打开 https://www.liblib.tv/ 并置于前台，等待登录（请在该窗口扫码）');

/* ---- 1. 等登录 ---- */
const isLoggedIn = () => ev(`(() => {
  const t = (document.body.innerText || '');
  /* 页面还没渲染完（骨架屏）不能算已登录——之前这里误判过一次 */
  if (t.trim().length < 200) return { ready: false, login: true, head: '(页面未就绪)' };
  const headerLogin = [...document.querySelectorAll('header button, header a')]
    .some(el => /注册|登录/.test((el.innerText || '').trim()));
  const modal = document.querySelector('[role=dialog],[class*=modal],[class*=Modal]');
  const modalText = modal ? (modal.innerText || '') : '';
  const loginModal = /微信一键登录|手机号登录|团队邮箱登录|登录失效/.test(modalText);
  return { ready: true, login: headerLogin || loginModal, head: t.replace(/\\n{2,}/g,' / ').slice(0, 160) };
})()`);

log('\n===== 1. 等待登录 =====');
const t0 = Date.now();
let logged = false;
let tick = 0;
while (Date.now() - t0 < WAIT_LOGIN_MS) {
  const st = await isLoggedIn();
  if (st.ready && !st.login) { logged = true; log(`检测到已登录（耗时 ${Math.round((Date.now() - t0) / 1000)}s）`); log(`顶部: ${st.head}`); break; }
  if (++tick % 6 === 0) { log(`  …等待中 ${Math.round((Date.now() - t0) / 1000)}s（${st.head}）`); report(); }
  await sleep(5000);
}
if (!logged) {
  log(`等待 ${WAIT_LOGIN_MS / 1000}s 仍未检测到登录，当前顶部: ${(await isLoggedIn()).head}`);
  report();
  process.exit(0);
}

/* ---- 2. 进画布 ---- */
log('\n===== 2. 打开工作台 =====');
await send('Page.navigate', { url: 'https://www.liblib.tv/project' }, sessionId);
await sleep(9000);
await shot('study-libtv-canvas-list.png');

const clicked = await ev(`(() => {
  const b = [...document.querySelectorAll('button,a,div')].find(el => {
    const t = (el.innerText || '').trim();
    return (t === '开始创作' || t === '创建新的视频项目') && el.getBoundingClientRect().width > 40;
  });
  if (!b) return null; b.click(); return b.innerText.trim();
})()`);
log(`点击「${clicked || '(未找到)'}」`);
await sleep(12000);
const cur = await ev(`({ url: location.href, title: document.title })`);
log(`当前页面: ${cur.title} | ${cur.url}`);
await shot('study-libtv-canvas-editor.png');

/* ---- 3. 结构化抓取工作台布局（只读） ---- */
const STRUCT = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 20 && r.height > 16 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .05; };
  const box = (el) => { const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 90) }; };
  const t = (el) => (el.innerText || el.title || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
  return {
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight },
    /* 画布类元素 */
    canvases: [...document.querySelectorAll('canvas')].map(box),
    nodes: [...document.querySelectorAll('[class*=node],[class*=Node]')].filter(vis).slice(0, 20).map(box),
    /* 工具栏 / 面板 / 时间轴 */
    toolbars: [...document.querySelectorAll('[class*=toolbar],[class*=Toolbar],[class*=tool-bar]')].filter(vis).slice(0, 8).map(box),
    panels: [...document.querySelectorAll('aside,[class*=panel],[class*=Panel],[class*=drawer],[class*=inspector]')].filter(vis).slice(0, 12).map(box),
    timeline: [...document.querySelectorAll('[class*=timeline],[class*=Timeline],[class*=track]')].filter(vis).slice(0, 8).map(box),
    /* 可点项与输入 */
    buttons: [...document.querySelectorAll('button')].filter(vis).map(t).filter(x => x && x.length < 22).slice(0, 70),
    inputs: [...document.querySelectorAll('input,textarea,[contenteditable=true],[class*=input]')].filter(vis).slice(0, 15)
      .map(el => ({ tag: el.tagName.toLowerCase(), ph: el.placeholder || '', ...box(el) })),
    bodyText: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 2500),
  };
})()`;

const st = await ev(STRUCT);
fs.writeFileSync(path.join(ROOT, 'test/libtv-canvas-struct.json'), JSON.stringify(st, null, 2), 'utf8');
log('\n-- 画布 canvas 元素 --');
for (const c of st.canvases || []) log(`  ${c.w}x${c.h} @${c.x},${c.y}`);
log(`-- 节点类元素 (${(st.nodes || []).length}) --`);
for (const n of (st.nodes || []).slice(0, 10)) log(`  ${n.w}x${n.h} @${n.x},${n.y} :: ${n.txt}`);
log('-- 工具栏 --');
for (const b of st.toolbars || []) log(`  ${b.w}x${b.h} @${b.x},${b.y} :: ${b.txt}`);
log('-- 面板 --');
for (const p of st.panels || []) log(`  ${p.w}x${p.h} @${p.x},${p.y} :: ${p.txt}`);
log('-- 时间轴 --');
for (const tl of st.timeline || []) log(`  ${tl.w}x${tl.h} @${tl.x},${tl.y} :: ${tl.txt}`);
log(`-- 按钮 --\n  ${(st.buttons || []).join(' | ')}`);
log('-- 输入框 --');
for (const i of st.inputs || []) log(`  ${i.tag}(${i.ph}) ${i.w}x${i.h} @${i.x},${i.y}`);
log(`\n-- 正文 --\n${(st.bodyText || '').split('\n').slice(0, 60).join('\n')}`);

report();
log('\n结果已写入 test/libtv-canvas.txt / test/libtv-canvas-struct.json');
process.exit(0);
