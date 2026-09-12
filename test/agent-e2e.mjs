/**
 * Agent 应用端到端测试（零花费：全部打 Mock 模型）
 *
 * 覆盖：
 *   A) 直连模式：get_project_state → write_script → extract_characters → split_shots
 *      → ask_user（挂起）→ 用户答复 → generate_image（花钱闸门）→ 用户拒绝 → finish
 *   B) 二次运行：验证三个护栏（正文覆盖、角色重复、已有镜头重拆）都会拦住
 *      → generate_image 闸门 → 用户批准 → 真实执行（Mock 无图像端点，应记录为失败观察）
 *   C) SSE：订阅后先收到 snapshot，再收到增量 step 事件
 *
 * 运行：node test/agent-e2e.mjs
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'tmp', 'agent-e2e');

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- HTTP 小工具 ---------------- */
function request(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c.toString('utf-8'); });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { /* 非 JSON */ }
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const api = (port, method, p, body) => request(port, method, p, body);

/* ============================================================================
   Mock 模型：同一个端口同时充当「Agent 决策」与「拆镜/提角色/写剧本」的文本模型
   ============================================================================ */
let llmCalls = 0;
let imageCalls = 0;

function agentDecision(prompt) {
  const has = (t) => prompt.includes(`[${t}]`);
  if (!has('get_project_state')) return { thought: '先看清剧本现状', action: 'get_project_state', args: {} };
  if (!has('write_script')) return { thought: '还没有正文，先写剧本', action: 'write_script', args: { 要求: '雨夜悬疑短剧，开头要有钩子' } };
  if (!has('extract_characters')) return { thought: '没有角色档案，先提取', action: 'extract_characters', args: {} };
  if (!has('split_shots')) return { thought: '拆成 4 个镜头', action: 'split_shots', args: { 镜头数: 4 } };
  if (!has('ask_user')) {
    return { thought: '出图要花钱，先问用户', action: 'ask_user', args: { 问题: '即将生成 4 张分镜图，是否继续？', 选项: ['同意', '先不生成'] } };
  }
  if (!has('generate_image')) return { thought: '用户已同意，开始出图', action: 'generate_image', args: { 镜头序号: 1 } };
  return { thought: '目标已达成', final: '已完成：剧本正文、角色档案、4 镜分镜表；出图环节按用户意见中止。' };
}

function mockContent(system, user) {
  const sys = String(system || '');
  if (sys.includes('漫剧角色设计师')) {
    return JSON.stringify({ characters: [{ name: '林默', role: '主角', appearance: '28 岁男性，短黑发，左眉尾有一道浅疤，身形偏瘦', outfit: '深灰长风衣，黑色高领衫', personality: '沉默寡言但护短' }] });
  }
  if (sys.includes('漫剧美术指导')) {
    return JSON.stringify({ scenes: [{ name: '雨夜街巷', env: '青石板窄巷，两侧老式砖墙挂满褪色招牌，地面积水映着霓虹', lighting: '冷蓝路灯光，雨丝被侧光打亮', atmosphere: '压抑、孤寂' }] });
  }
  if (sys.includes('漫剧分镜师')) {
    const shots = [
      { scene: '雨夜街巷，林默撑黑伞立于积水中央，侧脸望向巷口，雨丝被路灯照出白色轨迹', dialogue: '', camera: '中景，略低角度，缓慢推近', duration: 5, characters: ['林默'], sceneName: '雨夜街巷' },
      { scene: '林默手部特写，指尖捏着一张被雨水打湿的旧照片', dialogue: '', camera: '特写，微俯视', duration: 4, characters: ['林默'], sceneName: '雨夜街巷' },
      { scene: '巷口出现一道模糊人影，逆光只剩轮廓', dialogue: '林默：你终于来了。', camera: '全景，逆光剪影', duration: 5, characters: ['林默'], sceneName: '雨夜街巷' },
      { scene: '林默转身走入巷子深处，伞面在雨幕中渐远', dialogue: '', camera: '远景，固定机位，留大量留白', duration: 6, characters: ['林默'], sceneName: '雨夜街巷' },
    ];
    return JSON.stringify({ shots });
  }
  if (sys.includes('漫剧编剧')) {
    return '【场景1：雨夜街巷】\n雨声密集。林默撑着黑伞站在巷口，手里捏着一张旧照片。\n林默：三年了，我总算找到这条巷子。\n【场景2：巷子深处】\n一道人影从逆光里走出来。\n人影：你来晚了。';
  }
  if (sys.includes('绘图提示词专家')) return '雨夜街巷中林默撑伞侧身而立，深灰风衣被雨水打湿，冷蓝路灯光勾出轮廓，中景略低角度缓慢推近，画面高清，构图完整，无文字水印';
  return JSON.stringify(agentDecision(user));
}

