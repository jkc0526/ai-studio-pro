import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';
import AgentEditor from '../components/AgentEditor.jsx';
import SkillCatalog from '../components/SkillCatalog.jsx';

/* ============================================================================
   Agent 应用 · 多 Agent 剧组编排页
   左：剧组名册（岗位 + 权限 + 预算概览）
   右：运行台（目标 → 启动）+ 实时时间线 + 确认卡 + 产物墙
   数据流：启动后订阅 /api/agent-runs/:id/stream（SSE）
     snapshot（全量）→ step / ask / budget（增量）→ done / fatal（终态）
   刷新页面：若该剧本还有 running/waiting 的运行，自动重新接上时间线。
   ============================================================================ */

const STATUS_TEXT = { running: '运行中', waiting: '等待确认', done: '已完成', failed: '失败', stopped: '已停止' };
const KIND_TEXT = { read: '只读', text: '文本', image: '图像额度', video: '视频额度' };
const KIND_COLOR = { read: '#6b7280', text: '#2f6fed', image: '#b7791f', video: '#993556' };

/** 步骤落库时 result_json 的结构是 {brief, text, data}，这里统一安全解包 */
const unpack = (step) => {
  let res = {};
  try { res = step.result_json ? JSON.parse(step.result_json) : {}; } catch { /* ignore */ }
  let args = null;
  try { args = step.args_json ? JSON.parse(step.args_json) : null; } catch { /* ignore */ }
  return { res, args };
};

