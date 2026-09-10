// 新布局验收：左侧栏 + 创作台 + 分镜检查器
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
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
await new Promise((r) => setTimeout(r, 5000));

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log('  截图:', f);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('侧栏导航:', await ev(`[...document.querySelectorAll('.side-nav .side-item')].map(b=>b.innerText.trim())`));
console.log('侧栏剧本数:', await ev(`document.querySelectorAll('.side-proj').length`));
console.log('顶栏:', await ev(`document.querySelector('.topbar')?.innerText.replace(/\\n/g,' | ')`));
console.log('创作台输入卡:', await ev(`!!document.querySelector('.hero-card')`));
console.log('快捷入口:', await ev(`[...document.querySelectorAll('.quick-card b')].map(b=>b.innerText)`));
console.log('剧本卡片:', await ev(`document.querySelectorAll('.proj-card').length`));
await shot('screenshot-v5-home.png');

await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('分镜'))?.click()`);
await wait(3000);
console.log('\n分镜卡片:', await ev(`document.querySelectorAll('.shot').length`));
await ev(`document.querySelector('.shot-img')?.click()`);
await wait(1200);
console.log('检查器出现:', await ev(`!!document.querySelector('.inspector')`));
console.log('检查器内容:', await ev(`document.querySelector('.inspector')?.innerText.replace(/\\n/g,' | ').slice(0,200)`));
console.log('检查器视频参数:', await ev(`[...document.querySelectorAll('.inspector select')].map(s=>[...s.options].map(o=>o.text).join('/'))`));
await shot('screenshot-v5-storyboard.png');

await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('创作台'))?.click()`);
await wait(1000);
await ev(`[...document.querySelectorAll('.side-foot .side-item')].find(b=>b.innerText.includes('风格库'))?.click()`);
await wait(1500);
console.log('\n风格卡:', await ev(`document.querySelectorAll('.style-card').length`));
await shot('screenshot-v5-styles.png');

console.log('\nconsole 错误:', errors.length ? errors.slice(0, 6) : '(无)');
process.exit(0);