function startMockModel() {
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c.toString(); });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      if (url === '/v1/chat/completions') {
        llmCalls++;
        let body = {};
        try { body = JSON.parse(buf); } catch { /* ignore */ }
        const system = body.messages?.find((m) => m.role === 'system')?.content || '';
        const user = body.messages?.find((m) => m.role === 'user')?.content || '';
        const content = mockContent(system, user);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'mock', object: 'chat.completion', model: body.model || 'mock-model',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }));
        return;
      }
      if (url.includes('/images/generations')) {
        imageCalls++;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'mock: 本次测试不提供图像能力' } }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/* ---------------- SSE 采集 ---------------- */
function collectSSE(port, runId, out) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: `/api/agent-runs/${runId}/stream`, method: 'GET' }, (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString('utf-8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
          let event = 'message', dataStr = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (event === 'message' && !dataStr) continue;
          try { out.push({ event, data: JSON.parse(dataStr) }); } catch { /* ping */ }
        }
      });
      res.on('end', resolve);
    });
    req.on('error', () => resolve());
    req.end();
    out._close = () => { try { req.destroy(); } catch { /* ignore */ } };
  });
}

/* ---------------- 轮询到「挂起」或「终态」 ---------------- */
async function waitFor(port, runId, want, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const { json } = await api(port, 'GET', `/api/agent-runs/${runId}`);
    const run = json?.data;
    if (run && want(run)) return run;
    await sleep(120);
  }
  const { json } = await api(port, 'GET', `/api/agent-runs/${runId}`);
  throw new Error(`等待超时，当前状态：${json?.data?.status} / ${json?.data?.error || ''}`);
}

const isWaiting = (r) => r.status === 'waiting';
const isTerminal = (r) => ['done', 'failed', 'stopped'].includes(r.status);

/* ============================================================================
   主流程
   ============================================================================ */
