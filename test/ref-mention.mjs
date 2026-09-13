/**
 * 上游素材 @ 引用功能验收（零花费，不触碰用户真实画布）
 *
 * 覆盖：
 *   A) 后端解析单测：mentionKeys / stripMentions / pickRefUrl（走 @图片N 优先、无 mention 回落）
 *   B) 前端 UI：临时画布（图片→视频连线）里
 *      - 视频节点出现「参考」行与缩略图
 *      - 输入 @ 弹出选择器
 *      - 点缩略图 / 选择器项插入 @图片1，出现已引用 chip
 *      - mediaRefs 落库、后端按 mediaRefs 取图
 *   结束后删除临时画布（用户数据零改动）
 *
 * 前置：服务已跑在 8787，系统 Edge 无头调试端口 9222
 * 运行：node test/ref-mention.mjs
 */
import fs from 'node:fs';
import { spawn } from 'node:child_process';

/* PowerShell 环境下 stdout 回传不稳定，这里自己落一份报告，便于查看 */
const LOG = [];
const rawLog = console.log.bind(console);
console.log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); rawLog(s); };
const report = () => { try { fs.writeFileSync('test/ref-mention.out.txt', LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { console.log(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log(`💥 ${e?.message || e}`); report(); process.exit(1); });

const APP = process.env.APP || 'http://127.0.0.1:8787';
const CDP = process.env.CDP || 'http://127.0.0.1:9222';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (p, method = 'GET', body) => {
  const res = await fetch(`${APP}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json().catch(() => null);
};

/* 无头浏览器：端口没开就自己拉一个（shell 会话里启动的进程容易被回收，
   放这里自管生命周期，保证脚本可独立运行） */
const EDGE = process.env.EDGE_EXE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
async function startBrowser() {
  const child = spawn(EDGE, ['--headless', '--disable-gpu', '--disable-extensions',
    '--remote-debugging-port=9222',
    `--user-data-dir=${process.env.TEMP || '/tmp'}/edge-ref-mention-profile`, '--no-first-run'],
  { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const ok = await fetch(`${CDP}/json/version`).then(() => true).catch(() => false);
    if (ok) return child;
  }
  throw new Error('无头浏览器调试端口未就绪');
}

/* ================= A. 后端解析单测 ================= */
console.log('=== A. 后端 @ 引用解析 ===');
process.env.WEAVE_DATA_DIR = process.env.WEAVE_DATA_DIR || `${process.cwd()}/data`;
const { mentionKeys, stripMentions, pickRefUrl } = await import('../server/engine.js');

check('@图片1 能被识别', JSON.stringify(mentionKeys('男人 @图片1 在跳舞')) === '["图片1"]');
check('多个引用都识别', JSON.stringify(mentionKeys('@图片1 与 @图片2 合成')) === '["图片1","图片2"]');
check('@视频1 与 @ 空格兼容', JSON.stringify(mentionKeys('@ 视频 2 参考')) === '["视频2"]');
check('普通文本不误判', mentionKeys('画面里有个@符号但没有编号').length === 0);
check('送给模型的提示词不含 @', stripMentions('男人 @图片1 在跳舞') === '男人 参考图1 在跳舞',
  stripMentions('男人 @图片1 在跳舞'));

const node = { data: { mediaRefs: [
  { key: '图片1', type: 'image', url: '/outputs/a.png' },
  { key: '图片2', type: 'image', url: '/outputs/b.png' },
] } };
check('@图片2 取第二张', pickRefUrl(node, '@图片2 跳舞', []) === '/outputs/b.png');
check('无 mention 时取第一张', pickRefUrl(node, '跳舞', []) === '/outputs/a.png');
check('mention 指向不存在的编号则回落',
  pickRefUrl(node, '@图片9 跳舞', []) === '/outputs/a.png');
check('没有 mediaRefs 时回落上游图片', pickRefUrl({ data: {} }, '跳舞',
  [{ type: 'imageNode', data: {}, _output: { url: '/outputs/legacy.png' } }]) === '/outputs/legacy.png');

/* ================= B. 前端 UI ================= */
console.log('\n=== B. 前端参考行与 @ 选择器 ===');
// 取一张真实存在的图当素材（只读引用，不修改用户数据）
const media = (await api('/api/media'))?.data || [];
const sampleUrl = (media.find((m) => m.kind === 'image') || media[0])?.file_path;
check('拿到一张可用于测试的图片素材', !!sampleUrl, sampleUrl || '(media 为空)');

// 防御：清掉上次异常中断残留的临时画布
for (const c of ((await api('/api/canvases'))?.data || [])) {
  if (c.title === '__ref_mention_test__') { await api(`/api/canvases/${c.id}`, 'DELETE'); console.log(`  （已清理残留临时画布 ${c.id}）`); }
}

const created = await api('/api/canvases', 'POST', { title: '__ref_mention_test__' });
const canvasId = created?.data?.id;
check('创建临时画布', !!canvasId, JSON.stringify(created));

await api(`/api/canvases/${canvasId}`, 'PUT', {
  canvas: {
    nodes: [
      { id: 'timg', type: 'imageNode', position: { x: 120, y: 120 }, data: { label: '图片节点 1', imageUrl: sampleUrl, ratio: '16:9', quality: '1K' } },
      { id: 'tvid', type: 'videoNode', position: { x: 620, y: 120 }, data: { label: '视频节点 1', mode: 'image', prompt: '' } },
    ],
    edges: [{ id: 'e1', source: 'timg', target: 'tvid' }],
  },
});
const saved = (await api(`/api/canvases/${canvasId}`))?.data;
check('临时画布已写入 2 节点 1 连线', (saved?.node_count ?? 0) === 2, String(saved?.node_count));

const version = await fetch(`${CDP}/json/version`).then((r) => r.json()).catch(() => null);
if (!version) {
  console.log('  （调试端口未开，自动拉起无头 Edge）');
}
const browser = version ? null : await startBrowser();
const ver = version || await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const errors = [];
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
    errors.push((msg.params.args || []).map((a) => a.value ?? '').join(' ').slice(0, 160));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || JSON.stringify(msg.params.exceptionDetails)).slice(0, 900));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 940, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: APP }, sessionId);
await sleep(4800);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log('  截图:', f);
};

await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes('画布'))?.click()`);
await sleep(1600);
// 切到临时画布
const switched = await ev(`(() => {
  const sel = document.querySelector('.view-bar select');
  const opt = [...sel.options].find(o => o.text.includes('__ref_mention_test__'));
  if (!opt) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
check('切换到临时画布', switched === true);
await sleep(2000);
console.log(`  [检查点1] 切换画布后异常数 = ${errors.length}`);

check('视频节点渲染「参考」行', await ev(`!!document.querySelector('.oii-node-video .oii-refs')`));
check('参考行里有 1 个缩略图', (await ev(`document.querySelectorAll('.oii-node-video .oii-ref').length`)) === 1,
  String(await ev(`document.querySelectorAll('.oii-node-video .oii-ref').length`)));
check('缩略图编号为「图片1」', (await ev(`document.querySelector('.oii-node-video .oii-ref b')?.innerText`)) === '图片1');
check('缩略图真的是图片', await ev(`!!document.querySelector('.oii-node-video .oii-ref img')`));
await shot('test/shot-ref-row.png');

// 点缩略图插入引用
await ev(`document.querySelector('.oii-node-video .oii-ref')?.click()`);
await sleep(500);
const promptVal = await ev(`document.querySelector('.oii-node-video textarea')?.value`);
check('点缩略图插入 @图片1', (promptVal || '').includes('@图片1'), JSON.stringify(promptVal));
console.log(`  [检查点2] 点缩略图后异常数 = ${errors.length}`);
check('已引用 chip 出现', (await ev(`document.querySelectorAll('.oii-node-video .oii-used-chip').length`)) === 1);
check('缩略图高亮为已引用', await ev(`!!document.querySelector('.oii-node-video .oii-ref.on')`));

// 输入 @ 唤起选择器
await ev(`(() => {
  const ta = document.querySelector('.oii-node-video textarea');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, ta.value + ' 男人 @');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  ta.focus();
  return true;
})()`);
await sleep(400);
check('输入 @ 弹出选择器', await ev(`!!document.querySelector('.oii-mention')`));
check('选择器里有候选', (await ev(`document.querySelectorAll('.oii-mention-item').length`)) >= 1);
await shot('test/shot-ref-mention.png');
/* 用真实鼠标事件点选择器（合成 MouseEvent 缺 view 会让 d3-drag 的 Pp(event.view) 抛错，
   那是测试脚本的问题，不是应用 bug） */
const itemPos = JSON.parse(await ev(`(() => {
  const el = document.querySelector('.oii-mention-item');
  if (!el) return 'null';
  const r = el.getBoundingClientRect();
  return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
})()`) || 'null');
check('拿到选择器项坐标', !!itemPos, JSON.stringify(itemPos));
if (itemPos) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: itemPos.x, y: itemPos.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: itemPos.x, y: itemPos.y, button: 'left', clickCount: 1 }, sessionId);
}
await sleep(500);
check('选择器项可点击插入', (await ev(`document.querySelector('.oii-node-video textarea')?.value || ''`)).includes('@图片1'));
check('选择器已关闭', !(await ev(`!!document.querySelector('.oii-mention')`)));

// mediaRefs 是否落库（自动保存）
await sleep(2500);
const c2 = (await api(`/api/canvases/${canvasId}`))?.data;
const j2 = typeof c2.canvas_json === 'string' ? JSON.parse(c2.canvas_json) : c2.canvas_json;
const vnode = (j2.nodes || []).find((n) => n.id === 'tvid');
check('mediaRefs 已随画布落库', Array.isArray(vnode?.data?.mediaRefs) && vnode.data.mediaRefs.length === 1,
  JSON.stringify(vnode?.data?.mediaRefs));
check('提示词已落库含 @图片1', String(vnode?.data?.prompt || '').includes('@图片1'), JSON.stringify(vnode?.data?.prompt));
console.log(`  [检查点3] 全部交互完成后异常数 = ${errors.length}`);

console.log('\nconsole 错误:', errors.length ? errors : '(无)');
check('无 console 报错', errors.length === 0);

// 清理临时画布
await api(`/api/canvases/${canvasId}`, 'DELETE');
const after = (await api('/api/canvases'))?.data || [];
check('临时画布已删除（用户数据零残留）', !after.some((c) => c.id === canvasId));

console.log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
if (browser) { try { process.kill(-browser.pid); } catch { try { browser.kill(); } catch { /* ignore */ } } }
process.exit(fail ? 1 : 0);
