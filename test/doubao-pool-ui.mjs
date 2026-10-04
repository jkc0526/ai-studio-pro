/** 豆包号池面板 UI 验收（只读：只点页签与查看，不点任何保存/删除按钮） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const APP = 'http://127.0.0.1:8787';
const CDP_URL = 'http://127.0.0.1:9222';
const ROOT = 'E:/work Buddy/weave-canvas';
const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/doubao-pool-ui.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { log(`💥 ${e?.message || e}`); report(); process.exit(1); });
let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; log(`  ✅ ${n}`); } else { fail++; log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser = null;
const alive = async () => fetch(`${CDP_URL}/json/version`).then(() => true).catch(() => false);
if (!(await alive())) {
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    ['--headless', '--disable-gpu', '--disable-extensions', '--remote-debugging-port=9222',
      `--user-data-dir=${os.tmpdir()}/edge-doubao-pool`, '--no-first-run'], { detached: true, stdio: 'ignore' });
  browser.unref();
  for (let i = 0; i < 40; i++) { await sleep(400); if (await alive()) break; }
}
const ver = await fetch(`${CDP_URL}/json/version`).then((r) => r.json());
log(`浏览器: ${ver.Browser}`);

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
    errs.push((msg.params.exceptionDetails?.exception?.description || '').slice(0, 160));
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errs.push(`console.error: ${(msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 160)}`);
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: APP }, sessionId);
await sleep(5000);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(ROOT, f), Buffer.from(s.data, 'base64'));
  log(`  截图: ${f}`);
};

log('\n=== 1. 打开应用 ===');
check('页面不是白屏', ((await ev(`document.body.innerText`)) || '').trim().length > 30);
const sideItems = await ev(`[...document.querySelectorAll('.side-item, nav button, aside button')].map(b=>b.innerText.trim()).filter(Boolean)`);
log(`  侧栏项: ${JSON.stringify(sideItems)}`);

log('\n=== 2. 打开设置 → 豆包号池 ===');
const opened = await ev(`(() => {
  const b = document.querySelector('.topbar button[title="设置"]')
        || document.querySelector('button[aria-label="设置"]')
        || [...document.querySelectorAll('button')].find(x => (x.getAttribute('title') || '') === '设置');
  if (b) { b.click(); return true; }
  return false;
})()`);
check('找到并点击顶栏「设置」', opened === true);
await sleep(2500);
check('设置弹窗已打开', await ev(`!!document.querySelector('.modal-mask .modal')`));

const tabs = await ev(`[...document.querySelectorAll('.model-center-custom-link')].map(b=>b.innerText.trim())`);
log(`  页签: ${JSON.stringify(tabs)}`);
check('存在「豆包号池」页签', tabs.includes('豆包号池'), JSON.stringify(tabs));

await ev(`[...document.querySelectorAll('.model-center-custom-link')].find(b=>b.innerText.trim()==='豆包号池')?.click()`);
await sleep(3000);

log('\n=== 3. 校验面板内容 ===');
const panelText = (await ev(`document.querySelector('.modal-body')?.innerText || ''`)) || '';
check('面板出现「桥接服务」', panelText.includes('桥接服务'));
check('桥接状态显示为「运行中」', panelText.includes('运行中'), panelText.slice(0, 80).replace(/\n/g, ' | '));
check('显示「由本软件启动」', panelText.includes('由本软件启动'));
check('显示桥接目录', /doubao-bridge/.test(panelText), '');
check('显示服务地址 http://127.0.0.1:9788', panelText.includes('http://127.0.0.1:9788'), '');
check('显示预置供应商名', panelText.includes('豆包（网页版号池）'));
check('显示供应商协议 openai-video', panelText.includes('openai-video'));
check('显示池内剩余额度', panelText.includes('池内剩余额度') && /10\s*\/\s*10/.test(panelText.replace(/\s+/g, ' ')));
check('显示可用账号', /可用账号/.test(panelText) && /1\s*\/\s*1/.test(panelText.replace(/\s+/g, ' ')));
check('显示调度策略', panelText.includes('调度策略') && panelText.includes('least-used'));
check('有「把视频模型切到豆包号池」按钮', panelText.includes('把视频模型切到豆包号池'));

const accountRows = await ev(`document.querySelectorAll('.modal-body table tbody tr').length`);
check('账号表格有数据行', accountRows >= 1, `rows=${accountRows}`);
const accText = (await ev(`document.querySelector('.modal-body table tbody')?.innerText || ''`)) || '';
check('账号行显示「默认账号」', accText.includes('默认账号'), accText.replace(/\n/g, ' | ').slice(0, 90));
check('账号行显示可用状态徽标', accText.includes('可用'), '');
check('账号行显示调试端口', /:\d{4}/.test(accText), '');

const btns = await ev(`[...document.querySelectorAll('.modal-body button')].map(b=>b.innerText.trim()).filter(Boolean)`);
log(`  面板按钮: ${JSON.stringify(btns)}`);
check('有 启动/停止/刷新 控制', btns.includes('停止') && btns.includes('刷新') && btns.includes('重启'), JSON.stringify(btns));
check('有 新增账号', btns.includes('新增账号'));
check('有账号级操作（探活/恢复/冷却/删除）', ['探活', '恢复', '冷却', '删除'].every((t) => btns.includes(t)), JSON.stringify(btns));
check('有「用这个号」切换入口', btns.includes('用这个号'), JSON.stringify(btns));
check('有 启用/停用 开关', btns.includes('停用') || btns.includes('启用'), JSON.stringify(btns));
check('显示账号切换区块', panelText.includes('账号切换'), '');
// 两种模式都合法：自动轮询时显示"下一个会用"，锁定时显示"已锁定：X"
check('显示账号切换模式（自动轮询 或 已锁定）',
  panelText.includes('自动轮询') || panelText.includes('已锁定'),
  panelText.slice(0, 60).replace(/\n/g, ' | '));
check('自动模式下显示下一个会用的账号（或处于锁定态）',
  panelText.includes('下一个会用') || panelText.includes('已锁定') || panelText.includes('解除锁定'),
  '');
check('底部提示了登录命令', panelText.includes('tools/login.js'));

await shot('test/shot-doubao-pool.png');

log('\n=== 4. 切回其它页签（回归） ===');
await ev(`[...document.querySelectorAll('.model-center-custom-link')].find(b=>b.innerText.trim()==='自定义接口')?.click()`);
await sleep(1500);
const customText = (await ev(`document.querySelector('.modal-body')?.innerText || ''`)) || '';
check('「自定义接口」页签仍正常', customText.length > 50 && !customText.includes('池内剩余额度'));
await ev(`[...document.querySelectorAll('.model-center-mode button')].find(b=>b.innerText.trim()==='精选')?.click()`);
await sleep(1500);
const srcText = (await ev(`document.querySelector('.modal-body')?.innerText || ''`)) || '';
check('「精选」页签仍正常（三种用途都在）', srcText.includes('文本模型') && srcText.includes('视频模型'));

log('\n=== 收尾 ===');
check('无 console 异常', errs.length === 0, errs.slice(0, 3).join(' | '));
log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { browser.kill(); } catch { /* ignore */ } }
process.exit(fail ? 1 : 0);
