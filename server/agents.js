import { q, uid, now } from './db.js';
import { callLLM } from './ai.js';
import * as pipeline from './pipeline.js';
import { TOOLS, ALWAYS_ALLOWED, toolCatalog } from './tools.js';
import { skillSystemBlock, renderSkill, bumpUsage } from './skills.js';

/* ============================================================================
   Agent 编排引擎
   设计要点（见 docs/v0.6-Agent应用-实施方案.md）：
   1. 不做原生 function calling —— endpoint.js 没有 tools 字段透传，
      走提示词约定 + JSON 决策，解析复用 pipeline 里已处理过截断的那些函数。
   2. 全状态落库（agent_run.context_json / agent_step），刷新浏览器或重启服务都能续上。
   3. 花钱的工具默认必须人工确认；预算三重上限 + 截止时间，触顶软停止、保留现场。
   ============================================================================ */

const DEFAULT_BUDGET = { maxSteps: 30, maxImages: 12, maxVideos: 10, deadlineSec: 1800 };
const MAX_FIX = 3;          // 连续解析/决策失败多少次就停
const HISTORY_FULL = 8;     // 最近 N 步回灌完整观察，更早的只留摘要
const OBS_LIMIT = 1800;     // 单条观察回灌上限（字符）

/* ---------------- 事件流（SSE） ---------------- */
const streams = new Map();  // runId -> Set<res>
export function subscribe(runId, res) {
  if (!streams.has(runId)) streams.set(runId, new Set());
  streams.get(runId).add(res);
  return () => { streams.get(runId)?.delete(res); };
}
function emit(runId, event, data) {
  const set = streams.get(runId);
  if (!set?.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { try { res.write(payload); } catch { /* 客户端已断开 */ } }
}

/* ---------------- 挂起 / 唤醒 ---------------- */
const waiters = new Map();   // runId -> resolve(answer)
const stopped = new Set();

const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

const loadRun = (id) => (id ? q.one('SELECT * FROM agent_run WHERE id = ?', id) : null);
/* 注意：id 为空时必须短路返回 null —— node:sqlite 不允许把 undefined 绑到参数上，
   否则「只选 Skill 不选岗位」的场景会直接抛 ERR_INVALID_ARG_TYPE */
const loadAgent = (id) => (id ? q.one('SELECT * FROM agent WHERE id = ?', id) : null);

const nextSeq = (runId) =>
  (q.one('SELECT COALESCE(MAX(seq),0) m FROM agent_step WHERE run_id = ?', runId)?.m || 0) + 1;

function addStep(runId, seq, { role, tool = null, args = null, brief = '', text = '', data = null, status = 'ok', error = null, ms = null }) {
  q.run(`INSERT INTO agent_step (id, run_id, seq, role, tool, args_json, result_json, tokens, ms, status, error, create_time)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    uid('ast'), runId, seq, role, tool,
    args ? JSON.stringify(args) : null,
    brief || text || data ? JSON.stringify({ brief, text: clip(text, 4000), data }) : null,
    null, ms, status, error, now());
  return seq;
}

function setStatus(runId, status, error = null) {
  q.run('UPDATE agent_run SET status = ?, error = ?, update_time = ? WHERE id = ?', status, error, now(), runId);
}

function saveContext(runId, { history, cost, pending, startedAt }) {
  q.run(`UPDATE agent_run SET context_json = ?, cost_json = ?, step_count = ?, update_time = ? WHERE id = ?`,
    JSON.stringify({ history, pending: pending || null, startedAt }),
    JSON.stringify(cost),
    history.filter((h) => h.role !== 'system').length,
    now(), runId);
}

/* ---------------- 决策解析 ---------------- */
export function parseDecision(text) {
  const s = String(text || '').trim();
  if (!s) throw new Error('模型返回空内容');
  let obj = null;
  try { obj = pipeline.parseJsonLoose(s); } catch { /* 走兜底 */ }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    const objs = pipeline.extractObjects(s);
    obj = [...objs].reverse().find((o) => o && (o.action || o.final || o.thought)) || null;
  }
  if (!obj) throw new Error(`模型没有输出可解析的 JSON 决策：${clip(s, 200)}`);
  return {
    thought: String(obj.thought ?? obj.思考 ?? '').trim(),
    action: String(obj.action ?? obj.动作 ?? obj.tool ?? '').trim(),
    args: (obj.args && typeof obj.args === 'object') ? obj.args : {},
    final: obj.final ?? obj.总结 ?? null,
  };
}

/* ---------------- 上下文拼装 ---------------- */
function buildSystem(agent, allowed, budget, skill = null) {
  return `你是「${agent.name}」，在 WeaveCanvas（AI 漫剧创作流水线）里担任${agent.role}。

【你的岗位设定】
${agent.system_prompt || '（未设置，请按岗位名尽职）'}
${skillSystemBlock(skill)}
【输出格式｜严格遵守】
你每一轮只能输出一个 JSON 对象，且只能输出 JSON，不要任何解释文字，不要 markdown 代码块。
要调用工具时输出：
{"thought":"一句话说明这一步为什么这么做","action":"工具名","args":{...}}
任务完成时输出：
{"thought":"...","final":"给用户的交付总结"}

【可用工具】
${toolCatalog(allowed)}

【硬性规则】
1. 每轮只调用一个工具；args 必须符合该工具的参数说明，参数名用中文原名。
2. action 必须是上面列出的工具名之一，不要自创工具，也不要臆造参数。
3. 不确定现状时先调用 get_project_state，不要凭记忆假设数据已存在。
4. 不要做重复劳动：已存在的角色、场景、镜头不要重复生成。
5. 花钱的操作（图像类/视频类工具）、覆盖已有剧本正文、重拆已有镜头，必须先调用 ask_user 取得用户同意。
6. 需要用户拍板、补充信息或遇到无法自行决定的选择时，用 ask_user；真正完成目标时才用 finish。
7. 你的每一次工具调用都会产生真实数据或真实花费，请高效推进，不要空转。

【预算上限】${budget.maxSteps} 步 · 生成 ${budget.maxImages} 张图 · ${budget.maxVideos} 条视频 · ${Math.round(budget.deadlineSec / 60)} 分钟`;
}

function renderHistory(history) {
  if (!history.length) return '（这是第一步）';
  return history.map((h, i) => {
    const recent = i >= history.length - HISTORY_FULL;
    if (h.role === 'thought') return `${h.seq}. [思考] ${clip(h.text, 200)}`;
    if (h.role === 'system') return `${h.seq}. [系统提示] ${clip(h.text, 300)}`;
    const head = `${h.seq}. [${h.tool || '工具'}] ${h.brief || ''}`;
    return recent ? `${head}\n    结果：${clip(h.text, OBS_LIMIT)}` : `${head}（已完成）`;
  }).join('\n');
}

function buildUser({ goal, script, cost, budget, history, lastError }) {
  return [
    `【本次目标】${goal}`,
    `【当前剧本】《${script?.title || '未命名'}》`,
    `【预算使用】已 ${history.filter((h) => h.role === 'observation').length}/${budget.maxSteps} 步 · 已出图 ${cost.images}/${budget.maxImages} 张 · 已出片 ${cost.videos}/${budget.maxVideos} 条`,
    lastError ? `【上一轮失败原因，请避免重复】${lastError}` : '',
    `【最近执行记录】\n${renderHistory(history)}`,
    '请输出你的下一个 JSON 决策。',
  ].filter(Boolean).join('\n\n');
}

/* ---------------- 单步决策 ---------------- */
async function decide({ agent, allowed, budget, goal, script, cost, history, lastError, skill }) {
  const cfg = q.one('SELECT * FROM ai_config WHERE purpose = ?', 'thinking');
  if (!cfg) throw new Error('没有找到文本模型配置，请先到「设置」里配置');
  const r = await callLLM(cfg, {
    model: agent.model_id || undefined,
    system: buildSystem(agent, allowed, budget, skill),
    user: buildUser({ goal, script, cost, budget, history, lastError }),
    maxTokens: 1600,
  });
  return { ...parseDecision(r.text), _raw: r.text, _model: r.model, _usage: r.usage };
}

/* ---------------- 确认闸门 ---------------- */
const SPENDS = (tool) => TOOLS[tool] && (TOOLS[tool].kind === 'image' || TOOLS[tool].kind === 'video');

function confirmPreview(tool, args) {
  const label = { generate_image: '生成 1 张分镜图', generate_variants: `生成 ${args?.版本数 || 2} 个版本（约 ${args?.版本数 || 2} 张图）`, batch_images: '批量生成分镜图', batch_videos: '批量图生视频', generate_character_sheets: '生成角色三视图', generate_scene_image: '生成场景概念图' }[tool] || tool;
  return `${label}${args?.['镜头序号'] ? `（镜头 ${[].concat(args['镜头序号']).join('、')}）` : ''}`;
}

/* ---------------- 执行工具 ---------------- */
async function execTool(toolName, args, ctx) {
  const tool = TOOLS[toolName];
  if (!tool?.run) throw new Error(`工具「${toolName}」不可执行`);
  const t0 = Date.now();
  const res = await tool.run(args || {}, ctx);
  return { ...res, ms: Date.now() - t0 };
}

/* ============================================================================
   主循环
   ============================================================================ */
async function drive(runId, input = null) {
  const run0 = loadRun(runId);
  if (!run0) return;
  if (!['running', 'waiting'].includes(run0.status)) return;

  const agent = loadAgent(run0.agent_id);
  if (!agent) { setStatus(runId, 'failed', 'Agent 不存在'); emit(runId, 'fatal', { message: 'Agent 不存在' }); return; }

  const store0 = JSON.parse(run0.context_json || '{}');
  const history = store0.history || [];
  const cost = { images: 0, videos: 0, llmCalls: 0, ...(JSON.parse(run0.cost_json || '{}')) };
  const startedAt = store0.startedAt || Date.now();
  let pending = store0.pending || null;
  let fixCount = 0;       // 连续「无法解析 / 越权」次数，超阈值软停止，避免空转烧 token
  let lastError = null;

  const allowList = [...new Set([...(JSON.parse(agent.tools_json || '[]')), ...ALWAYS_ALLOWED])]
    .filter((n) => TOOLS[n]);
  const budget = { ...DEFAULT_BUDGET, ...(JSON.parse(agent.budget_json || '{}')) };
  /* Skill 套路：启动时快照进 agent_run，历史运行可复现（Skill 后续被改不影响旧记录） */
  const skill = run0.skill_json ? JSON.parse(run0.skill_json) : null;

  const ctx = {
    scriptId: run0.script_id,
    script: () => q.one('SELECT * FROM script WHERE id = ?', run0.script_id),
    agent,
    styleId: null,
    modelId: agent.model_id || undefined,
    imageModelId: undefined,
    videoModelId: undefined,
    emit: (p) => emit(runId, 'step', { seq: 'progress', role: 'progress', ...p }),
    spend: (field, n = 1) => { cost[field] = (cost[field] || 0) + n; },
  };

  const persist = () => saveContext(runId, { history, cost, pending, startedAt });
  const abortReason = () => {
    if (stopped.has(runId)) { stopped.delete(runId); return '用户手动停止'; }
    return '用户长时间未确认，运行已自动结束';
  };
  const pause = async (p) => {
    pending = p;
    persist();
    setStatus(runId, 'waiting');
    emit(runId, 'ask', { ...p, seq: nextSeq(runId) });
    const answer = await new Promise((resolve) => {
      waiters.set(runId, resolve);
      // 兜底：极端情况下 30 分钟无人应答则自动结束，避免常驻内存
      setTimeout(() => { if (waiters.get(runId) === resolve) { waiters.delete(runId); resolve(null); } }, 30 * 60 * 1000);
    });
    waiters.delete(runId);
    if (!answer) return null;
    setStatus(runId, 'running');
    return answer;
  };
  const softStop = (reason) => {
    setStatus(runId, 'stopped', reason);
    emit(runId, 'done', { status: 'stopped', summary: reason, cost, artifacts: collectArtifacts(run0.script_id) });
  };

  /* 执行工具 → 成功/失败一律落成一条观察。
     花钱的闸门分支与普通分支共用这一条路径，保证「任意一次工具失败」
     只是丢掉一步，而不会把整个运行打挂（失败会回灌给模型让它自己想办法）。 */
  const runToolStep = async (tool, args) => {
    try {
      const res = await execTool(tool, args, ctx);
      const seq = nextSeq(runId);
      addStep(runId, seq, { role: 'observation', tool, args, brief: res.brief, text: res.text, data: res.data, ms: res.ms });
      history.push({ seq, role: 'observation', tool, brief: res.brief, text: res.text });
      emit(runId, 'step', { seq, role: 'observation', tool, brief: res.brief, data: res.data, ms: res.ms, status: 'ok' });
      emit(runId, 'budget', { ...cost, steps: history.filter((h) => h.role === 'observation').length });
      fixCount = 0; lastError = null;
      persist();
      return true;
    } catch (e) {
      const seq = nextSeq(runId);
      const msg = `工具 ${tool} 执行失败：${e.message}。你可以重试一次，或者换一种方式。`;
      const brief = `执行失败：${clip(e.message, 80)}`;
      addStep(runId, seq, { role: 'observation', tool, args, status: 'error', brief, text: msg });
      history.push({ seq, role: 'observation', tool, brief, text: msg });
      emit(runId, 'step', { seq, role: 'observation', tool, brief, status: 'error' });
      persist();
      return false;
    }
  };

  try {
    /* ── 阶段一：处理上一次挂起 ── */
    if (pending) {
      if (!input) {
        // 冷启动重新挂起（服务重启后客户端再次订阅时）
        const answer = await pause(pending);
        if (!answer) { softStop(abortReason()); return; }
        input = answer;
      }
      const seq = nextSeq(runId);
      if (pending.type === 'ask') {
        const answerText = String(input.note || (input.approved ? '同意' : '不同意')).trim();
        addStep(runId, seq, { role: 'observation', tool: 'ask_user', brief: `用户答复：${clip(answerText, 60)}`, text: `用户答复：${answerText}` });
        history.push({ seq, role: 'observation', tool: 'ask_user', brief: `用户答复：${clip(answerText, 60)}`, text: `用户答复：${answerText}` });
        emit(runId, 'step', { seq, role: 'observation', tool: 'ask_user', brief: `用户答复：${clip(answerText, 60)}`, status: 'ok' });
        pending = null; persist();
      } else if (pending.type === 'confirm') {
        if (!input.approved) {
          const note = String(input.note || '用户拒绝了这次操作');
          const text = `用户拒绝执行 ${pending.tool}。原因：${note}。请换一种做法，不要重复请求同一操作。`;
          addStep(runId, seq, { role: 'observation', tool: pending.tool, status: 'skipped', brief: `用户拒绝：${clip(note, 60)}`, text });
          history.push({ seq, role: 'observation', tool: pending.tool, brief: `用户拒绝：${clip(note, 60)}`, text });
          emit(runId, 'step', { seq, role: 'observation', tool: pending.tool, brief: `用户拒绝：${clip(note, 60)}`, status: 'skipped' });
          pending = null; persist();
        } else {
          // 已批准 → 直接执行，不再问模型。先清 pending 再执行，失败也不重复追问
          const { tool, args } = pending;
          pending = null;
          await runToolStep(tool, args);
        }
      }
    }

    /* ── 阶段二：决策循环 ──
       注意：fixCount / lastError 沿用函数顶层的声明（第 184-185 行）。
       runToolStep 成功后会把 fixCount 清零，如果在这里重新 let 一个同名变量，
       会遮蔽外层——护栏读到的是内层计数，永远清不掉，导致「间歇性解析失败
       夹杂成功步骤」的场景被误判为连续失败而软停止。 */
    while (true) {
      if (stopped.has(runId)) { stopped.delete(runId); softStop('用户手动停止'); return; }
      const steps = history.filter((h) => h.role === 'observation').length;
      if (steps >= budget.maxSteps) { softStop(`步数已达上限（${budget.maxSteps} 步），已保留现场，可调整预算后继续`); return; }
      if (cost.images >= budget.maxImages) { softStop(`生图数量已达上限（${budget.maxImages} 张）`); return; }
      if (cost.videos >= budget.maxVideos) { softStop(`生视频数量已达上限（${budget.maxVideos} 条）`); return; }
      if (Date.now() - startedAt > budget.deadlineSec * 1000) { softStop(`运行超过 ${Math.round(budget.deadlineSec / 60)} 分钟，已自动停止`); return; }
      if (fixCount >= MAX_FIX) { softStop(`连续 ${MAX_FIX} 次无法解析模型的决策，已停止。建议换一个指令遵循能力更强的文本模型`); return; }

      let decision;
      try {
        decision = await decide({ agent, allowed: allowList, budget, goal: run0.goal, script: ctx.script(), cost, history, lastError, skill });
      } catch (e) {
        fixCount++;
        lastError = e.message;
        const seq = nextSeq(runId);
        addStep(runId, seq, { role: 'system', status: 'error', brief: `决策失败：${clip(e.message, 80)}`, text: `你的上一条输出无法解析（${e.message}）。请严格只输出一个 JSON 对象，格式：{"thought":"...","action":"工具名","args":{...}}` });
        history.push({ seq, role: 'system', text: `你的上一条输出无法解析（${e.message}）。请严格只输出一个 JSON 对象，格式：{"thought":"...","action":"工具名","args":{...}}` });
        emit(runId, 'step', { seq, role: 'system', brief: `决策失败：${clip(e.message, 80)}`, status: 'error' });
        persist();
        continue;
      }

      if (decision.thought) {
        const seq = nextSeq(runId);
        addStep(runId, seq, { role: 'thought', brief: decision.thought, text: decision.thought });
        history.push({ seq, role: 'thought', text: decision.thought });
        emit(runId, 'step', { seq, role: 'thought', brief: decision.thought, status: 'ok' });
        persist();
      }

      /* 结束 */
      if (!decision.action || decision.action === 'finish') {
        const summary = String(decision.final || decision.args?.总结 || decision.thought || '任务已完成').trim();
        const seq = nextSeq(runId);
        addStep(runId, seq, { role: 'final', brief: clip(summary, 120), text: summary });
        persist();
        setStatus(runId, 'done');
        emit(runId, 'done', {
          status: 'done', summary, seq,
          artifacts: collectArtifacts(run0.script_id),
          cost,
        });
        return;
      }

      /* 工具校验 */
      if (!TOOLS[decision.action]) {
        fixCount++;
        lastError = `不存在名为「${decision.action}」的工具`;
        const seq = nextSeq(runId);
        const msg = `你调用了不存在的工具「${decision.action}」。可用的工具只有：${allowList.join('、')}。请重新输出 JSON 决策。`;
        addStep(runId, seq, { role: 'system', status: 'error', brief: clip(msg, 80), text: msg });
        history.push({ seq, role: 'system', text: msg });
        emit(runId, 'step', { seq, role: 'system', brief: clip(msg, 80), status: 'error' });
        persist();
        continue;
      }
      if (!allowList.includes(decision.action)) {
        fixCount++;
        const seq = nextSeq(runId);
        const msg = `工具「${decision.action}」不在你的权限范围内，你没有权限调用它。当前岗位可用的工具：${allowList.join('、')}。如果需要这项能力，请用 ask_user 告知用户。`;
        addStep(runId, seq, { role: 'system', status: 'error', brief: clip(msg, 80), text: msg });
        history.push({ seq, role: 'system', text: msg });
        emit(runId, 'step', { seq, role: 'system', brief: clip(msg, 80), status: 'error' });
        persist();
        continue;
      }

      /* 主动求助/请求确认 */
      if (decision.action === 'ask_user') {
        const question = String(decision.args?.问题 || decision.args?.question || '请确认是否继续').trim();
        const options = decision.args?.选项 || decision.args?.options || null;
        const seq = nextSeq(runId);
        addStep(runId, seq, { role: 'ask', tool: 'ask_user', args: decision.args, status: 'pending_confirmation', brief: question, text: question });
        emit(runId, 'step', { seq, role: 'ask', tool: 'ask_user', brief: question, status: 'pending_confirmation' });
        const answer = await pause({ type: 'ask', seq, question, options });
        if (!answer) { softStop(abortReason()); return; }
        const answerText = String(answer.note || (answer.approved ? '同意' : '不同意')).trim();
        const s2 = nextSeq(runId);
        addStep(runId, s2, { role: 'observation', tool: 'ask_user', brief: `用户答复：${clip(answerText, 60)}`, text: `用户答复：${answerText}` });
        history.push({ seq: s2, role: 'observation', tool: 'ask_user', brief: `用户答复：${clip(answerText, 60)}`, text: `用户答复：${answerText}` });
        emit(runId, 'step', { seq: s2, role: 'observation', tool: 'ask_user', brief: `用户答复：${clip(answerText, 60)}`, status: 'ok' });
        pending = null; fixCount = 0; persist();
        continue;
      }

      /* 花钱的闸门 */
      if (SPENDS(decision.action) && !agent.auto_run) {
        const preview = confirmPreview(decision.action, decision.args);
        const seq = nextSeq(runId);
        addStep(runId, seq, { role: 'ask', tool: decision.action, args: decision.args, status: 'pending_confirmation', brief: preview, text: preview });
        emit(runId, 'step', { seq, role: 'ask', tool: decision.action, brief: preview, status: 'pending_confirmation' });
        const answer = await pause({ type: 'confirm', seq, tool: decision.action, args: decision.args, preview });
        if (!answer) { softStop(abortReason()); return; }
        if (!answer.approved) {
          const note = String(answer.note || '用户拒绝了这次操作');
          const s2 = nextSeq(runId);
          const text = `用户拒绝执行 ${decision.action}。原因：${note}。请换一种做法，不要重复请求同一操作。`;
          addStep(runId, s2, { role: 'observation', tool: decision.action, status: 'skipped', brief: `用户拒绝：${clip(note, 60)}`, text });
          history.push({ seq: s2, role: 'observation', tool: decision.action, brief: `用户拒绝：${clip(note, 60)}`, text });
          emit(runId, 'step', { seq: s2, role: 'observation', tool: decision.action, brief: `用户拒绝：${clip(note, 60)}`, status: 'skipped' });
          pending = null; persist();
          continue;
        }
        pending = null;
        await runToolStep(decision.action, decision.args);
        continue;
      }

      /* 正常执行 */
      await runToolStep(decision.action, decision.args);
    }
  } catch (e) {
    setStatus(runId, 'failed', e.message);
    emit(runId, 'fatal', { message: e.message });
    try { persist(); } catch { /* ignore */ }
  }
}

/* ---------------- 收集产物（完成时给前端展示） ---------------- */
export function collectArtifacts(scriptId) {
  const shots = q.all('SELECT * FROM shot WHERE script_id = ? ORDER BY seq', scriptId);
  const media = q.all('SELECT * FROM media_asset WHERE script_id = ? ORDER BY create_time DESC LIMIT 8', scriptId);
  return {
    images: shots.filter((s) => s.image_url).map((s) => ({ seq: s.seq, url: s.image_url })),
    videos: shots.filter((s) => s.video_url).map((s) => ({ seq: s.seq, url: s.video_url })),
    movies: media.filter((m) => m.kind === 'movie').map((m) => m.file_path),
  };
}

/* ============================================================================
   对外接口
   ============================================================================ */
export function startRun({ agentId, scriptId, goal, skillId }) {
  const script = q.one('SELECT * FROM script WHERE id = ?', scriptId);
  if (!script) throw new Error('剧本不存在');

  /* Skill 套用：模板渲染出目标文案 + 记录套路快照 */
  let skill = null;
  let rendered = null;
  if (skillId) {
    const row = q.one('SELECT * FROM skill WHERE id = ?', skillId) || q.one('SELECT * FROM skill WHERE command = ?', String(skillId).replace(/^\//, ''));
    if (!row) throw new Error('Skill 不存在');
    skill = { ...row, spec: JSON.parse(row.spec_json || '{}') };
    rendered = renderSkill(skill, { script, shots: skill.spec?.shots });
  }

  // 没选岗位时，若套路指定了岗位名就自动用那个岗位
  const agent = loadAgent(agentId) || (rendered?.agentName
    ? q.one('SELECT * FROM agent WHERE name = ?', rendered.agentName)
    : null);  if (!agent) throw new Error(rendered?.agentName ? `未找到「${rendered.agentName}」岗位，请先在 Agent 应用里创建` : 'Agent 不存在');

  const label = String(goal || '').trim() || rendered?.goal || '';
  if (!label) throw new Error('请填写本次目标，或选择一个 Skill 套路');

  const running = q.one("SELECT id FROM agent_run WHERE script_id = ? AND status IN ('running','waiting') LIMIT 1", scriptId);
  if (running) throw new Error('该剧本已有一个运行中的 Agent 任务，请先等它结束或停止它');

  const id = uid('arun');
  q.run(`INSERT INTO agent_run (id, agent_id, script_id, goal, status, step_count, cost_json, context_json, skill_id, skill_json, create_time, update_time)
         VALUES (?,?,?,?,?,0,?,?,?,?,?,?)`,
    id, agent.id, scriptId, label, 'running',
    JSON.stringify({ images: 0, videos: 0, llmCalls: 0 }),
    JSON.stringify({ history: [{ seq: 1, role: 'system', text: `本次目标：${label}` }], pending: null, startedAt: Date.now() }),
    rendered?.skillId || null, rendered ? JSON.stringify(rendered) : null, now(), now());

  // 同时把套路的风格与镜头参数落到剧本上（写进数据，Agent 每一步都能读到）
  if (rendered) {
    try {
      if (rendered.styleName) {
        const st = q.one('SELECT * FROM style_preset WHERE name = ?', rendered.styleName);
        if (st) {
          q.run('UPDATE script SET style_id = ?, update_time = ? WHERE id = ?', st.id, now(), scriptId);
          q.run('UPDATE shot SET style_id = ?, update_time = ? WHERE script_id = ?', st.id, now(), scriptId);
        }
      }
      if (rendered.skillId) bumpUsage(rendered.skillId);
    } catch { /* 落参失败不影响运行 */ }
  }

  setTimeout(() => { drive(id).catch((e) => { setStatus(id, 'failed', e.message); emit(id, 'fatal', { message: e.message }); }); }, 0);
  return { runId: id, agent: { id: agent.id, name: agent.name }, scriptId, skill: rendered };
}

/** 用户对挂起的确认/提问给出答复；进程重启后也能冷启动续上 */
export function resumeRun(runId, { approved = false, note = '' } = {}) {
  const run = loadRun(runId);
  if (!run) throw new Error('运行记录不存在');
  if (run.status !== 'waiting') throw new Error(`当前状态是「${run.status}」，不需要确认`);
  const waiter = waiters.get(runId);
  if (waiter) {
    waiters.delete(runId);
    waiter({ approved, note });
    return { resumed: true, mode: 'hot' };
  }
  // 冷启动：没有等待中的循环，从落库的上下文重新驱动
  drive(runId, { approved, note }).catch((e) => { setStatus(runId, 'failed', e.message); emit(runId, 'fatal', { message: e.message }); });
  return { resumed: true, mode: 'cold' };
}

export function stopRun(runId) {
  const run = loadRun(runId);
  if (!run) throw new Error('运行记录不存在');
  if (!['running', 'waiting'].includes(run.status)) throw new Error(`当前状态是「${run.status}」，无法停止`);
  stopped.add(runId);
  const waiter = waiters.get(runId);
  if (waiter) { waiters.delete(runId); waiter(null); }
  else { setStatus(runId, 'stopped', '用户手动停止'); emit(runId, 'done', { status: 'stopped', summary: '用户手动停止' }); }
  return { stopped: runId };
}

/** 从某一步之后重跑：把该步之后的记录作废，回到挂起点之前的上下文 */
export function retryFrom(runId, fromSeq) {
  const run = loadRun(runId);
  if (!run) throw new Error('运行记录不存在');
  const seq = Number(fromSeq) || 0;
  if (!seq) throw new Error('缺少重跑起点');
  const store = JSON.parse(run.context_json || '{}');
  const history = (store.history || []).filter((h) => h.seq < seq);
  q.run('DELETE FROM agent_step WHERE run_id = ? AND seq >= ?', runId, seq);
  q.run('UPDATE agent_run SET context_json = ?, status = ?, error = NULL, update_time = ? WHERE id = ?',
    JSON.stringify({ ...store, history, pending: null }), 'running', now(), runId);
  drive(runId).catch((e) => { setStatus(runId, 'failed', e.message); emit(runId, 'fatal', { message: e.message }); });
  return { retried: runId, fromSeq: seq, kept: history.length };
}

export function runDetail(runId) {
  const run = loadRun(runId);
  if (!run) return null;
  return {
    ...run,
    cost: JSON.parse(run.cost_json || '{}'),
    context: undefined,
    steps: q.all('SELECT * FROM agent_step WHERE run_id = ? ORDER BY seq', runId).map((s) => ({
      ...s,
      args: s.args_json ? JSON.parse(s.args_json) : null,
      result: s.result_json ? JSON.parse(s.result_json) : null,
    })),
  };
}

export function listRuns({ scriptId, limit = 20 } = {}) {
  return (scriptId
    ? q.all('SELECT * FROM agent_run WHERE script_id = ? ORDER BY create_time DESC LIMIT ?', scriptId, Number(limit))
    : q.all('SELECT * FROM agent_run ORDER BY create_time DESC LIMIT ?', Number(limit))
  ).map((r) => ({ ...r, cost: JSON.parse(r.cost_json || '{}') }));
}

/* ---------------- Agent 名册 ---------------- */
const agentRow = (r) => r && ({
  ...r,
  tools: JSON.parse(r.tools_json || '[]'),
  budget: { ...DEFAULT_BUDGET, ...(JSON.parse(r.budget_json || '{}')) },
});

export function listAgents() {
  return q.all('SELECT * FROM agent ORDER BY sort_order, create_time').map(agentRow);
}
export function getAgent(id) { return agentRow(q.one('SELECT * FROM agent WHERE id = ?', id)); }

export function upsertAgent(body = {}, id = null) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('请填写岗位名称');
  const tools = Array.isArray(body.tools) ? body.tools.filter((t) => TOOLS[t]) : [];
  const budget = { ...DEFAULT_BUDGET, ...(body.budget || {}) };
  const autoRaw = body.auto_run ?? body.autoRun;
  const auto = (autoRaw === true || autoRaw === 1 || autoRaw === '1') ? 1 : 0;
  const payload = [
    name, String(body.role || '').trim(), String(body.avatar || '').trim().slice(0, 4),
    String(body.system_prompt ?? body.systemPrompt ?? ''), String(body.model_id ?? body.modelId ?? ''),
    JSON.stringify(tools), auto, JSON.stringify(budget),
  ];
  if (id) {
    const cur = q.one('SELECT id FROM agent WHERE id = ?', id);
    if (!cur) throw new Error('Agent 不存在');
    q.run(`UPDATE agent SET name = ?, role = ?, avatar = ?, system_prompt = ?, model_id = ?,
           tools_json = ?, auto_run = ?, budget_json = ?, update_time = ? WHERE id = ?`, ...payload, now(), id);
    return getAgent(id);
  }
  const nid = uid('ag');
  const maxSort = q.one('SELECT COALESCE(MAX(sort_order),0) m FROM agent')?.m || 0;
  q.run(`INSERT INTO agent (id, name, role, avatar, system_prompt, model_id, tools_json, auto_run, budget_json, builtin, sort_order, create_time, update_time)
         VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?)`, nid, ...payload, maxSort + 1, now(), now());
  return getAgent(nid);
}

export function deleteAgent(id) {
  const a = q.one('SELECT * FROM agent WHERE id = ?', id);
  if (!a) throw new Error('Agent 不存在');
  q.run('DELETE FROM agent WHERE id = ?', id);
  return { deleted: id };
}

/** 工具清单（供前端渲染权限勾选） */
export function toolList() {
  const byKind = { read: [], text: [], image: [], video: [] };
  for (const [name, t] of Object.entries(TOOLS)) {
    (byKind[t.group || t.kind] || byKind.read).push({
      name, kind: t.kind, group: t.group || t.kind, desc: t.desc, control: t.control || null, args: t.args || {},
    });
  }
  return byKind;
}
