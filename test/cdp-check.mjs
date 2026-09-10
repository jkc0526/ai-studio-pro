// 直连 CDP 验证页面：导航 → 收集 console 错误 → 检查 DOM → 截图
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const TARGET = process.argv[2] || 'http://127.0.0.1:8787';
const OUT = process.argv[3] || 'screenshot-ui.png';

const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const events = [];

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
  } else if (msg.method) {
    events.push(msg);
  }
};

await new Promise((r) => { ws.onopen = r; });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });

await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: TARGET }, sessionId);

await new Promise((r) => setTimeout(r, 5000));

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
  return r?.result?.value;
};

const title = await evalJs('document.title');
const hasFlow = await evalJs('!!document.querySelector(".react-flow")');
const nodeCount = await evalJs('document.querySelectorAll(".react-flow__node").length');
const edgeCount = await evalJs('document.querySelectorAll(".react-flow__edge").length');
const topbarText = await evalJs('(document.querySelector(".topbar")||{}).innerText || ""');

const consoleErrors = events
  .filter((e) => e.method === 'Log.entryAdded' || e.method === 'Runtime.consoleAPICalled')
  .map((e) => {
    const p = e.params;
    if (p.entry) return `[${p.entry.level}] ${p.entry.text}`;
    if (p.type === 'error' || p.type === 'warning') return `[console.${p.type}] ${(p.args || []).map((a) => a.value ?? a.description ?? '').join(' ')}`;
    return null;
  })
  .filter(Boolean)
  .filter((t) => /error|Error|warning|Warning/.test(t));

const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
const { writeFileSync } = await import('node:fs');
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));

console.log(JSON.stringify({ title, hasFlow, nodeCount, edgeCount, topbarText: topbarText.slice(0, 120), consoleErrors: consoleErrors.slice(0, 10), screenshot: OUT }, null, 2));
process.exit(0);
