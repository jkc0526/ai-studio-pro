// 逐个视图截图 + 采集 console 报错
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
    errors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || '').slice(0, 300));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 4500));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) return `EXCEPTION: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`;
  return r?.result?.value;
};
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log('  截图:', f);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('顶部视图按钮:', await ev(`[...document.querySelectorAll('.tabs-bar button')].map(b => b.textContent)`));
await shot('screenshot-view-script.png');

for (const [label, file] of [['分镜', 'screenshot-view-storyboard.png'], ['角色', 'screenshot-view-characters.png'], ['画布', 'screenshot-view-canvas.png']]) {
  await ev(`[...document.querySelectorAll('.tabs-bar button')].find(b => b.textContent.trim() === '${label}').click()`);
  await wait(2200);
  console.log(`\n[${label}]`);
  console.log('  分镜卡片数:', await ev(`document.querySelectorAll('.shot').length`));
  console.log('  已出图:', await ev(`document.querySelectorAll('.shot-img img').length`));
  console.log('  角色 chips:', await ev(`document.querySelectorAll('.chip').length`));
  console.log('  画布节点:', await ev(`document.querySelectorAll('.react-flow__node').length`));
  await shot(file);
}

console.log('\nconsole 错误:', errors.length ? errors.slice(0, 8) : '(无)');
process.exit(0);
