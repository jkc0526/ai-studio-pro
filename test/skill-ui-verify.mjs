/** Skill 套路库 UI 验收（只读 + 套用，不触发任何生成） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const APP = 'http://127.0.0.1:8787';
const CDP = 'http://127.0.0.1:9222';
const ROOT = 'E:/work Buddy/weave-canvas';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/skill-ui.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
if (!(await fetch(`${CDP}/json/version`).then(() => true).catch(() => false))) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-skill-ui`, '--no-first-run'], { detached: true, stdio: 'ignore' });
  browser.unref();
  for (let i = 0; i < 40; i++) { await sleep(400); if (await fetch(`${CDP}/json/version`).then(() => true).catch(() => false)) break; }
}
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
  } else if (msg.method === 'Runtime.exceptionThrown') errs.push((msg.params.exceptionDetails?.exception?.description || '').slice(0, 160));
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: APP }, sessionId);
await sleep(4800);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`  截图: ${f}`);
};

log('=== 1. 打开 Agent 应用 ===');
await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('Agent 应用'))?.click()`);
await sleep(2500);
check('标题为 Agent 应用', (await ev(`document.querySelector('.crumb')?.innerText`)) === 'Agent 应用');
// 页面默认会回放最近一次运行，先在运行台上点「新建任务」回到启动台
const hadRun = await ev(`!!document.querySelector('.ag-console')`);
if (hadRun) {
  await ev(`[...document.querySelectorAll('.cv-topbar button, .ag-console button')].find(b=>b.innerText.includes('新建任务'))?.click()`);
  await sleep(1200);
}
log(`  （进入时${hadRun ? '有历史运行，已点「新建任务」' : '无历史运行'}）`);
check('启动台上出现 Skill 区块', await ev(`!!document.querySelector('.ag-skills')`));
check('标题行有「Skill 全开，故事走起」', /Skill 全开/.test(await ev(`document.querySelector('.ag-skills-head b')?.innerText || ''`)),
  await ev(`document.querySelector('.ag-skills-head b')?.innerText || '(无)'`));
const tabs = await ev(`[...document.querySelectorAll('.ag-skill-tab')].map(b=>b.innerText)`);
check('类型 tab：全部 + 视频 + 图片', ['全部', '视频', '图片'].every((t) => tabs.includes(t)) && tabs.length === 3, JSON.stringify(tabs));
const cats = await ev(`[...document.querySelectorAll('.ag-cat')].map(b=>b.innerText)`);
check('分类 chips ≥ 7（全部 + 题材）', cats.length >= 7 && cats.includes('全部'), JSON.stringify(cats));
log(`  分类: ${cats.join(' / ')}`);
check('Skill 卡片 8 张', (await ev(`document.querySelectorAll('.ag-skill').length`)) === 8,
  String(await ev(`document.querySelectorAll('.ag-skill').length`)));
check('卡片显示斜杠命令', (await ev(`document.querySelectorAll('.ag-skill code').length`)) === 8);
check('卡片显示作者与使用量', /次使用/.test(await ev(`document.querySelector('.ag-skill-meta')?.innerText || ''`)),
  await ev(`document.querySelector('.ag-skill-meta')?.innerText || ''`));
await shot('test/shot-skill-lib.png');

log('\n=== 2. 类型/分类筛选 ===');
await ev(`[...document.querySelectorAll('.ag-skill-tab')].find(b=>b.innerText==='图片')?.click()`);
await sleep(700);
check('筛图片后只剩图片类', (await ev(`document.querySelectorAll('.ag-skill').length`)) === 1,
  String(await ev(`document.querySelectorAll('.ag-skill').length`)));
check('图片类卡片带「图片」标签', /图片/.test(await ev(`document.querySelector('.ag-skill-kind')?.innerText || ''`)));
await ev(`[...document.querySelectorAll('.ag-skill-tab')].find(b=>b.innerText==='全部')?.click()`);
await sleep(500);
await ev(`[...document.querySelectorAll('.ag-cat')].find(b=>b.innerText==='音乐MV')?.click()`);
await sleep(700);
check('按分类筛选生效', (await ev(`document.querySelectorAll('.ag-skill').length`)) === 1
  && /MUSIC|MV|音乐/i.test(await ev(`document.querySelector('.ag-skill b')?.innerText || ''`)),
  await ev(`document.querySelector('.ag-skill b')?.innerText || ''`));
await ev(`[...document.querySelectorAll('.ag-cat')].find(b=>b.innerText==='全部')?.click()`);
await sleep(600);

log('\n=== 3. 套用 Skill ===');
const goalBefore = await ev(`document.querySelector('.ag-launch textarea')?.value || ''`);
check('套用前目标输入为空', goalBefore.trim() === '', JSON.stringify(goalBefore));
await ev(`(() => {
  const card = [...document.querySelectorAll('.ag-skill')].find(c => (c.innerText || '').includes('精品女频短剧'));
  card?.querySelector('button')?.click();
})()`);
await sleep(2500);
const goalAfter = await ev(`document.querySelector('.ag-launch textarea')?.value || ''`);
check('目标文案已按模板填入', goalAfter.includes('短剧') && goalAfter.length > 6, JSON.stringify(goalAfter));
log(`  填入的目标: ${goalAfter}`);
check('出现「已套用」提示条', await ev(`!!document.querySelector('.ag-picked')`));
check('提示条显示套路名', /精品女频短剧/.test(await ev(`document.querySelector('.ag-picked b')?.innerText || ''`)));
const pickedText = await ev(`document.querySelector('.ag-picked')?.innerText || ''`);
check('提示条显示风格与步数', /韩漫厚涂/.test(pickedText), pickedText);
check('卡片进入选中态', await ev(`!!document.querySelector('.ag-skill.on')`));
const curAgent = await ev(`document.querySelector('.ag-agent.on .ag-agent-meta b')?.innerText`);
check('岗位自动切到套路指定的「制片人」', curAgent === '制片人', String(curAgent));
check('使用按钮变「已套用」', /已套用/.test(await ev(`document.querySelector('.ag-skill.on button')?.innerText || ''`)));
await shot('test/shot-skill-picked.png');

log('\n=== 4. 取消套用 ===');
await ev(`[...document.querySelectorAll('.ag-picked button')].find(b=>b.innerText.includes('取消套用'))?.click()`);
await sleep(600);
check('提示条消失', !(await ev(`!!document.querySelector('.ag-picked')`)));
check('目标输入被清空', (await ev(`document.querySelector('.ag-launch textarea')?.value || ''`)).trim() === '');

log('\n=== 收尾 ===');
check('无 console 异常', errs.length === 0, errs.slice(0, 2).join(' | '));
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
