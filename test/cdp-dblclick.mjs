// 验证画布「双击空白处打开节点菜单」
const CDP = 'http://127.0.0.1:9222';
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];
const logs = [];
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    const txt = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
    if (msg.params.type === 'error') errors.push(txt); else logs.push(`[${msg.params.type}] ${txt}`);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || '').slice(0, 400));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 5000));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) return { err: r.exceptionDetails.exception?.description || 'eval error' };
  return { v: r.result?.value };
};

console.log('=== 1. 页面标题 ===');
console.log(JSON.stringify((await ev('document.title')).v));

console.log('\n=== 2. 切到「画布」视图 ===');
console.log(JSON.stringify((await ev(`
  (() => { const b = [...document.querySelectorAll('.side-item')].find(x => x.textContent.includes('画布'));
    if (!b) return 'no-canvas-btn'; b.click(); return 'clicked'; })()
`)).v));
await new Promise((r) => setTimeout(r, 2500));

console.log('\n=== 3. 画布容器 / 节点 ===');
console.log(JSON.stringify((await ev(`
  (() => { const w = document.querySelector('.canvas-wrap');
    if (!w) return { wrap: false };
    const r = w.getBoundingClientRect();
    return { wrap: true, rect: {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)},
             nodes: document.querySelectorAll('.react-flow__node').length,
             pane: !!document.querySelector('.react-flow__pane') }; })()
`)).v));

// 取一个空白点（画布右侧偏下，避开节点）
const rect = (await ev(`(()=>{const r=document.querySelector('.canvas-wrap').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`)).v;
const px = Math.round(rect.x + rect.w * 0.72);
const py = Math.round(rect.y + rect.h * 0.78);

console.log('\n=== 4. 在空白处双击 (' + px + ',' + py + ') ===');
for (const clickCount of [1, 2]) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount }, sessionId);
  await new Promise((r) => setTimeout(r, 60));
}
await new Promise((r) => setTimeout(r, 900));

console.log('\n=== 5. 菜单是否出现 ===');
console.log(JSON.stringify((await ev(`
  (() => { const p = document.querySelector('.palette');
    if (!p) return { palette: false };
    const bd = document.querySelector('.palette-backdrop');
    const items = [...p.querySelectorAll('.palette-item')].map(b => b.textContent.trim());
    const pr = p.getBoundingClientRect();
    const br = bd ? bd.getBoundingClientRect() : null;
    const cs = getComputedStyle(p);
    const bcs = bd ? getComputedStyle(bd) : null;
    return { palette: true, cats: [...p.querySelectorAll('.palette-cat-head')].map(h=>h.textContent.trim()), items,
      paletteRect: {x:Math.round(pr.x),y:Math.round(pr.y),w:Math.round(pr.width),h:Math.round(pr.height)},
      backdropRect: br ? {x:Math.round(br.x),y:Math.round(br.y),w:Math.round(br.width),h:Math.round(br.height)} : null,
      palettePos: cs.position, paletteZ: cs.zIndex, paletteDisplay: cs.display, paletteVis: cs.visibility,
      backdropPos: bcs?.position, backdropZ: bcs?.zIndex, backdropDisplay: bcs?.display,
      wrapTransform: getComputedStyle(document.querySelector('.canvas-wrap')).transform }; })()
`)).v, null, 2));

console.log('\n=== 6. console 报错 ===');
console.log(errors.length ? errors.join('\n---\n') : '(无)');

await send('Page.captureScreenshot', {}, sessionId).then(async (r) => {
  const fs = await import('node:fs');
  fs.writeFileSync('E:/work Buddy/weave-canvas/test/shot-dblclick.png', Buffer.from(r.data, 'base64'));
  console.log('\n截图已存 test/shot-dblclick.png');
});
process.exit(0);
