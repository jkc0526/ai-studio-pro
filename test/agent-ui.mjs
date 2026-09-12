/**
 * Agent 应用 UI 验收（零花费：全部打 Mock 模型）
 *
 * 前置：系统 Edge 无头模式已开在 127.0.0.1:9222（见 skills/edge-cdp-ui-verify）
 * 流程：临时数据目录起服务（dist 产物）→ Mock 文本模型 → 造剧本 →
 *       CDP 打开「Agent 应用」→ 启动制片人 → 等 ask_user 确认卡 → 截图 →
 *       同意 → 等花钱闸门 → 拒绝 → 等完成 → 截图 + 断言
 * 运行：node test/agent-ui.mjs
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'tmp', 'agent-ui');
const APP_PORT = 8899;
const CDP = process.env.CDP || 'http://127.0.0.1:9222';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Mock 模型（与 agent-e2e 同一套决策脚本） ---------------- */
function agentDecision(prompt) {
  const has = (t) => prompt.includes(`[${t}]`);
  if (!has('get_project_state')) return { thought: '先看清剧本现状，再决定怎么做', action: 'get_project_state', args: {} };
  if (!has('write_script')) return { thought: '还没有正文，先写剧本', action: 'write_script', args: { 要求: '雨夜悬疑短剧，开头要有钩子' } };
  if (!has('extract_characters')) return { thought: '没有角色档案，先提取角色', action: 'extract_characters', args: {} };
  if (!has('split_shots')) return { thought: '拆成 4 个镜头，注意景别变化', action: 'split_shots', args: { 镜头数: 4 } };
  if (!has('ask_user')) return { thought: '出图要花钱，先问用户', action: 'ask_user', args: { 问题: '即将批量生成 4 张分镜图（消耗图像额度），是否继续？', 选项: ['同意，先出一张试试', '先不生成'] } };
  if (!has('generate_image')) return { thought: '用户已同意，先给镜头 1 出一张', action: 'generate_image', args: { 镜头序号: 1 } };
  return { thought: '按用户意见收尾', final: '已完成：剧本正文（雨夜悬疑）、1 个角色档案、4 镜分镜表；出图环节按你的意见中止，可随时继续。' };
}

function mockContent(system, user) {
  const sys = String(system || '');
  if (sys.includes('漫剧角色设计师')) return JSON.stringify({ characters: [{ name: '林默', role: '主角', appearance: '28 岁男性，短黑发，左眉尾一道浅疤，身形偏瘦', outfit: '深灰长风衣，黑色高领衫', personality: '沉默寡言但护短' }] });
  if (sys.includes('漫剧美术指导')) return JSON.stringify({ scenes: [{ name: '雨夜街巷', env: '青石板窄巷，两侧砖墙挂满褪色招牌，地面积水映着霓虹', lighting: '冷蓝路灯光', atmosphere: '压抑、孤寂' }] });
  if (sys.includes('漫剧分镜师')) {
    return JSON.stringify({ shots: [
      { scene: '雨夜街巷，林默撑黑伞立于积水中央，侧脸望向巷口', dialogue: '', camera: '中景，略低角度，缓慢推近', duration: 5, characters: ['林默'], sceneName: '雨夜街巷' },
      { scene: '林默手部特写，指尖捏着一张被雨水打湿的旧照片', dialogue: '', camera: '特写，微俯视', duration: 4, characters: ['林默'], sceneName: '雨夜街巷' },
      { scene: '巷口出现一道模糊人影，逆光只剩轮廓', dialogue: '林默：你终于来了。', camera: '全景，逆光剪影', duration: 5, characters: ['林默'], sceneName: '雨夜街巷' },
      { scene: '林默转身走入巷子深处，伞面在雨幕中渐远', dialogue: '', camera: '远景，固定机位', duration: 6, characters: ['林默'], sceneName: '雨夜街巷' },
    ] });
  }
  if (sys.includes('漫剧编剧')) return '【场景1：雨夜街巷】\n雨声密集。林默撑着黑伞站在巷口，手里捏着一张旧照片。\n林默：三年了，我总算找到这条巷子。\n【场景2：巷子深处】\n一道人影从逆光里走出来。\n人影：你来晚了。';
  if (sys.includes('绘图提示词专家')) return '雨夜街巷中林默撑伞侧身而立，冷蓝路灯光勾出轮廓，中景缓慢推近，画面高清，构图完整，无文字水印';
  return JSON.stringify(agentDecision(user));
}

