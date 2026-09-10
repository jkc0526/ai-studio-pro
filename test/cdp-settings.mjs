// 驱动真实 UI 走一遍「设置 → 填 key → 保存」，采集 toast 与 console 报错
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
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
  } else if (msg.method === 'Runtime.consoleAPICalled' || msg.method === 'Log.entryAdded') {
    logs.push(JSON.stringify(msg.params).slice(0, 300));
  }
};
await new Promise((r) => { ws.onopen = r; });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 4000));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) return `EXCEPTION: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`;
  return r?.result?.value;
};

console.log('1) 点开设置：', await ev(`
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '设置').click(), 'clicked'
`));
await new Promise((r) => setTimeout(r, 1200));
console.log('   弹窗标题：', await ev(`document.querySelector('.modal-head')?.innerText`));
console.log('   输入框数量：', await ev(`document.querySelectorAll('.modal input').length`));

console.log('2) 填写三个字段：', await ev(`
(() => {
  const setVal = (el, v) => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const ins = [...document.querySelectorAll('.modal input')];
  setVal(ins[0], 'https://apihub.agnes-ai.com/v1');
  setVal(ins[1], 'sk-UITEST-1234567890');
  setVal(ins[2], 'agnes-2.5-pro');
  return ins.map(i => i.value);
})()
`));

console.log('3) 点保存：', await ev(`
  [...document.querySelectorAll('.modal button')].find(b => b.textContent.includes('保存')).click(), 'clicked'
`));
await new Promise((r) => setTimeout(r, 2000));
console.log('   toast：', await ev(`document.querySelector('.toast')?.innerText || '(无)'`));
console.log('   modal 还在吗：', await ev(`!!document.querySelector('.modal')`));

console.log('4) 重新打开设置核对：', await ev(`
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '设置').click(), 'clicked'
`));
await new Promise((r) => setTimeout(r, 1500));
console.log('   字段值：', await ev(`[...document.querySelectorAll('.modal input')].map(i => i.value + ' | placeholder=' + i.placeholder)`));
console.log('   key 标签：', await ev(`document.querySelectorAll('.modal .field-label')[1]?.innerText`));

console.log('5) console 摘要：');
console.log(logs.filter((l) => /error|Error|fail|Failed/.test(l)).slice(0, 6).join('\n') || '   (无错误)');
process.exit(0);
