// 在分镜页点击「批量生图」，轮询进度直到完成，再截图
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

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;

await ev(`[...document.querySelectorAll('.tabs-bar button')].find(b => b.textContent.trim() === '分镜').click()`);
await new Promise((r) => setTimeout(r, 2500));
console.log('点击前已出图:', await ev(`document.querySelectorAll('.shot-img img').length`));
console.log('点击批量生图:', await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('批量生图')).click(), 'ok'`));

for (let i = 1; i <= 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const pill = await ev(`[...document.querySelectorAll('.pill')].map(p => p.textContent).find(t => t.includes('任务')) || ''`);
  const imgs = await ev(`document.querySelectorAll('.shot-img img').length`);
  console.log(`  ${i * 3}s 进度: ${pill || '任务未开始'} | 已出图 ${imgs}`);
  if (imgs >= 4) break;
  if (i > 4 && !pill) break;
}

const state = await ev(`[...document.querySelectorAll('.shot')].map(s => ({
  seq: s.querySelector('.seq')?.textContent,
  status: s.querySelector('.badge')?.textContent,
  img: !!s.querySelector('.shot-img img'),
  err: s.querySelector('.err-box')?.textContent || null,
}))`);
console.log('\n各镜头状态:', JSON.stringify(state, null, 1));

const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
const { writeFileSync } = await import('node:fs');
writeFileSync('screenshot-batch-done.png', Buffer.from(s.data, 'base64'));
console.log('截图: screenshot-batch-done.png');
console.log('console 错误:', errors.length ? errors.slice(0, 5) : '(无)');
process.exit(0);
