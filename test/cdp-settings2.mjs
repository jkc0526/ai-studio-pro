// 验证新版设置弹窗：保存全部 / 已保存标识 / 清除密钥 / 测试连接
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222';
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
    errors.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: 'http://127.0.0.1:8787' }, sessionId);
await new Promise((r) => setTimeout(r, 4000));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) return `EXCEPTION: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`;
  return r?.result?.value;
};
const click = (text) => ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))?.click(), 'ok'`);
const setInput = (idx, val) => ev(`
(() => { const el = [...document.querySelectorAll('.modal input')][${idx}];
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('== 打开设置 ==');
await click('设置'); await wait(1200);
console.log('key 状态标签:', await ev(`document.querySelector('.keytag')?.innerText`));
console.log('输入框提示:', await ev(`[...document.querySelectorAll('.modal input')].map(i => i.placeholder)`));

console.log('\n== 只填「文本模型」tab，点「保存全部」 ==');
await setInput(0, 'https://apihub.agnes-ai.com/v1');
await setInput(1, 'sk-SAVEALL-abcdef123456');
await setInput(2, 'agnes-2.5-pro');
await click('保存全部'); await wait(2500);
console.log('toast:', await ev(`document.querySelector('.toast')?.innerText`));

console.log('\n== 重开后应显示已保存掩码 ==');
await click('设置'); await wait(1500);
console.log('key 状态标签:', await ev(`document.querySelector('.keytag')?.innerText`));
console.log('两个 tab 是否都有绿点:', await ev(`document.querySelectorAll('.keydot').length`));
console.log('图像模型 tab 的 base_url:', await ev(`(() => {
  const tabs = [...document.querySelectorAll('.tabs button')]; tabs[1].click(); return 'switched';
})()`));
await wait(600);
console.log('  切换后字段:', await ev(`[...document.querySelectorAll('.modal input')].map(i => i.value)`));

console.log('\n== 测试连接（当前是无效网关，应给出明确报错） ==');
await click('测试连接'); await wait(15000);
console.log('结果:', await ev(`document.querySelector('.err-box')?.innerText`));

console.log('\n== 清除密钥 ==');
await ev(`(() => { const t = [...document.querySelectorAll('.tabs button')]; t[1].click(); return 'ok'; })()`);
await wait(500);
await click('清除'); await wait(400);
console.log('清除提示:', await ev(`document.querySelector('.modal .field:nth-of-type(2) .hint')?.innerText`));
await click('保存全部'); await wait(2500);
console.log('toast:', await ev(`document.querySelector('.toast')?.innerText`));

console.log('\nconsole 错误:', errors.length ? errors.slice(0, 5) : '(无)');
process.exit(0);