export default function AgentView() {
  const { script, scripts, scriptId, selectScript, notify, setView, bumpShots, agentDraft, clearAgentDraft, openProject } = useApp();

  const [agents, setAgents] = useState([]);
  const [toolKind, setToolKind] = useState({});     // 工具名 -> kind（染色用）
  const [agentId, setAgentId] = useState(null);
  const [editing, setEditing] = useState(null);     // null | 'new' | agent 对象
  const [goal, setGoal] = useState('');
  const [starting, setStarting] = useState(false);
  const [answer, setAnswer] = useState('');

  /* Skill 套路（对齐 LibTV 的 skill 市场） */
  const [skills, setSkills] = useState([]);
  const [skillMeta, setSkillMeta] = useState({ categories: [], kinds: [] });
  const [pickedSkill, setPickedSkill] = useState(null);   // 已套用的 Skill（含渲染结果）
  const [showRoster, setShowRoster] = useState(false);

  const [run, setRun] = useState(null);             // 运行详情（含 steps）
  const [pendingAsk, setPendingAsk] = useState(null);
  const [expanded, setExpanded] = useState({});     // seq -> 完整观察文本
  const closeRef = useRef(null);
  const feedRef = useRef(null);
  const runRef = useRef(null);
  runRef.current = run;

  const agent = agents.find((a) => a.id === agentId) || null;
  const runAgent = run ? agents.find((a) => a.id === run.agent_id) : null;
  const active = run && ['running', 'waiting'].includes(run.status);

  /* ---------------- 事件处理 ---------------- */
  const finishLocally = useCallback((payload) => {
    setRun((r) => (r ? {
      ...r,
      status: payload.status || 'done',
      error: payload.status === 'failed' ? payload.summary || payload.message || null : null,
      summary: payload.summary || null,
      artifacts: payload.artifacts || r.artifacts,
      cost: payload.cost || r.cost,
    } : r));
    setPendingAsk(null);
    closeRef.current?.();
    closeRef.current = null;
    bumpShots();
    if (payload.status === 'stopped') notify(`已停止：${payload.summary || '运行结束'}`);
    else if (payload.status === 'done') notify('Agent 运行完成');
  }, [notify, bumpShots]);

  const onEvent = useCallback(({ event, data }) => {
    if (event === 'snapshot') {
      setRun(data);
      // 快照恢复挂起态（刷新页面 / 断线重连）
      if (data.status === 'waiting') {
        const asks = (data.steps || []).filter((s) => s.role === 'ask');
        const last = asks[asks.length - 1];
        if (last) {
          const { args } = unpack(last);
          setPendingAsk(last.tool === 'ask_user'
            ? { type: 'ask', seq: last.seq, question: args?.问题 || '请确认', options: args?.选项 || null }
            : { type: 'confirm', seq: last.seq, tool: last.tool, args, preview: unpack(last).res.brief || '' });
        }
      }
      return;
    }
    if (event === 'step') {
      if (data.role === 'progress') { setRun((r) => (r ? { ...r, progress: data } : r)); return; }
      setRun((r) => {
        if (!r) return r;
        const steps = [...(r.steps || [])];
        const row = {
          seq: data.seq, role: data.role, tool: data.tool || null, status: data.status || 'ok',
          args_json: data.args ? JSON.stringify(data.args) : null,
          result_json: JSON.stringify({ brief: data.brief || '', data: data.data || null }),
          ms: data.ms ?? null,
        };
        const i = steps.findIndex((s) => s.seq === data.seq);
        if (i >= 0) steps[i] = { ...steps[i], ...row };
        else steps.push(row);
        /* ask 步骤意味着进入挂起；其余步骤意味着已从挂起恢复执行 */
        const status = data.role === 'ask' ? 'waiting'
          : r.status === 'waiting' ? 'running' : r.status;
        return { ...r, steps, status };
      });
      setPendingAsk((p) => (p && data.seq > p.seq ? null : p));
      return;
    }
    if (event === 'ask') {
      setRun((r) => (r ? { ...r, status: 'waiting' } : r));
      setPendingAsk(data);
      return;
    }
    if (event === 'budget') {
      setRun((r) => (r ? { ...r, cost: { images: data.images || 0, videos: data.videos || 0, llmCalls: data.llmCalls || 0 } } : r));
      return;
    }
    if (event === 'done') finishLocally(data);
    if (event === 'fatal') {
      setRun((r) => (r ? { ...r, status: 'failed', error: data.message } : r));
      setPendingAsk(null);
      closeRef.current?.();
      closeRef.current = null;
      notify(data.message || '运行失败', true);
    }
  }, [finishLocally, notify]);

  const openRun = useCallback(async (id) => {
    closeRef.current?.();
    closeRef.current = null;
    try {
      const detail = await api.getAgentRun(id);
      setRun(detail);
      setPendingAsk(null);
      setExpanded({});
      closeRef.current = api.agentStream(id, onEvent);
    } catch (e) { notify(e.message, true); }
  }, [onEvent, notify]);

  /* ---------------- 初始化 ---------------- */
  useEffect(() => {
    (async () => {
      try {
        const [list, groups] = await Promise.all([api.listAgents(), api.agentTools()]);
        setAgents(list);
        setAgentId((cur) => cur || list[0]?.id || null);
        const kind = {};
        for (const g of Object.values(groups || {})) for (const t of g) kind[t.name] = t.kind;
        setToolKind(kind);
      } catch (e) { notify(`Agent 名册加载失败：${e.message}`, true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Skill 套路库
  useEffect(() => {
    (async () => {
      try {
        const [list, meta] = await Promise.all([api.listSkills(), api.skillMeta()]);
        setSkills(list);
        setSkillMeta(meta);
      } catch { /* Skill 不可用不影响 Agent 主体功能 */ }
    })();
  }, []);

  /* 套用 Skill：按当前剧本渲染目标文案，并把风格/岗位/参数一起带过来 */
  const useSkill = async (s) => {
    try {
      const rendered = await api.applySkill(s.id, { scriptId: script?.id });
      setPickedSkill({ ...rendered, skill: s, agentName: rendered.agentName, agentId: s.spec?.agentName });
      setGoal(rendered.goal || '');
      // 套路指定了岗位就自动切过去
      const target = agents.find((a) => a.name === rendered.agentName);
      if (target) setAgentId(target.id);
      notify(`已套用「${s.title}」：目标与参数已填好`);
    } catch (e) { notify(e.message, true); }
  };

  useEffect(() => {
    if (!agentDraft) return;
    if (agentDraft.scriptId && agentDraft.scriptId !== scriptId) selectScript(agentDraft.scriptId);
    if (agentDraft.goal) setGoal(agentDraft.goal);
    setShowRoster(false);
  }, [agentDraft, scriptId, selectScript]);

  useEffect(() => {
    if (!agentDraft?.skillId || !skills.length) return;
    const skill = skills.find((item) => item.id === agentDraft.skillId);
    if (!skill) return;
    useSkill(skill).finally(() => clearAgentDraft?.());
  }, [agentDraft?.skillId, skills, clearAgentDraft]);

  // 切换剧本 / 首次进入：接上最近一次运行（运行中则实时续流，已结束则作为回放），
  // 保证刷新页面不丢现场。想开新任务点运行台的「↺ 新任务」。
  useEffect(() => {
    if (!scriptId) return;
    let stale = false;
    (async () => {
      try {
        if (agentDraft?.runId) {
          if (agentDraft.scriptId && agentDraft.scriptId !== scriptId) {
            selectScript(agentDraft.scriptId);
            return;
          }
          await openRun(agentDraft.runId);
          clearAgentDraft?.();
          return;
        }
        const list = await api.listAgentRuns(scriptId);
        if (stale) return;
        if (list[0]) await openRun(list[0].id);
      } catch { /* ignore */ }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId, agentDraft?.runId]);

  // 卸载时关闭事件流
  useEffect(() => () => { closeRef.current?.(); }, []);

  // 新步骤到达时贴底
  useEffect(() => {
    const el = feedRef.current;
    if (el && active) el.scrollTop = el.scrollHeight;
  }, [run?.steps?.length, active]);

  /* ---------------- 操作 ---------------- */
  const start = async () => {
    if (!agent) return notify('请先在左侧选择一个岗位', true);
    if (!script) return notify('请先创建或选择剧本', true);
    if (!goal.trim()) return notify('请先用一句话描述这次的目标，或选一个 Skill 套路', true);
    setStarting(true);
    try {
      const r = await api.startAgentRun({
        agentId: agent.id, scriptId: script.id, goal: goal.trim(), skillId: pickedSkill?.skillId || undefined,
      });
      setGoal('');
      await openRun(r.runId);
    } catch (e) { notify(e.message, true); } finally { setStarting(false); }
  };

  const stop = async () => {
    if (!run) return;
    try { await api.stopAgentRun(run.id); } catch (e) { notify(e.message, true); }
  };

  const respond = async (approved, note) => {
    if (!run || !pendingAsk) return;
    try {
      await api.resumeAgentRun(run.id, { approved, note: note ?? answer });
      setAnswer('');
      setPendingAsk((p) => (p ? { ...p, answered: true } : p));
    } catch (e) { notify(e.message, true); }
  };

  const retryFrom = async (seq) => {
    if (!run) return;
    try {
      await api.retryAgentRun(run.id, seq);
      notify(`已从第 ${seq} 步重跑`);
      await openRun(run.id);
    } catch (e) { notify(e.message, true); }
  };

  const expandStep = async (s) => {
    if (expanded[s.seq] !== undefined) { setExpanded((e) => { const n = { ...e }; delete n[s.seq]; return n; }); return; }
    const { res } = unpack(s);
    if (res.text) { setExpanded((e) => ({ ...e, [s.seq]: res.text })); return; }
    try {
      const detail = await api.getAgentRun(run.id);
      const fresh = (detail.steps || []).find((x) => x.seq === s.seq);
      const text = fresh ? unpack(fresh).res.text || '(无更多详情)' : '(该步骤已不存在)';
      setExpanded((e) => ({ ...e, [s.seq]: text }));
    } catch { setExpanded((e) => ({ ...e, [s.seq]: '(详情加载失败)' })); }
  };

  /* 从运行台回到启动台并提示 Skill 库 */
  const openSkillHint = () => {
    setRun(null);
    setPendingAsk(null);
    notify('已回到启动台：可挑一个 Skill 套路，也可以直接写目标');
  };

  const removeAgent = async (a) => {    if (!window.confirm(`删除岗位「${a.name}」？（不影响已完成的运行记录）`)) return;
    try {
      await api.deleteAgent(a.id);
      const list = await api.listAgents();
      setAgents(list);
      setAgentId((cur) => (cur === a.id ? list[0]?.id || null : cur));
      notify('岗位已删除');
    } catch (e) { notify(e.message, true); }
  };

  const savedAgent = (a) => {
    setAgents((list) => {
      const i = list.findIndex((x) => x.id === a.id);
      if (i >= 0) { const n = [...list]; n[i] = a; return n; }
      return [...list, a];
    });
    setAgentId(a.id);
    setEditing(null);
  };

  /* ---------------- 派生 ---------------- */
  const cost = run?.cost || { images: 0, videos: 0, llmCalls: 0 };
  const budget = runAgent?.budget || agent?.budget || { maxSteps: 30, maxImages: 12, maxVideos: 10, deadlineSec: 1800 };
  const doneSteps = useMemo(
    () => (run?.steps || []).filter((s) => s.role === 'observation').length,
    [run?.steps]);
  const artifacts = run?.artifacts || null;

  return (
    <div className="ag-wrap">
      {/* ============ 左：剧组名册 ============ */}
      <aside className={`ag-side ${showRoster ? 'open' : ''}`}>
        <div className="ag-side-head">
          <b>岗位设置</b>
          <span className="spacer" />
          <button className="ghost tiny" onClick={() => setEditing('new')}>＋ 新建</button>
          <button className="ghost tiny" onClick={() => setShowRoster(false)} aria-label="关闭岗位设置">×</button>
        </div>
        <div className="ag-roster">
          {!agents.length && <div className="ag-empty">还没有岗位，点右上角新建</div>}
          {agents.map((a) => (
            <div key={a.id} className={`ag-agent ${a.id === agentId ? 'on' : ''}`} onClick={() => setAgentId(a.id)}>
              <span className="ag-avatar">{a.avatar || a.name.slice(0, 2)}</span>
              <span className="ag-agent-meta">
                <b>{a.name}</b>
                <small>{a.role || '—'} · {a.tools.length} 工具</small>
              </span>
              <span className={`ag-badge ${a.auto_run ? 'auto' : 'manual'}`}>{a.auto_run ? '全自动' : '需确认'}</span>
            </div>
          ))}
        </div>
        {agent && (
          <div className="ag-agent-detail">
            <div className="ag-detail-head">
              <b>{agent.name} · {agent.role || '未设定位'}</b>
              <span className="spacer" />
              <button className="ghost tiny" onClick={() => setEditing(agent)}>编辑</button>
              <button className="ghost tiny" onClick={() => removeAgent(agent)}>删除</button>
            </div>
            {agent.system_prompt && <p className="ag-persona">{agent.system_prompt}</p>}
            <div className="ag-toolchips">
              {agent.tools.map((t) => (
                <span key={t} className="ag-toolchip" style={{ borderColor: `${KIND_COLOR[toolKind[t]] || '#888'}55`, color: KIND_COLOR[toolKind[t]] || '#555' }}>{t}</span>
              ))}
            </div>
            <div className="ag-budget-chips">
              <span className="pill">≤ {agent.budget.maxSteps} 步</span>
              <span className="pill">≤ {agent.budget.maxImages} 图</span>
              <span className="pill">≤ {agent.budget.maxVideos} 片</span>
              <span className="pill">≤ {Math.round(agent.budget.deadlineSec / 60)} 分钟</span>
            </div>
          </div>
        )}
      </aside>

      {/* ============ 右：运行台 ============ */}
      <section className="ag-main">
        {!run ? (
          /* ---- 待启动 ---- */
          <div className="ag-launch">
            <div className="ag-launch-head"><div><span className="eyebrow">AGENT WORKSPACE</span><h2>选择一个 Skill，开始一轮可确认的创作</h2><p className="hint">岗位名册、权限和预算收进设置抽屉，运行区只保留目标、时间线和产物。</p></div><button className="ghost" onClick={() => setShowRoster(true)}>⚙ 岗位设置</button></div>
            <SkillCatalog skills={skills} meta={skillMeta} selectedId={pickedSkill?.skillId} onUse={useSkill} onClear={() => { setPickedSkill(null); setGoal(''); }} />

            <div className="empty-card" style={{ maxWidth: 760, margin: '18px auto 40px' }}>
              <h3>{pickedSkill ? `已准备「${pickedSkill.title}」` : `让 ${agent ? `「${agent.name}」` : 'Agent'} 替你跑完这条流水线`}</h3>
              <p className="hint">
                用一句话描述目标，例如「把当前剧本做成一集 8 镜的成片」。Agent 会自己查看现状、
                写剧本、拆分镜、提角色场景、合成提示词；遇到要花钱的生图生视频会先停下来问你。
              </p>
              <textarea
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder={`例：把《${script?.title || '当前剧本'}》做成一集 8 镜的成片，风格保持一致`}
              />
              <div className="ag-launch-bar">
                <select value={scriptId || ''} onChange={(e) => selectScript(e.target.value)} style={{ width: 200 }}>
                  {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
                <span className="spacer" />
                <button className="primary" onClick={start} disabled={starting || !agent}>
                  {starting ? '启动中…' : '▶ 启动 Agent'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ---- 运行中 / 已结束 ---- */
          <>
            <div className="ag-console">
              <span className={`dot ${run.status === 'running' ? 'run' : run.status === 'waiting' ? 'wait' : run.status === 'done' ? 'ok' : 'err'}`} />
              <b className="ag-goal" title={run.goal}>{run.goal}</b>
              <span className="pill">{runAgent ? runAgent.name : '岗位已删除'} · {STATUS_TEXT[run.status] || run.status}</span>
              {run.skill_json && (() => {
                try { const sk = JSON.parse(run.skill_json); return <span className="pill ag-skill-pill">Skill · {sk.title}</span>; }
                catch { return null; }
              })()}
              <button className="ghost tiny" onClick={() => setShowRoster(true)}>岗位设置</button>
              <span className="spacer" />
              <span className="pill">步 {doneSteps}/{budget.maxSteps}</span>
              <span className="pill">图 {cost.images || 0}/{budget.maxImages}</span>
              <span className="pill">片 {cost.videos || 0}/{budget.maxVideos}</span>
              {active
                ? <button className="ghost" onClick={stop}>⏹ 停止</button>
                : (
                  <>
                    <button className="ghost" onClick={openSkillHint}>✨ Skill 套路</button>
                    <button className="primary" onClick={() => { setRun(null); setPendingAsk(null); }}>＋ 新建任务</button>
                  </>
                )}
            </div>

            {run.error && <div className="ag-fatal">运行失败：{run.error}</div>}

            <div className="ag-feed" ref={feedRef}>
              <div className="ag-step sys"><span className="ag-who">目标</span><div className="ag-bubble">{run.goal}</div></div>
              {(run.steps || []).filter((s) => s.seq !== 1 || s.role !== 'system').map((s) => (
                <StepCard key={s.seq} s={s} expanded={expanded[s.seq]} toolKind={toolKind}
                  canRetry={run.status !== 'running' && s.role === 'observation' && s.status === 'error'}
                  onExpand={() => expandStep(s)} onRetry={() => retryFrom(s.seq)} />
              ))}
              {run.progress && (
                <div className="ag-step progress">
                  <span className="ag-who">进度</span>
                  <div className="ag-bubble">
                    {run.progress.stage === 'video' ? '图生视频' : '批量出图'} {run.progress.done}/{run.progress.total}（镜头 {run.progress.seq}）
                  </div>
                </div>
              )}
              {active && !pendingAsk && <div className="ag-typing">Agent 正在思考…</div>}

              {/* ---- 确认卡（挂起时） ---- */}
              {pendingAsk && (
                <div className="ag-confirm">
                  {pendingAsk.type === 'ask' ? (
                    <>
                      <div className="ag-confirm-head">❓ Agent 请求你的意见</div>
                      <p className="ag-confirm-q">{pendingAsk.question}</p>
                      {!!pendingAsk.options?.length && (
                        <div className="ag-confirm-opts">
                          {pendingAsk.options.map((o) => (
                            <button key={o} className="ghost" disabled={pendingAsk.answered}
                              onClick={() => respond(true, o)}>{o}</button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="ag-confirm-head">⚠ 花钱操作等待确认</div>
                      <p className="ag-confirm-q">{pendingAsk.preview}</p>
                      <p className="ag-confirm-meta">
                        工具 <code>{pendingAsk.tool}</code>（{KIND_TEXT[toolKind[pendingAsk.tool]] || '消耗额度'}）
                        {pendingAsk.args ? ` · 参数 ${JSON.stringify(pendingAsk.args)}` : ''}
                      </p>
                    </>
                  )}
                  {pendingAsk.answered ? (
                    <div className="ag-confirm-wait">已提交，等待 Agent 继续…</div>
                  ) : (
                    <div className="ag-confirm-foot">
                      <input
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        placeholder="可填意见（如：先只出 2 张试试），留空表示无补充"
                      />
                      <button className="primary" onClick={() => respond(true)}>同意继续</button>
                      <button className="ghost" onClick={() => respond(false)}>拒绝</button>
                    </div>
                  )}
                </div>
              )}

              {/* ---- 交付总结 ---- */}
              {run.status === 'done' && run.summary && (
                <div className="ag-step final">
                  <span className="ag-who">交付</span>
                  <div className="ag-bubble">{run.summary}</div>
                </div>
              )}
            </div>

            {/* ---- 产物墙 ---- */}
            {artifacts && (artifacts.images.length || artifacts.videos.length || artifacts.movies.length) ? (
              <div className="ag-artifacts">
                <div className="ag-art-head">
                  <b>本次产物</b>
                  <span className="pill">图 {artifacts.images.length} · 片 {artifacts.videos.length}{artifacts.movies.length ? ` · 成片 ${artifacts.movies.length}` : ''}</span>
                  <span className="spacer" />
                  <button className="ghost tiny" onClick={() => openProject?.(script?.id, 'storyboard')}>去分镜页查看 →</button>
                </div>
                {!!artifacts.movies.length && (
                  <div className="ag-movies">
                    {artifacts.movies.map((m) => <video key={m} src={m} controls preload="metadata" />)}
                  </div>
                )}
                {!!artifacts.videos.length && (
                  <div className="ag-thumbs">
                    {artifacts.videos.map((v) => <video key={v.seq + v.url} src={v.url} controls preload="metadata" />)}
                  </div>
                )}
                <div className="ag-thumbs">
                  {artifacts.images.map((im) => <img key={im.seq} src={im.url} alt={`镜头 ${im.seq}`} title={`镜头 ${im.seq}`} />)}
                </div>
              </div>
            ) : null}
          </>
        )}
      </section>

      {editing && (
        <AgentEditor
          agent={editing === 'new' ? null : editing}
          toolGroups={null}
          onClose={() => setEditing(null)}
          onSaved={savedAgent}
          notify={notify}
        />
      )}
    </div>
  );
}

/* ================= 单步卡片 ================= */
function StepCard({ s, expanded, toolKind, canRetry, onExpand, onRetry }) {
  const { res, args } = unpack(s);
  const brief = res.brief || s.result?.brief || '';
  const hasDetail = res.text || !!res.data;
  const kind = toolKind[s.tool];

  if (s.role === 'thought') {
    return (
      <div className="ag-step thought">
        <span className="ag-who">思考</span>
        <div className="ag-bubble">{brief || '(空)'}</div>
      </div>
    );
  }
  if (s.role === 'system') {
    return (
      <div className={`ag-step sysmsg ${s.status === 'error' ? 'err' : ''}`}>
        <span className="ag-who">系统</span>
        <div className="ag-bubble">{brief}</div>
      </div>
    );
  }
  if (s.role === 'ask') {
    return (
      <div className="ag-step ask done">
        <span className="ag-who">询问</span>
        <div className="ag-bubble">{brief}</div>
      </div>
    );
  }
  if (s.role === 'final') {
    return (
      <div className="ag-step final">
        <span className="ag-who">交付</span>
        <div className="ag-bubble">{brief}</div>
      </div>
    );
  }

  /* observation */
  const data = res.data || {};
  const imgs = [];
  if (data.image) imgs.push(data.image);
  if (Array.isArray(data.variants)) imgs.push(...data.variants);
  const fails = Array.isArray(data.failures) ? data.failures : [];
  const argText = args && Object.keys(args).length ? JSON.stringify(args) : '';

  return (
    <div className={`ag-step obs ${s.status === 'error' ? 'err' : s.status === 'skipped' ? 'skip' : ''}`}>
      <span className="ag-who">{s.tool}</span>
      <div className="ag-bubble">
        <div className="ag-obs-head">
          <span className="ag-kind" style={{ color: s.status === 'error' ? 'var(--err)' : s.status === 'skipped' ? 'var(--warn)' : KIND_COLOR[kind] || '#555' }}>
            {s.status === 'error' ? '失败' : s.status === 'skipped' ? '已跳过' : KIND_TEXT[kind] || '执行'}
          </span>
          <span className="ag-brief">{brief}</span>
          {s.ms != null && <span className="ag-ms">{s.ms > 1000 ? `${(s.ms / 1000).toFixed(1)}s` : `${s.ms}ms`}</span>}
          <span className="spacer" />
          {hasDetail && <button className="ghost tiny" onClick={onExpand}>{expanded !== undefined ? '收起' : '详情'}</button>}
          {canRetry && <button className="ghost tiny" onClick={onRetry}>从此步重跑</button>}
        </div>
        {argText && <div className="ag-args">{argText}</div>}
        {expanded !== undefined && <div className="ag-detail">{expanded || '(无更多详情)'}</div>}
        {!!imgs.length && (
          <div className="ag-step-imgs">{imgs.map((u) => <img key={u} src={u} alt="" loading="lazy" />)}</div>
        )}
        {data.movie && <video className="ag-step-movie" src={data.movie} controls preload="metadata" />}
        {!!fails.length && <div className="ag-fails">{fails.slice(0, 6).map((f) => <div key={f}>{f}</div>)}</div>}
      </div>
    </div>
  );
}
