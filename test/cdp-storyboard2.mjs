// 验证新版分镜工作台：工具栏、成片恢复、视频预览、版本条
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
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 4500));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) return `EXCEPTION: ${r.exceptionDetails.exception?.description || ''}`;
  return r?.result?.value;
};
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log('  截图:', f);
};

await ev(`[...document.querySelectorAll('.tabs-bar button')].find(b => b.textContent.trim() === '分镜').click()`);
await new Promise((r) => setTimeout(r, 3000));

console.log('工具栏按钮:', await ev(`[...document.querySelectorAll('.view-bar button')].map(b => b.textContent.trim()).filter(Boolean)`));
console.log('模型下拉选项数:', await ev(`[...document.querySelectorAll('.view-bar select')].map(s => s.options.length)`));
console.log('成片区是否出现:', await ev(`!!document.querySelector('.movie-bar')`));
console.log('成片信息:', await ev(`document.querySelector('.movie-bar')?.innerText?.replace(/\\n/g,' | ')`));
console.log('视频播放器:', await ev(`document.querySelectorAll('.shot-img video').length`));
console.log('镜头卡片:', await ev(`document.querySelectorAll('.shot').length`));
await shot('screenshot-storyboard-v2.png');

console.log('\nconsole 错误:', errors.length ? errors.slice(0, 6) : '(无)');
process.exit(0);
