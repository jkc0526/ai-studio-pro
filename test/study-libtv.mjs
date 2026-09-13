/**
 * LibTV 布局与功能勘察（对标参考）
 * 自管无头浏览器（detached），产出：
 *   study-libtv-home.png    首页整屏截图
 *   study-libtv-full.png    首页整页截图（captureBeyondViewport）
 *   study-libtv2.json       结构化布局数据
 *   study-libtv-report.txt  可读报告
 * 运行：node test/study-libtv.mjs
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
const EDGE = process.env.EDGE_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const URL_TARGET = process.env.TARGET || 'https://www.liblib.tv/';

const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureBrowser() {
  const alive = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
  if (alive) return null;
  const child = spawn(EDGE, ['--headless', '--disable-gpu', '--disable-extensions',
    '--remote-debugging-port=9222', `--user-data-dir=${process.env.TEMP || '/tmp'}/edge-libtv-study`,
    '--no-first-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) return child;
  }
  throw new Error('浏览器调试端口未就绪');
}

const ANALYSIS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 24 && r.height > 16 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05; };
  const box = (el) => { const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 70),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 120) }; };
  const t = (el) => (el.innerText || el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
  const sidebar = [...document.querySelectorAll('aside, [class*=sidebar], [class*=side-bar]')].filter(vis).map(box);
  const headers = [...document.querySelectorAll('header')].filter(vis).map(box);
  return {
    title: document.title,
    url: location.href,
    viewport: { w: innerWidth, h: innerHeight, scrollH: document.body.scrollHeight },
    sidebar,
    headers,
    /* 侧栏/顶栏可点项：产品的信息架构主要看这里 */
    navClicks: [...document.querySelectorAll('aside button, aside a, header button, header a, nav button, nav a')]
      .filter(vis).map(t).filter(Boolean).slice(0, 60),
    /* 全部去重链接：用来发现工作台路由 */
    links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))].slice(0, 60),
    /* 章节标题 */
    headings: [...document.querySelectorAll('h1,h2,h3,h4,[class*=title]')].filter(vis).map(t).filter(x => x && x.length < 40).slice(0, 60),
    /* 卡片类区块（模板/模型/Skill） */
    cards: [...document.querySelectorAll('[class*=card], [class*=Card], [class*=item]')].filter(vis)
      .map(t).filter(x => x && x.length < 30).slice(0, 80),
    buttons: [...document.querySelectorAll('button')].filter(vis).map(t).filter(x => x && x.length < 24).slice(0, 60),
    inputs: [...document.querySelectorAll('input,textarea,[contenteditable=true]')].filter(vis).slice(0, 15)
      .map(el => ({ tag: el.tagName.toLowerCase(), ph: el.placeholder || '', ...box(el) })),
    /* 主内容区大小 + 文案，判断是不是营销页 */
    main: (() => { const m = document.querySelector('main'); if (!m) return null;
      return { ...box(m), text: (m.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 2500) }; })(),
    bodyText: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 3000),
    hasLogin: /登录|注册|login/i.test((document.body.innerText || '').slice(0, 4000)),
  };
})()`;

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
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);

const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f, beyond = false) => {
  const s = await send('Page.captureScreenshot', beyond ? { format: 'png', captureBeyondViewport: true } : { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`截图: ${f}`);
};

log(`===== 打开 ${URL_TARGET} =====`);
await send('Page.navigate', { url: URL_TARGET }, sessionId);
await sleep(9000);

const data = await ev(ANALYSIS);
fs.writeFileSync(path.join(ROOT, 'study-libtv2.json'), JSON.stringify(data, null, 2), 'utf8');
log(`标题: ${data.title}`);
log(`视口: ${data.viewport.w}x${data.viewport.h}，整页高 ${data.viewport.scrollH}`);
log(`\n-- 顶栏 (${data.headers.length}) --`);
for (const h of data.headers.slice(0, 4)) log(`  ${h.w}x${h.h} @${h.x},${h.y} :: ${h.txt}`);
log(`\n-- 侧栏 (${data.sidebar.length}) --`);
for (const s of data.sidebar.slice(0, 3)) log(`  ${s.w}x${s.h} @${s.x},${s.y} :: ${s.txt || '(空)'}`);
log(`\n-- 顶栏/侧栏可点项 --\n  ${data.navClicks.join(' | ')}`);
log(`\n-- 章节标题 --\n  ${data.headings.slice(0, 30).join(' | ')}`);
log(`\n-- 卡片项（模板/模型/Skill） --\n  ${data.cards.slice(0, 50).join(' | ')}`);
log(`\n-- 按钮 --\n  ${data.buttons.slice(0, 40).join(' | ')}`);
log(`\n-- 去重链接 --\n  ${data.links.join('\n  ')}`);
log(`\n-- 是否出现登录入口: ${data.hasLogin} --`);
log(`\n-- 正文摘要 --\n${(data.main?.text || data.bodyText || '').split('\n').slice(0, 40).join('\n')}`);

await shot('study-libtv-home.png');
await shot('study-libtv-full.png', true);

/* 尝试进入工作台：优先点「新建画布创作」，否则试常见路由 */
log('\n===== 尝试进入工作台 =====');
const clicked = await ev(`(() => {
  const btn = [...document.querySelectorAll('button,a')].find(el => /新建画布创作|开始创作|立即创作|进入工作台/.test(el.innerText || ''));
  if (!btn) return null;
  btn.click();
  return (btn.innerText || '').trim().slice(0, 20);
})()`);
log(`点击入口: ${clicked || '(没找到创作入口)'}`);
await sleep(7000);
const after = await ev(`({ url: location.href, title: document.title, text: (document.body.innerText || '').replace(/\\n{2,}/g,'\\n').slice(0, 1200) })`);
log(`跳转后: ${after?.title} | ${after?.url}`);
log(`正文:\n${(after?.text || '').split('\n').slice(0, 30).join('\n')}`);
await shot('study-libtv-workspace.png');

const report = LOG.join('\n');
fs.writeFileSync(path.join(ROOT, 'study-libtv-report.txt'), report, 'utf8');
log('\n报告已写入 study-libtv-report.txt');
await send('Target.closeTarget', { targetId });
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(0);
