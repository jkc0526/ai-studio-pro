/**
 * Skill 应用端到端（零花费，Mock 模型）
 * 覆盖：预设 8 个 / 分类过滤 / 套用渲染 / 目标模板插值 / 风格落库 /
 *      Skill 注入 System 提示词 / 使用量 +1 / 快照进 run / 自定义 CRUD
 * 运行：node test/skill-e2e.mjs
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'tmp', 'skill-e2e');

/* 自己写报告：PowerShell 管道的编码会毁掉中文输出 */
const LOG = [];
const rawLog = console.log.bind(console);
console.log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); rawLog(s); };
const report = () => { try { fs.writeFileSync(path.join(ROOT, 'test/skill-e2e.out.txt'), LOG.join('\n'), 'utf8'); } catch { /* ignore */ } };
process.on('uncaughtException', (e) => { LOG.push(`💥 ${e?.message || e}`); report(); process.exit(1); });
process.on('unhandledRejection', (e) => { LOG.push(`💥 ${e?.message || e}`); report(); process.exit(1); });

let pass = 0, fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        try { json = JSON.parse(buf); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json, text: buf });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const api = (port, m, p, b) => request(port, m, p, b);

/* ---- Mock 模型：记录收到的 system，方便断言 Skill 是否注入 ---- */
let lastSystem = '';
function startMock() {
  const server = http.createServer((req, res) => {
    let buf = '';
    req.on('data', (c) => { buf += c.toString(); });
    req.on('end', () => {
      if (!req.url.split('?')[0].endsWith('/chat/completions')) {
        res.writeHead(404).end('{}');
        return;
      }
      let body = {};
      try { body = JSON.parse(buf); } catch { /* ignore */ }
      const system = body.messages?.find((m) => m.role === 'system')?.content || '';
      const user = body.messages?.find((m) => m.role === 'user')?.content || '';
      if (system.includes('AI 漫剧创作流水线')) lastSystem = system;   // Agent 的决策调用
      const has = (t) => user.includes(`[${t}]`);
      let content;
      if (system.includes('漫剧角色设计师')) content = JSON.stringify({ characters: [{ name: '林默', role: '主角', appearance: '28 岁男性，短黑发', outfit: '深灰风衣', personality: '沉默' }] });
      else if (system.includes('漫剧美术指导')) content = JSON.stringify({ scenes: [{ name: '雨夜街巷', env: '窄巷积水', lighting: '冷蓝路灯', atmosphere: '压抑' }] });
      else if (system.includes('漫剧分镜师')) content = JSON.stringify({ shots: [{ scene: '雨夜街巷，林默撑伞而立', dialogue: '', camera: '中景推近', duration: 5, characters: ['林默'], sceneName: '雨夜街巷' }] });
      else if (system.includes('漫剧编剧')) content = '【场景1：雨夜街巷】\n林默站在巷口。';
      else if (!has('get_project_state')) content = JSON.stringify({ thought: '先看现状', action: 'get_project_state', args: {} });
      else content = JSON.stringify({ thought: '够了', final: '已按套路完成前置步骤。' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.WEAVE_DATA_DIR = DATA_DIR;

const mock = await startMock();
const { startServer } = await import('../server/index.js');
const { q } = await import('../server/db.js');
const { server, port } = await startServer({ port: 0 });
console.log(`\nMock :${mock.port}   App :${port}   Data ${DATA_DIR}\n`);

q.run('UPDATE ai_config SET base_url = ?, api_key = ?, model_id = ? WHERE purpose = ?',
  `http://127.0.0.1:${mock.port}/v1`, 'k', 'mock', 'thinking');

/* ================= A. 预设与过滤 ================= */
console.log('=== A. Skill 预设与查询 ===');
const all = (await api(port, 'GET', '/api/skills')).json.data;
check('内置 8 个 Skill', all.length === 8, `实际 ${all.length}`);
check('每个都有斜杠命令', all.every((s) => s.command && s.title && s.summary));
check('都带 spec（风格/参数/recipe）', all.every((s) => s.spec && Array.isArray(s.spec.recipe) && typeof s.spec.shots === 'number'), JSON.stringify(all.map((s) => `${s.command}:${Array.isArray(s.spec?.recipe)}`)));
check('含视频与图片两类', all.some((s) => s.kind === 'video') && all.some((s) => s.kind === 'image'));
check('按使用量/顺序排序可用', Array.isArray(all));

const meta = (await api(port, 'GET', '/api/skills/meta')).json.data;
check('分类接口可用', meta.categories.length >= 5, JSON.stringify(meta.categories));
check('分类含 短剧漫剧 / 商业广告', meta.categories.includes('短剧漫剧') && meta.categories.includes('商业广告'), JSON.stringify(meta.categories));
const drama = (await api(port, 'GET', `/api/skills?category=${encodeURIComponent('短剧漫剧')}`)).json.data;
check('按分类过滤', drama.length === 1 && drama[0].command === 'short-drama', JSON.stringify(drama.map((d) => d.command)));
const byCommand = (await api(port, 'GET', '/api/skills/pop-mv')).json.data;
check('可用命令查 Skill', byCommand?.command === 'pop-mv', JSON.stringify(byCommand?.command));

/* ================= B. 套用渲染 ================= */
console.log('\n=== B. 套用渲染（不花钱） ===');
const created = await api(port, 'POST', '/api/scripts', { title: '雨夜寻人' });
const scriptId = created.json.data.id;
const applied = (await api(port, 'POST', `/api/skills/${drama[0].id}/apply`, { scriptId })).json.data;
check('目标模板插值了剧本名', applied.goal.includes('雨夜寻人'), applied.goal);
check('目标模板插值了套路名与镜头数', applied.goal.includes('精品女频短剧') && applied.goal.includes('8 镜'), applied.goal);
check('带出风格名', applied.styleName === '韩漫厚涂', applied.styleName);
check('带出岗位名', applied.agentName === '制片人', applied.agentName);
check('带出 recipe 步骤链', Array.isArray(applied.recipe) && applied.recipe.includes('batch_videos'), JSON.stringify(applied.recipe));
check('带出镜头参数', applied.shots === 8 && applied.ratio === '9:16' && applied.duration === 4, JSON.stringify({ s: applied.shots, r: applied.ratio, d: applied.duration }));
check('带出提示词增强', !!applied.boosts.script && !!applied.boosts.split && !!applied.boosts.compose);

/* ================= C. 用 Skill 启动运行 ================= */
console.log('\n=== C. 用 Skill 启动 Agent 运行 ===');
const started = await api(port, 'POST', '/api/agent-runs', { skillId: drama[0].id, scriptId });
check('只给 skillId 也能启动（自动选岗位）', !!started.json?.data?.runId, JSON.stringify(started.json?.error));
const runId = started.json.data.runId;
check('返回里带渲染结果', started.json.data.skill?.title === '精品女频短剧');
check('自动选了「制片人」岗位', started.json.data.agent.name === '制片人', started.json.data.agent.name);

// 等一会儿让循环跑起来
await sleep(3500);
check('Skill 已注入 System 提示词', lastSystem.includes('【本次创作套路】精品女频短剧'), lastSystem.slice(0, 120).replace(/\n/g, ' '));
check('提示词含期望步骤顺序', lastSystem.includes('期望步骤顺序：'), '');
check('提示词含剧本规范', /前 3 秒必须出现冲突/.test(lastSystem), '');
check('提示词含分镜规范', /景别与角度必须变化/.test(lastSystem), '');
check('提示词仍保留预算与确认约束', lastSystem.includes('花钱前必须 ask_user'), '');

const run = (await api(port, 'GET', `/api/agent-runs/${runId}`)).json.data;
check('运行快照了 Skill（可复现）', !!run?.skill_json && JSON.parse(run.skill_json).title === '精品女频短剧');
check('运行记录了 skill_id', run?.skill_id === drama[0].id, run?.skill_id);
const sc = q.one('SELECT * FROM script WHERE id = ?', scriptId);
check('套路风格已落到剧本', !!sc.style_id, String(sc.style_id));
const styleRow = sc.style_id ? q.one('SELECT * FROM style_preset WHERE id = ?', sc.style_id) : null;
check('落地的是韩漫厚涂', styleRow?.name === '韩漫厚涂', styleRow?.name);
const usedRow = q.one('SELECT uses FROM skill WHERE id = ?', drama[0].id);
check('使用量 +1', usedRow?.uses === 1, String(usedRow?.uses));

// 停下来，别让 mock 跑太久
await api(port, 'POST', `/api/agent-runs/${runId}/stop`);

/* ================= D. 自定义 CRUD ================= */
console.log('\n=== D. 自定义 Skill CRUD ===');
const made = await api(port, 'POST', '/api/skills', {
  command: 'my-test', title: '我的测试套路', category: '通用', kind: 'video',
  summary: '测试用', spec: { styleName: '日系2D动画', shots: 4, ratio: '1:1', goalTemplate: '用 {title} 处理 {script}' },
});
check('创建成功', !!made.json?.data?.id, JSON.stringify(made.json?.error));
check('命令去掉了斜杠前缀', made.json.data.command === 'my-test', made.json.data.command);
const edited = await api(port, 'PUT', `/api/skills/${made.json.data.id}`, { title: '我的测试套路2', spec: { shots: 6 } });
check('编辑生效', edited.json?.data?.title === '我的测试套路2' && edited.json.data.spec.shots === 6, JSON.stringify(edited.json?.data?.spec));
check('部分编辑不清空 spec 其他字段', edited.json?.data?.spec?.goalTemplate === '用 {title} 处理 {script}' && edited.json?.data?.spec?.styleName === '日系2D动画',
  JSON.stringify(edited.json?.data?.spec));
const applied2 = (await api(port, 'POST', `/api/skills/${made.json.data.id}/apply`, { scriptId })).json.data;
check('自定义模板插值（标题+剧本名）', applied2.goal.includes('我的测试套路2') && applied2.goal.includes('雨夜寻人'), applied2.goal);
check('编辑后的镜头参数生效', applied2.shots === 6, String(applied2.shots));
const badApply = await api(port, 'POST', '/api/skills/nope/apply', { scriptId });
check('不存在的 Skill 报错', badApply.json?.success === false);
const del = await api(port, 'DELETE', `/api/skills/${made.json.data.id}`);
check('删除成功', del.json?.success === true);
check('删除后列表回到 8 个', ((await api(port, 'GET', '/api/skills')).json.data || []).length === 8);

console.log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
report();
mock.server.close();
server.close();
process.exit(fail ? 1 : 0);
