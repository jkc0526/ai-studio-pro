// 打开目标网站，截图 + 抓取布局结构（栏位、导航项、主要区域尺寸）
import fs from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const SITES = [
  { name: 'libtv', url: 'https://www.liblib.tv/' },
  { name: 'oiioii', url: 'https://www.oiioii.ai/' },
];

const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  }
};
await new Promise((r) => { ws.onopen = r; });

const ANALYSIS = `
(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 40 && r.height > 24 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.05; };
  const box = (el) => { const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      txt: (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 80) }; };
  const regions = [...document.querySelectorAll('header, nav, aside, main, footer, section, [class*=sidebar], [class*=panel], [class*=toolbar], [class*=drawer], [class*=timeline], [class*=shot], [class*=card]')]
    .filter(vis).slice(0, 40).map(box);
  const navItems = [...document.querySelectorAll('nav a, aside a, aside button, header button, [class*=tab], [role=tab], [class*=menu] a')]
    .filter(vis).slice(0, 40).map((el) => (el.innerText || el.getAttribute('title') || '').replace(/\\s+/g, ' ').slice(0, 30)).filter(Boolean);
  const buttons = [...document.querySelectorAll('button, a[class*=btn], [class*=button]')].filter(vis)
    .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').slice(0, 24)).filter((t) => t && t.length < 20).slice(0, 50);
  const inputs = [...document.querySelectorAll('input, textarea, select, [contenteditable=true]')].filter(vis)
    .slice(0, 20).map((el) => ({ tag: el.tagName.toLowerCase(), ph: el.placeholder || el.getAttribute('data-placeholder') || '', ...box(el) }));
  const images = document.querySelectorAll('img').length;
  return { title: document.title, url: location.href, regions, navItems, buttons, inputs, images,
    bodyText: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 1600) };
})()
`;

for (const site of SITES) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  console.log(`\n===== 打开 ${site.name}: ${site.url} =====`);
  try {
    await send('Page.navigate', { url: site.url }, sessionId);
  } catch (e) { console.log('导航失败:', e.message); continue; }
  await new Promise((r) => setTimeout(r, 9000));

  const r = await send('Runtime.evaluate', { expression: ANALYSIS, returnByValue: true }, sessionId);
  const data = r?.result?.value || {};
  fs.writeFileSync(`study-${site.name}.json`, JSON.stringify(data, null, 2), 'utf8');
  console.log('标题:', data.title, '|', data.url, '| 图片数:', data.images);
  console.log('导航项:', (data.navItems || []).join(' / '));
  console.log('按钮:', (data.buttons || []).slice(0, 30).join(' | '));
  console.log('输入框:', (data.inputs || []).map((i) => `${i.tag}(${i.ph})${i.w}x${i.h}@${i.x},${i.y}`).join(' ; '));
  console.log('主要区域:');
  for (const reg of (data.regions || []).slice(0, 14)) {
    console.log(`  ${reg.tag}.${reg.cls} ${reg.w}x${reg.h} @${reg.x},${reg.y} :: ${reg.txt}`);
  }
  console.log('正文摘要:\n' + (data.bodyText || '').split('\n').slice(0, 28).join('\n'));

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(`study-${site.name}.png`, Buffer.from(shot.data, 'base64'));
  console.log(`截图: study-${site.name}.png`);
  await send('Target.closeTarget', { targetId });
}
process.exit(0);
