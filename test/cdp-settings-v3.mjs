// 验证新版设置：用途 / 供应商 / 自定义接口 三个页签
const CDP = 'http://127.0.0.1:9222';
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push((msg.params.args || []).map((a) => a.value ?? '').join(' ').slice(0, 200));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 980, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 4500));

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log('  截图:', f);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '设置').click()`);
await wait(2000);

console.log('页签:', await ev(`[...document.querySelectorAll('.modal .tabs button')].map(b=>b.textContent.trim())`));
console.log('用途卡片:', await ev(`document.querySelectorAll('.config-card').length`));
console.log('用途行:', await ev(`[...document.querySelectorAll('.config-card .config-head')].map(e=>e.innerText.replace(/\\n/g,' | '))`));
console.log('来源下拉项数:', await ev(`[...document.querySelectorAll('.config-card select')].map(s=>s.options.length)`));
await shot('screenshot-settings-usage.png');

await ev(`[...document.querySelectorAll('.modal .tabs button')].find(b=>b.textContent.trim()==='供应商').click()`);
await wait(1200);
console.log('\n供应商数量:', await ev(`document.querySelectorAll('.pv-card').length`));
console.log('前三个:', await ev(`[...document.querySelectorAll('.pv-card')].slice(0,3).map(c=>c.innerText.split('\\n').slice(0,2).join(' | '))`));
await shot('screenshot-settings-providers.png');

await ev(`[...document.querySelectorAll('.modal .tabs button')].find(b=>b.textContent.trim()==='自定义接口').click()`);
await wait(1200);
console.log('\n自定义接口数量:', await ev(`document.querySelectorAll('.pv-card').length`));
console.log('接口:', await ev(`[...document.querySelectorAll('.pv-card')].map(c=>c.innerText.split('\\n').slice(0,2).join(' | '))`));
await shot('screenshot-settings-customapi.png');

console.log('\nconsole 错误:', errors.length ? errors.slice(0, 6) : '(无)');
process.exit(0);
