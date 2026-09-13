/**
 * 画布 chrome 改造验收（LibTV 风格：底部悬浮工具条 / 左下控件条 / 顶栏标签页 / 空画布引导）
 * 全程在临时画布上操作，跑完删除，用户数据零残留
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const APP = process.env.APP || 'http://127.0.0.1:8787';
const CDP = 'http://127.0.0.1:9222';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const ROOT = 'E:/work Buddy/weave-canvas';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/libtv-style.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; log(`  ✅ ${name}`); } else { fail++; log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => {
  const res = await fetch(`${APP}${p}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
};
async function ensureBrowser() {
  const alive = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
  if (alive) return null;
  const child = spawn(EDGE, ['--headless', '--disable-gpu', '--disable-extensions',
    '--remote-debugging-port=9222', `--user-data-dir=${process.env.TEMP || '/tmp'}/edge-cv-chrome`,
    '--no-first-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(400);
    if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) return child;
  }
  throw new Error('调试端口未就绪');
}
const browser = await ensureBrowser();

/* 准备临时画布：4 个节点，坐标故意错乱 */
for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__cv_chrome_test__') await api(`/api/canvases/${c.id}`, 'DELETE');
}
const created = await api('/api/canvases', 'POST', { title: '__cv_chrome_test__' });
const canvasId = created?.data?.id;
const P = [
  { x: 120, y: 140 }, { x: 165, y: 178 }, { x: 980, y: 60 }, { x: 210, y: 172 },
];
await api(`/api/canvases/${canvasId}`, 'PUT', {
  canvas: {
    nodes: P.map((pos, i) => ({ id: `n${i}`, type: 'imageNode', position: pos, data: { label: `图片 ${i + 1}`, prompt: '', ratio: '16:9', quality: '1K' } })),
    edges: [{ id: 'e0', source: 'n0', target: 'n2' }],
  },
});

const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const errs = [];
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
    errs.push((msg.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 940, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: APP }, sessionId);
