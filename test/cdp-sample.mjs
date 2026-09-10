// 点击「示例画布」按钮生成示例工作流，等待渲染后截图
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const OUT = process.argv[2] || 'screenshot-ui.png';

const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++mid;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
};
await new Promise((r) => { ws.onopen = r; });

const targets = await fetch(`${CDP}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page' && t.url.includes('127.0.0.1:8787'));
if (!page) { console.error('找不到应用页面'); process.exit(1); }
const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });

await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId))?.result?.value;

const clicked = await evalJs(`
  [...document.querySelectorAll('button')].find(b => b.innerText.includes('示例画布'))?.click() ?? 'not found'
`);
console.log('点击结果:', clicked);
await new Promise((r) => setTimeout(r, 2500));

const nodeCount = await evalJs('document.querySelectorAll(".react-flow__node").length');
const edgeCount = await evalJs('document.querySelectorAll(".react-flow__edge").length');
console.log(JSON.stringify({ nodeCount, edgeCount }));

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await new Promise((r) => setTimeout(r, 800));
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);
process.exit(0);