function startMock() {
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c.toString(); });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/v1/chat/completions') {
        let body = {};
        try { body = JSON.parse(buf); } catch { /* ignore */ }
        const system = body.messages?.find((m) => m.role === 'system')?.content || '';
        const user = body.messages?.find((m) => m.role === 'user')?.content || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock', object: 'chat.completion', model: body.model || 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content: mockContent(system, user) }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/* ---------------- 服务端（临时数据目录 + dist 产物） ---------------- */
fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.WEAVE_DATA_DIR = DATA_DIR;
process.env.PORT = String(APP_PORT);

const mock = await startMock();
const { startServer } = await import('../server/index.js');
const { q } = await import('../server/db.js');
const { server: app } = await startServer({ port: APP_PORT });
q.run('UPDATE ai_config SET base_url = ?, api_key = ?, model_id = ? WHERE purpose = ?',
  `http://127.0.0.1:${mock.port}/v1`, 'test-key', 'mock-model', 'thinking');
q.run('UPDATE ai_config SET base_url = ?, api_key = ?, model_id = ? WHERE purpose = ?',
  `http://127.0.0.1:${mock.port}/v1`, 'test-key', 'mock-image', 'image_gen');
/* 注意：script 表主键是 TEXT id，node:sqlite 的 lastInsertRowid 是 rowid，不能混用 */
const scriptId = 'ui_test_script';
q.run('INSERT INTO script (id, project_id, title, content, create_time, update_time) VALUES (?,?,?,?,?,?)',
  scriptId, q.one('SELECT id FROM project LIMIT 1').id, '雨夜寻人', '', new Date().toISOString(), new Date().toISOString());
console.log(`\nMock 模型 :${mock.port}   应用 :${APP_PORT}   数据 ${DATA_DIR}\n`);