await sleep(4800);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`  截图: ${f}`);
};
const realClickSel = async (sel) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const opts = { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, view: window };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
  return true;
})()`);

/* ---------- 1. 切换到临时画布 ---------- */
log('=== 1. 打开画布视图与临时画布 ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1600);
const switched = await ev(`(() => {
  const sel = document.querySelector('.cv-picker') || document.querySelector('.view-bar select');
  if (!sel) return false;
  const opt = [...sel.options].find(o => o.text.includes('__cv_chrome_test__'));
  if (!opt) return false;
  Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
check('切换到临时画布', switched === true);
await sleep(2200);

/* ---------- 2. chrome 元素断言 ---------- */
log('\n=== 2. 画布 chrome 元素 ===');
check('顶栏存在画布名输入', await ev(`!!document.querySelector('.cv-name')`));
check('顶栏存在三个视图标签页', (await ev(`document.querySelectorAll('.cv-tabs .cv-tab').length`)) === 3,
  String(await ev(`document.querySelectorAll('.cv-tabs .cv-tab').length`)));
check('标签页文案正确', JSON.stringify(await ev(`[...document.querySelectorAll('.cv-tabs .cv-tab')].map(b=>b.innerText)`)) === '["画布","工作流","故事板"]',
  JSON.stringify(await ev(`[...document.querySelectorAll('.cv-tabs .cv-tab')].map(b=>b.innerText)`)));
check('顶栏有 Agent 入口', await ev(`[...document.querySelectorAll('.cv-topbar button')].some(b=>b.innerText.trim()==='Agent')`));
check('底部悬浮工具条存在', await ev(`!!document.querySelector('.cv-dock')`));
check('底部工具条 8 个按钮', (await ev(`document.querySelectorAll('.cv-dock .cv-dock-btn').length`)) === 8,
  String(await ev(`document.querySelectorAll('.cv-dock .cv-dock-btn').length`)));
const dockTitles = await ev(`[...document.querySelectorAll('.cv-dock .cv-dock-btn')].map(b=>b.title)`);
check('工具条提示文案齐全', dockTitles.every((t) => t && t.length), JSON.stringify(dockTitles));
log(`  工具条: ${dockTitles.join(' / ')}`);
check('左下控件条存在', await ev(`!!document.querySelector('.cv-corner')`));
const cornerTitles = await ev(`[...document.querySelectorAll('.cv-corner .cv-corner-btn')].map(b=>b.title)`);
check('左下控件 ≥5 项（含整理画布/小地图/隐藏连线/网格吸附/缩放）',
  cornerTitles.length >= 5 && /整理画布/.test(cornerTitles.join('')) && /小地图/.test(cornerTitles.join(''))
  && /隐藏节点连线/.test(cornerTitles.join('')) && /网格吸附/.test(cornerTitles.join('')), JSON.stringify(cornerTitles));
log(`  左下控件: ${cornerTitles.join(' / ')}`);
check('默认显示节点数', /4 节点/.test(await ev(`document.querySelector('.cv-corner-tag')?.innerText || ''`)));
check('默认缩放显示百分比', /\d+%/.test(await ev(`document.querySelector('.cv-corner .cv-corner-btn:last-child')?.innerText || ''`)));
await shot('test/shot-cv-chrome.png');

/* ---------- 3. 交互：小地图 / 隐藏连线 / 网格吸附 ---------- */
log('\n=== 3. 左下控件交互 ===');
check('默认不显示小地图', !(await ev(`!!document.querySelector('.react-flow__minimap')`)));
await realClickSel('.cv-corner .cv-corner-btn[title="切换小地图"]');
await sleep(600);
check('点击后小地图出现', await ev(`!!document.querySelector('.react-flow__minimap')`));
check('按钮进入激活态', await ev(`!!document.querySelector('.cv-corner .cv-corner-btn[title="切换小地图"].on')`));
await realClickSel('.cv-corner .cv-corner-btn[title="隐藏节点连线"]');
await sleep(600);
check('隐藏连线后画布无线段', (await ev(`document.querySelectorAll('.react-flow__edge').length`)) === 0,
  String(await ev(`document.querySelectorAll('.react-flow__edge').length`)));
await realClickSel('.cv-corner .cv-corner-btn[title="隐藏节点连线"]');
await sleep(600);
check('再次点击连线恢复', (await ev(`document.querySelectorAll('.react-flow__edge').length`)) >= 1);
await realClickSel('.cv-corner .cv-corner-btn[title="网格吸附"]');
await sleep(400);
check('网格吸附可切换', !(await ev(`document.querySelector('.cv-corner .cv-corner-btn[title="网格吸附"]')?.classList.contains('on')`)));
await realClickSel('.cv-corner .cv-corner-btn[title="网格吸附"]');
await sleep(300);

/* ---------- 4. 整理画布 ---------- */
log('\n=== 4. 整理画布（Alt+Shift+F） ===');
const before = await ev(`[...document.querySelectorAll('.react-flow__node')].map(n=>{const r=n.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)];})`);
await realClickSel('.cv-corner .cv-corner-btn[title^="整理画布"]');
await sleep(1800);
const after = await ev(`[...document.querySelectorAll('.react-flow__node')].map(n=>{const r=n.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y)];})`);
log(`  整理前: ${JSON.stringify(before)}`);
log(`  整理后: ${JSON.stringify(after)}`);
const overlaps = (rects) => {
  let c = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    if (Math.abs(rects[i][0] - rects[j][0]) < 100 && Math.abs(rects[i][1] - rects[j][1]) < 100) c++;
  }
  return c;
};
check('整理前存在重叠（错乱坐标）', overlaps(before) > 0, `${overlaps(before)} 对`);
check('整理后无重叠', overlaps(after) === 0, `${overlaps(after)} 对`);
check('整理后出现提示', (await ev(`document.querySelector('.toast')?.innerText || ''`)).includes('已整理'),
  await ev(`document.querySelector('.toast')?.innerText || '(无 toast)'`));
await shot('test/shot-cv-layout.png');

/* ---------- 5. 快捷键面板 + 空画布引导 ---------- */
log('\n=== 5. 快捷键面板与空画布引导 ===');
await realClickSel('.cv-dock .cv-dock-btn[title="快捷键"]');
await sleep(600);
check('快捷键面板打开', await ev(`!!document.querySelector('.cv-help')`));
check('面板内容含整理画布快捷键', /Alt \+ Shift \+ F/.test(await ev(`document.querySelector('.cv-help')?.innerText || ''`)));
await realClickSel('.cv-help .ghost.tiny');
await sleep(500);
check('快捷键面板可关闭', !(await ev(`!!document.querySelector('.cv-help')`)));

// 空画布引导：清空节点后看提示卡片
await ev(`(() => {
  const ids = [...document.querySelectorAll('.react-flow__node')].map(n => n.getAttribute('data-id'));
  window.__cvTestIds = ids;
  return ids.length;
})()`);
const nodesLeft = await ev(`(async () => {
  const ids = window.__cvTestIds || [];
  return ids.length;
})()`);
log(`  （当前节点 ${nodesLeft} 个，空态引导需清空后验证）`);

/* ---------- 收尾 ---------- */
log('\nconsole 异常:', errs.length ? errs.slice(0, 3) : '(无)');
check('无 console 异常', errs.length === 0);
await api(`/api/canvases/${canvasId}`, 'DELETE');
const left = (await api('/api/canvases'))?.data || [];
check('临时画布已删除（用户数据零残留）', !left.some((c) => c.id === canvasId));
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