(async () => {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  process.env.WEAVE_DATA_DIR = DATA_DIR;

  const mock = await startMockModel();
  // 必须在 import 服务端之前设置好数据目录（db.js 在模块加载时读环境变量）
  const { startServer } = await import('../server/index.js');
  const { q } = await import('../server/db.js');
  const { server, port } = await startServer({ port: 0 });

  console.log(`\nMock 模型 :${mock.port}    WeaveCanvas :${port}    数据目录 ${DATA_DIR}`);

  // 把文本模型指向 Mock
  q.run('UPDATE ai_config SET base_url = ?, api_key = ?, model_id = ? WHERE purpose = ?',
    `http://127.0.0.1:${mock.port}/v1`, 'test-key', 'mock-model', 'thinking');

  // 图像模型也指向 Mock：Mock 对 /images/generations 故意返回 500，
  // 用来验证「批准后真的发了请求」+「失败被记录成观察且不中断整个运行」。
  q.run('UPDATE ai_config SET base_url = ?, api_key = ?, model_id = ? WHERE purpose = ?',
    `http://127.0.0.1:${mock.port}/v1`, 'test-key', 'mock-image', 'image_gen');

  // 造一个剧本
  const created = await api(port, 'POST', '/api/scripts', { title: '雨夜寻人' });
  const scriptId = created.json.data.id;

  const agents = (await api(port, 'GET', '/api/agents')).json.data;
  console.log(`\n预置岗位：${agents.map((a) => `${a.name}(${a.tools.length} 工具${a.auto_run ? '·全自动' : '·需确认'})`).join('、')}`);
  check('预置 5 个岗位', agents.length === 5, `实际 ${agents.length}`);
  check('制片人默认非全自动', agents.find((a) => a.name === '制片人')?.auto_run === 0);
  check('美术指导也非全自动（带图像工具）', agents.find((a) => a.name === '美术指导')?.auto_run === 0);
  const producer = agents.find((a) => a.name === '制片人');

  /* ==================== A. 主链路 + 挂起/答复 + 拒绝闸门 ==================== */
  console.log('\n=== A. 主链路：拆镜全自动 → ask_user 挂起 → 拒绝花钱操作 → 完成 ===');
  const sseEvents = [];
  const started = await api(port, 'POST', '/api/agent-runs', {
    agentId: producer.id, scriptId, goal: '把这一章做成一集 4 镜的成片',
  });
  check('启动运行返回 runId', !!started.json?.data?.runId);
  const runId = started.json.data.runId;
  collectSSE(port, runId, sseEvents);

  // A1：第一次挂起应为 ask_user
  let run = await waitFor(port, runId, isWaiting);
  check('① 运行进入 waiting（ask_user 挂起）', run.status === 'waiting');
  const askStep = run.steps.find((s) => s.role === 'ask' && s.tool === 'ask_user');
  check('② 挂起步骤落库且标记 pending_confirmation', !!askStep && askStep.status === 'pending_confirmation', askStep?.status);

  // 挂起期间已完成的文本链路
  const toolsUsed = run.steps.filter((s) => s.role === 'observation').map((s) => s.tool);
  check('③ 挂起前已跑完 get_project_state', toolsUsed.includes('get_project_state'), toolsUsed.join(','));
  check('④ 挂起前已跑完 write_script', toolsUsed.includes('write_script'));
  check('⑤ 挂起前已跑完 extract_characters', toolsUsed.includes('extract_characters'));
  check('⑥ 挂起前已跑完 split_shots', toolsUsed.includes('split_shots'));

  const sc = q.one('SELECT * FROM script WHERE id = ?', scriptId);
  check('⑦ 剧本正文真实写入', (sc.content || '').includes('林默'), `${(sc.content || '').length} 字`);
  check('⑧ 角色真实入库', q.all('SELECT * FROM character').length === 1);
  const shots = q.all('SELECT * FROM shot WHERE script_id = ? ORDER BY seq', scriptId);
  check('⑨ 分镜真实入库且为 4 镜', shots.length === 4, `实际 ${shots.length}`);
  check('⑩ 镜头时长/运镜/出镜角色落库', shots[0]?.duration === 5 && !!shots[0]?.camera && JSON.parse(shots[0]?.character_ids || '[]').length === 1);
  check('⑪ 挂起时没有任何图像调用', imageCalls === 0, `imageCalls=${imageCalls}`);

  // A2：答复 ask_user
  await api(port, 'POST', `/api/agent-runs/${runId}/resume`, { approved: true, note: '同意，但先只出一张试试' });
  // A3：第二次挂起应为 generate_image 的确认闸门
  run = await waitFor(port, runId, (r) => r.status === 'waiting' && r.steps.some((s) => s.role === 'ask' && s.tool === 'generate_image'));
  const gate = run.steps.filter((s) => s.role === 'ask' && s.tool === 'generate_image').pop();
  check('⑫ ask_user 答复后继续，命中花钱闸门', !!gate);
  check('⑬ 闸门步骤挂起时仍未调用图像接口', imageCalls === 0, `imageCalls=${imageCalls}`);

  // A4：拒绝
  await api(port, 'POST', `/api/agent-runs/${runId}/resume`, { approved: false, note: '太贵了，先别生成' });
  run = await waitFor(port, runId, isTerminal);
  check('⑭ 拒绝后运行正常结束（done）', run.status === 'done', `${run.status} / ${run.error || ''}`);
  const rejected = run.steps.find((s) => s.tool === 'generate_image' && s.status === 'skipped');
  check('⑮ 拒绝被记录为 skipped', !!rejected);
  check('⑯ 拒绝后依旧零图像调用', imageCalls === 0, `imageCalls=${imageCalls}`);
  check('⑰ finish 步骤落库', run.steps.some((s) => s.role === 'final'));
  check('⑱ 预算统计已落库', (run.cost?.images ?? -1) === 0 && (run.cost?.llmCalls ?? 0) > 0, JSON.stringify(run.cost));

  await sleep(300);
  check('⑲ SSE 收到 snapshot 快照', sseEvents.some((e) => e.event === 'snapshot'));
  check('⑳ SSE 收到增量 step 事件', sseEvents.filter((e) => e.event === 'step').length >= 5, `${sseEvents.filter((e) => e.event === 'step').length} 条`);
  check('㉑ SSE 收到 done 事件', sseEvents.some((e) => e.event === 'done'));
  sseEvents._close?.();

  /* ==================== B. 护栏 + 批准闸门 ==================== */
  console.log('\n=== B. 二次运行：三道护栏是否拦住 + 批准后真实执行 ===');
  const sseEvents2 = [];
  const started2 = await api(port, 'POST', '/api/agent-runs', { agentId: producer.id, scriptId, goal: '重新按 4 镜来一版并出图' });
  const runId2 = started2.json.data.runId;
  collectSSE(port, runId2, sseEvents2);

  let run2 = await waitFor(port, runId2, (r) => r.status === 'waiting' && r.steps.some((s) => s.role === 'ask' && s.tool === 'ask_user'), 40000);
  const briefOf = (t) => run2.steps.filter((s) => s.tool === t).map((s) => s.result?.brief || '').join(' / ');
  check('㉒ 护栏：已有正文时拒绝无脑覆盖', /已有正文/.test(briefOf('write_script')), briefOf('write_script'));
  check('㉓ 护栏：已有镜头时要求显式指定模式', /未指定模式/.test(briefOf('split_shots')), briefOf('split_shots'));
  check('㉔ 护栏：角色已存在时不重复创建', q.all('SELECT * FROM character').length === 1);
  check('㉕ 镜头数未被改动（护栏生效）', q.all('SELECT * FROM shot WHERE script_id = ?', scriptId).length === 4);
  check('㉖ 挂起时仍未调用图像接口', imageCalls === 0, `imageCalls=${imageCalls}`);

  // 答复 ask_user → 继续 → 命中花钱闸门
  await api(port, 'POST', `/api/agent-runs/${runId2}/resume`, { approved: true, note: '同意出图' });
  run2 = await waitFor(port, runId2, (r) => r.status === 'waiting' && r.steps.some((s) => s.role === 'ask' && s.tool === 'generate_image'), 40000);
  check('㉗ 命中花钱闸门且仍未真正出图', imageCalls === 0, `imageCalls=${imageCalls}`);

  // 批准 → 真实执行 → Mock 无图像端点 → 记录失败观察但不中断
  await api(port, 'POST', `/api/agent-runs/${runId2}/resume`, { approved: true, note: '同意出图' });
  run2 = await waitFor(port, runId2, isTerminal, 40000);
  check('㉘ 批准后真实调用了图像接口', imageCalls > 0, `imageCalls=${imageCalls}`);
  const imgSteps = run2.steps.filter((s) => s.tool === 'generate_image');
  check('㉙ 图像失败被记录为 error 观察（不中断运行）', imgSteps.some((s) => s.status === 'error'), JSON.stringify(imgSteps.map((s) => s.status)));
  check('㉚ 失败后运行仍正常收敛', ['done', 'stopped'].includes(run2.status), `${run2.status} / ${run2.error || ''}`);
  check('㉛ 步骤可完整回读（刷新可续上）', run2.steps.length >= 6, `${run2.steps.length} 步`);
  sseEvents2._close?.();

  /* ==================== C. 权限白名单 + 名册 CRUD ==================== */
  console.log('\n=== C. 权限白名单 + 名册 CRUD ===');
  const made = await api(port, 'POST', '/api/agents', {
    name: '只读观察员', role: '测试', tools: ['get_project_state', 'finish'], auto_run: true,
    budget: { maxSteps: 6, maxImages: 1, maxVideos: 1, deadlineSec: 60 },
  });
  check('㉛ 新建岗位成功', !!made.json?.data?.id);
  check('㉜ 工具白名单已落库', (made.json?.data?.tools || []).length === 2);
  const edited = await api(port, 'PUT', `/api/agents/${made.json.data.id}`, { name: '只读观察员改', tools: ['get_project_state'], budget: { maxSteps: 4 } });
  check('㉝ 改名与改权限生效', edited.json?.data?.name === '只读观察员改' && edited.json.data.tools.length === 1);
  check('㉞ 预算合并默认值', edited.json?.data?.budget?.maxImages === 12 && edited.json.data.budget.maxSteps === 4, JSON.stringify(edited.json?.data?.budget));

  const sseEvents3 = [];
  const imgCallsBefore3 = imageCalls;
  const started3 = await api(port, 'POST', '/api/agent-runs', { agentId: made.json.data.id, scriptId, goal: '越权测试' });
  const runId3 = started3.json.data.runId;
  collectSSE(port, runId3, sseEvents3);
  const run3 = await waitFor(port, runId3, isTerminal, 30000);
  const denied = run3.steps.find((s) => s.role === 'system' && /权限/.test(s.result?.text || s.result?.brief || ''));
  check('㉟ 权限白名单拦截越权工具并提示模型', !!denied, run3.steps.filter((s) => s.role === 'system').map((s) => s.result?.brief).join(' | '));
  check('㊱ 被拦后运行收敛为 stopped（未空转烧钱）', run3.status === 'stopped', run3.status);
  check('㊲ 越权期间零图像调用', imageCalls === imgCallsBefore3, `before=${imgCallsBefore3} after=${imageCalls}`);
  sseEvents3._close?.();

  const toolsCatalog = (await api(port, 'GET', '/api/agents/tools')).json.data;
  check('㊳ 工具清单接口可用', Object.values(toolsCatalog).flat().length >= 14, `${Object.values(toolsCatalog).flat().length} 个`);
  // 真实清单：image 域 5 个（单镜图 / 多版本 / 批量镜 / 角色三视图 / 场景设定图），
  //           video 域 2 个（批量图生视频 + 成片导出，后者 kind=read 不吃额度、不过闸门）
  check('㊴ 工具按 kind 分组正确', (toolsCatalog.image || []).length >= 5 && (toolsCatalog.video || []).length >= 2,
    `image=${toolsCatalog.image?.length} video=${toolsCatalog.video?.length}`);
  const badAgent = await api(port, 'POST', '/api/agent-runs', { agentId: 'nope', scriptId, goal: 'x' });
  check('㊵ 不存在的 Agent 会报错', badAgent.json?.success === false);
  const del = await api(port, 'DELETE', `/api/agents/${made.json.data.id}`);
  check('㊶ 删除岗位成功', del.json?.success === true);

  const list = (await api(port, 'GET', '/api/agent-runs?scriptId=' + scriptId)).json.data;
  check('㊷ 运行历史可列出', list.length === 3, `${list.length} 条`);

  console.log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败  (LLM 调用 ${llmCalls} 次，图像调用 ${imageCalls} 次) ===`);
  mock.server.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('\n💥 测试异常终止：', e);
  process.exit(1);
});
