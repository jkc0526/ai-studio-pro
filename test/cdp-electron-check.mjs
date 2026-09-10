// 连接 Electron 窗口做只读校验（不新建 target、不改设备指标）
const CDP = process.env.CDP || 'http://127.0.0.1:9333';
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const targets = await fetch(`${CDP}/json`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) { console.log('未找到页面'); process.exit(1); }
console.log('页面:', page.title, '|', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];
const send = (m, p = {}) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p }));
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
await send('Runtime.enable');
await send('Page.enable');

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('标题:', await ev('document.title'));
console.log('视图页签:', await ev(`[...document.querySelectorAll('.tabs-bar button')].map(b=>b.textContent)`));
console.log('脚本数:', await ev(`document.querySelectorAll('.shot').length || 0`));

for (const tab of ['剧本', '分镜', '角色', '画布']) {
  await ev(`[...document.querySelectorAll('.tabs-bar button')].find(b=>b.textContent.trim()==='${tab}')?.click()`);
  await wait(1800);
  const info = await ev(`({
    shots: document.querySelectorAll('.shot').length,
    imgs: document.querySelectorAll('.shot-img img').length,
    nodes: document.querySelectorAll('.react-flow__node').length,
  })`);
  console.log(`  ${tab}:`, JSON.stringify(info));
  const s = await send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`screenshot-electron-${tab === '剧本' ? 'script' : tab === '分镜' ? 'storyboard' : tab === '角色' ? 'characters' : 'canvas'}.png`, Buffer.from(s.data, 'base64'));
}

console.log('console 错误:', errors.length ? errors.slice(0, 5) : '(无)');
process.exit(0);
