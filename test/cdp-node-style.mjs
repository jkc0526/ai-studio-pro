// 验证：双击菜单点「图片」→ 新节点样式渲染 + 截图
const CDP = 'http://127.0.0.1:9222';
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const errors = [];
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
  else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  else if (msg.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (msg.params.exceptionDetails?.exception?.description || '').slice(0, 300));
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 5000));
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', {}, sessionId);
  const fs = await import('node:fs');
  fs.writeFileSync(`E:/work Buddy/weave-canvas/test/${name}.png`, Buffer.from(r.data, 'base64'));
};

// 切画布 + 新建空画布（避开「示例画布」按钮）
await ev(`[...document.querySelectorAll('.side-item')].find(x=>x.textContent.includes('画布')).click()`);
await new Promise((r) => setTimeout(r, 2000));
await ev(`window.__err=[]; window.addEventListener('error',e=>window.__err.push(String(e.message)));`);

const newBtn = await ev(`(()=>{const b=[...document.querySelectorAll('.view-bar button')].find(x=>x.textContent.trim()==='新建'); if(!b) return 'none'; b.click(); return 'clicked';})()`);
console.log('=== 点「新建」:', newBtn);
await new Promise((r) => setTimeout(r, 3000));

console.log('\n=== 空画布节点统计 ===');
console.log(JSON.stringify(await ev(`({ rfNodes: document.querySelectorAll('.react-flow__node').length })`)));

const rect = await ev(`(()=>{const r=document.querySelector('.canvas-wrap').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const px = Math.round(rect.x + rect.w * 0.42), py = Math.round(rect.y + rect.h * 0.30);

// 双击空白 → 点「图片」
for (const clickCount of [1, 2]) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount }, sessionId);
  await new Promise((r) => setTimeout(r, 60));
}
await new Promise((r) => setTimeout(r, 700));
console.log('\n=== 菜单已开 ===');
console.log(JSON.stringify(await ev(`!!document.querySelector('.palette')`)));

await ev(`[...document.querySelectorAll('.palette-item')].find(b=>b.textContent.trim().startsWith('图片')).click()`);
await new Promise((r) => setTimeout(r, 1800));

const safe = async (expr) => {
  const r = await ev(`(()=>{try{return JSON.stringify(${expr})}catch(e){return 'ERR:'+e.message}})()`);
  return r;
};
console.log('\n=== 加节点后统计 ===');
console.log('rfNodes     :', await safe(`document.querySelectorAll('.react-flow__node').length`));
console.log('oii-node    :', await safe(`document.querySelectorAll('.oii-node').length`));
console.log('oii-title   :', await safe(`[...document.querySelectorAll('.oii-node-title')].map(t=>t.textContent.trim())`));
console.log('oii-prompt  :', await safe(`document.querySelectorAll('.oii-prompt').length`));
console.log('oii-send    :', await safe(`document.querySelectorAll('.oii-send').length`));
console.log('palette关闭 :', await safe(`!document.querySelector('.palette')`));

// 用真实鼠标点击新图片节点，验证浮动工具条
const nodePos = await ev(`(()=>{const n=document.querySelector('.react-flow__node'); if(!n) return null; const r=n.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+40)};})()`);
if (nodePos) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: nodePos.x, y: nodePos.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: nodePos.x, y: nodePos.y, button: 'left', clickCount: 1 }, sessionId);
  await new Promise((r) => setTimeout(r, 900));
}
console.log('\n=== 选中后浮动工具条 ===');
console.log('toolbar  :', await safe(`document.querySelectorAll('.oii-toolbar').length`));
console.log('tb 文案  :', await safe(`[...document.querySelectorAll('.oii-toolbar .oii-tb')].map(b=>b.textContent.trim())`));
console.log('tab      :', await safe(`[...document.querySelectorAll('.oii-tab')].map(b=>b.textContent.trim())`));
console.log('节点选中态:', await safe(`document.querySelectorAll('.oii-node.on').length`));

await shot('shot-node-style');
console.log('\n=== console 报错 ===');
console.log(errors.length ? errors.join('\n') : '(无)');
process.exit(0);