/* ---------------- CDP ---------------- */
const version = await fetch(`${CDP}/json/version`).then((r) => r.json());
const ws = new WebSocket(version.webSocketDebuggerUrl);
let mid = 0;
const pending = new Map();
const errors = [];
const send = (m, p = {}, s) => new Promise((res, rej) => {
  const id = ++mid; pending.set(id, { res, rej, m });
  ws.send(JSON.stringify({ id, method: m, params: p, sessionId: s }));
});
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej, m } = pending.get(msg.id); pending.delete(msg.id);
    if (msg.error) { console.error(`  [CDP 失败] ${m}: ${msg.error.message}`); rej(new Error(msg.error.message)); }
    else res(msg.result);
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push((msg.params.args || []).map((a) => a.value ?? '').join(' ').slice(0, 200));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description || '').slice(0, 240));
  }
};
await new Promise((r) => { ws.onopen = r; });
const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 960, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}` }, sessionId);
await sleep(4200);

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId))?.result?.value;
const shot = async (f) => {
  const s = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(f, Buffer.from(s.data, 'base64'));
  console.log('  截图:', f);
};
/* React 受控输入必须走原生 setter，否则 onChange 不触发（见 skills/edge-cdp-ui-verify） */
const setNative = (sel, v) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(v)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);

const clickNav = async (label) => {
  await ev(`[...document.querySelectorAll('.side-nav .side-item')].find(b=>b.innerText.includes(${JSON.stringify(label)}))?.click()`);
  await sleep(900);
};
const waitFor = async (expr, timeoutMs = 40000, step = 500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await ev(expr)) return true;
    await sleep(step);
  }
  return false;
};

/* ================= 验收开始 ================= */
console.log('=== 1. 名册页 ===');
await clickNav('Agent 应用');
check('顶栏标题', (await ev(`document.querySelector('.crumb')?.innerText`)) === 'Agent 应用',
  await ev(`document.querySelector('.crumb')?.innerText`));
check('名册 5 个预置岗位', await ev(`document.querySelectorAll('.ag-agent').length`) === 5,
  await ev(`document.querySelectorAll('.ag-agent').length`));
check('岗位徽标（全自动/需确认）', await ev(`document.querySelectorAll('.ag-badge.auto').length`) === 2
  && await ev(`document.querySelectorAll('.ag-badge.manual').length`) === 3);
check('岗位详情面板出现', !!await ev(`document.querySelector('.ag-agent-detail b')?.innerText`));
check('工具权限 chip 渲染', (await ev(`document.querySelectorAll('.ag-toolchip').length`)) >= 10);
check('启动台出现', await ev(`!!document.querySelector('.ag-launch textarea')`));
await shot('test/shot-agents-roster.png');

console.log('\n=== 2. 启动运行 → ask_user 确认卡 ===');
await setNative('.ag-launch textarea', '把这一章做成一集 4 镜的成片');
await ev(`[...document.querySelectorAll('button')].find(b=>b.innerText.includes('启动 Agent'))?.click()`);
check('时间线出现（控制台栏）', await waitFor(`!!document.querySelector('.ag-console')`, 15000));
check('ask_user 确认卡出现（花钱前挂起）', await waitFor(`!!document.querySelector('.ag-confirm')`, 45000));
check('确认卡是提问型', (await ev(`document.querySelector('.ag-confirm-head')?.innerText`) || '').includes('意见'));
check('快捷选项按钮渲染', (await ev(`document.querySelectorAll('.ag-confirm-opts button').length`)) >= 1);
check('时间线有思考气泡', (await ev(`document.querySelectorAll('.ag-step.thought').length`)) >= 3);
check('时间线有工具观察气泡', (await ev(`document.querySelectorAll('.ag-step.obs').length`)) >= 4);
check('状态为等待确认', ((await ev(`document.querySelector('.ag-console')?.innerText`)) || '').includes('等待确认'));
await shot('test/shot-agents-ask.png');

console.log('\n=== 3. 同意 → 花钱闸门 → 拒绝 ===');
await ev(`[...document.querySelectorAll('.ag-confirm-foot button')].find(b=>b.innerText.includes('同意继续'))?.click()`);
check('花钱闸门确认卡出现', await waitFor(`(document.querySelector('.ag-confirm-head')?.innerText||'').includes('花钱')`, 45000));
check('闸门卡显示工具名', (await ev(`document.querySelector('.ag-confirm-meta code')?.innerText`)) === 'generate_image');
await shot('test/shot-agents-gate.png');
await ev(`[...document.querySelectorAll('.ag-confirm-foot button')].find(b=>b.innerText.includes('拒绝'))?.click()`);
check('运行收敛为已完成', await waitFor(`(document.querySelector('.ag-console')?.innerText||'').includes('已完成')`, 45000));
check('交付总结气泡出现', await ev(`!!(document.querySelector('.ag-step.final') || document.querySelector('.ag-confirm'))`));
await shot('test/shot-agents-done.png');

console.log('\n=== 4. 数据一致性（后端视角） ===');
const shots = q.all('SELECT * FROM shot WHERE script_id = ? ORDER BY seq', scriptId);
check('分镜真实入库 4 镜', shots.length === 4, `实际 ${shots.length}`);
check('角色真实入库', q.all('SELECT * FROM character').length === 1);
const run = q.one('SELECT * FROM agent_run WHERE script_id = ?', scriptId);
check('运行落库且为 done', run?.status === 'done', run?.status);
const steps = q.all('SELECT * FROM agent_step WHERE run_id = ? ORDER BY seq', run.id);
check(`步骤落库（${steps.length} 步）`, steps.length >= 8, `${steps.length}`);
check('拒绝被记录为 skipped', steps.some((s) => s.status === 'skipped'));
check('零真实图像调用（Mock 无图像端点且被拒绝）', !steps.some((s) => s.tool === 'generate_image' && s.status === 'ok'));

console.log('\n=== 5. 刷新恢复（时间线可回放） ===');
await send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}` }, sessionId);
await sleep(4200);
await clickNav('Agent 应用');
check('刷新后自动接上时间线', await waitFor(`!!document.querySelector('.ag-console')`, 15000));
check('刷新后步骤完整回放', (await ev(`document.querySelectorAll('.ag-step').length`)) >= 6,
  await ev(`document.querySelectorAll('.ag-step').length`));
check('刷新后状态仍为已完成', (await ev(`document.querySelector('.ag-console')?.innerText`) || '').includes('已完成'));

console.log('\nconsole 错误:', errors.length ? errors.slice(0, 6) : '(无)');
check('无 console 报错', errors.length === 0);

console.log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
mock.server.close();
app.close();
process.exit(fail ? 1 : 0);
