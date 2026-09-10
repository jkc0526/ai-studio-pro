// 仅截图新版设置弹窗，不做任何保存/清除操作
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
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
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 860, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 4000));
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (file) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(file, Buffer.from(s.data, 'base64'));
  console.log('截图:', file);
};

await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '设置').click()`);
await new Promise((r) => setTimeout(r, 1500));
console.log('文本模型 tab 状态:', await ev(`document.querySelector('.keytag')?.innerText`));
await shot('screenshot-settings-text.png');

await ev(`[...document.querySelectorAll('.tabs button')][1].click()`);
await new Promise((r) => setTimeout(r, 800));
console.log('图像模型 tab 字段:', await ev(`[...document.querySelectorAll('.modal input')].map(i => i.value + ' | ' + i.placeholder)`));
console.log('图像模型 key 标签:', await ev(`document.querySelector('.keytag')?.innerText`));
await shot('screenshot-settings-image.png');
process.exit(0);
