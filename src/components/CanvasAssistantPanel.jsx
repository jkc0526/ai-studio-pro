import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';
import { buildCanvasTaskRows } from '../canvasTaskRows.js';

const TABS = [
  { id: 'agent', label: 'Agent', icon: '◎' },
  { id: 'workflows', label: '工作流', icon: '⌘' },
  { id: 'tasks', label: '任务中心', icon: '▤' },
];
const RUNNING = new Set(['运行中', '等待确认']);

export default function CanvasAssistantPanel({ open, onClose, notify }) {
  const { script, scriptId, scripts, selectScript, openAgentDraft } = useApp();
  const [tab, setTab] = useState('agent');
  const [agents, setAgents] = useState([]);
  const [skills, setSkills] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [runs, setRuns] = useState([]);
  const [canvasRuns, setCanvasRuns] = useState([]);
  const [agentId, setAgentId] = useState('');
  const [skillId, setSkillId] = useState('');
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [historyLimit, setHistoryLimit] = useState(20);
  const [hasMore, setHasMore] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const [nextJobs, nextRuns, nextCanvasRuns] = await Promise.all([
        api.listJobs(historyLimit + 1), api.listAgentRuns(undefined, historyLimit + 1),
        api.listCanvasRuns(historyLimit + 1),
      ]);
      setJobs(nextJobs.slice(0, historyLimit));
      setRuns(nextRuns.slice(0, historyLimit));
      setCanvasRuns(nextCanvasRuns.slice(0, historyLimit));
      setHasMore(nextJobs.length > historyLimit || nextRuns.length > historyLimit
        || nextCanvasRuns.length > historyLimit);
      setLoadError('');
    } catch (error) {
      setLoadError(error.message || '任务加载失败');
    }
  }, [historyLimit]);

  useEffect(() => {
    if (!open) return undefined;
    let stale = false;
    (async () => {
      setLoading(true);
      try {
        const [nextAgents, nextSkills] = await Promise.all([api.listAgents(), api.listSkills()]);
        if (stale) return;
        setAgents(nextAgents);
        setSkills(nextSkills);
        setAgentId((current) => current || nextAgents[0]?.id || '');
      } catch (error) {
        if (!stale) setLoadError(error.message || 'Agent 面板加载失败');
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    loadTasks();
    const timer = window.setInterval(loadTasks, 6000);
    return () => { stale = true; window.clearInterval(timer); };
  }, [loadTasks, open]);

  const taskRows = useMemo(() => buildCanvasTaskRows(jobs, runs, agents, canvasRuns),
    [jobs, runs, agents, canvasRuns]);

  const chooseSkill = async (skill) => {
    setSkillId(skill.id);
    const matchingAgent = agents.find((agent) => agent.name === skill.spec?.agentName);
    if (matchingAgent) setAgentId(matchingAgent.id);
    try {
      const rendered = await api.applySkill(skill.id, { scriptId });
      setGoal(rendered.goal || `用「${skill.title}」完成当前创作`);
      setTab('agent');
    } catch (error) {
      notify?.(error.message || '工作流暂时无法套用', true);
    }
  };

  const start = async () => {
    if (!scriptId) {
      notify?.('请先创建或选择一个剧本，再启动 Agent', true);
      return;
    }
    if (!agentId) {
      notify?.('暂时没有可用的 Agent 岗位', true);
      return;
    }
    if (!goal.trim()) {
      notify?.('先描述一下要创作的内容', true);
      return;
    }
    setStarting(true);
    try {
      await api.startAgentRun({ agentId, scriptId, goal: goal.trim(), skillId: skillId || undefined });
      setGoal('');
      setSkillId('');
      setTab('tasks');
      await loadTasks();
      notify?.('Agent 已开始执行，可在任务中心查看进度');
    } catch (error) {
      notify?.(error.message || 'Agent 启动失败', true);
    } finally {
      setStarting(false);
    }
  };

  if (!open) return null;
  return (
    <aside className="cv-assistant-panel" aria-label="Agent 与任务面板" onClick={(event) => event.stopPropagation()}
      onDoubleClickCapture={(event) => event.stopPropagation()}>
      <div className="cv-assistant-tabs" role="tablist" aria-label="画布工作面板">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id}
            aria-controls={`cv-assistant-${item.id}`} className={tab === item.id ? 'on' : ''}
            onClick={() => setTab(item.id)} title={item.label}>
            <span aria-hidden="true">{item.icon}</span><span className="cv-assistant-tab-label">{item.label}</span>
            {item.id === 'tasks' && taskRows.some((row) => RUNNING.has(row.status)) && <i className="cv-task-live-dot" />}
          </button>
        ))}
        <span className="spacer" />
        <button type="button" className="cv-assistant-close" onClick={onClose} aria-label="收起工作面板" title="收起">×</button>
      </div>

      {tab === 'agent' && (
        <section id="cv-assistant-agent" className="cv-assistant-body" role="tabpanel" aria-label="Agent">
          <div className="cv-assistant-identity"><span className="cv-assistant-mark">◎</span><b>AI漫剧工作室</b><small>创作助手</small></div>
          <div className="cv-assistant-agent-content">
            <h2>今天想在画布上创作什么？</h2>
            <p>选择项目并描述目标，启动前可以检查任务内容。</p>
            <button type="button" className="cv-assistant-feature" onClick={() => setTab('workflows')}>
              <span className="cv-assistant-feature-icon">⌘</span>
              <span><b>创作工作流</b><small>选择剧本、分镜或视频任务</small></span>
              <span className="cv-assistant-feature-go">前往 ›</span>
            </button>
            <div className="cv-assistant-shortcuts">
              {skills.slice(0, 4).map((skill, index) => (
                <button key={skill.id} type="button" onClick={() => chooseSkill(skill)}>
                  <i className={`shortcut-icon s${index}`}>{['✎', '▣', '▻', '◇'][index]}</i>{skill.title}
                </button>
              ))}
              {!skills.length && !loading && <span className="cv-assistant-empty">暂无工作流，可直接输入创作目标</span>}
            </div>
          </div>
          <div className="cv-assistant-composer">
            {scripts.length > 0 && <label className="cv-assistant-script"><span>项目</span>
              <select aria-label="选择项目剧本" value={scriptId || ''} onChange={(event) => selectScript(event.target.value)}>
                {scripts.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
              </select>
            </label>}
            <textarea value={goal} onChange={(event) => { setGoal(event.target.value); setSkillId(''); }}
              placeholder={script ? `为《${script.title}》描述创作目标…` : '先选择项目，再描述创作目标…'}
              aria-label="描述 Agent 创作目标" rows={3} />
            <div className="cv-assistant-compose-footer">
              <select aria-label="选择 Agent 岗位" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
                {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <span className="spacer" />
              <button type="button" className="cv-assistant-send" onClick={start} disabled={starting || loading || !agents.length} title="启动 Agent">
                {starting ? '…' : '↑'}
              </button>
            </div>
          </div>
        </section>
      )}

      {tab === 'workflows' && (
        <section id="cv-assistant-workflows" className="cv-assistant-body" role="tabpanel" aria-label="工作流">
          <div className="cv-assistant-section-head"><div><h2>工作流</h2><p>选择一个创作流程，自动填入 Agent 目标。</p></div><span>{skills.length} 个</span></div>
          <div className="cv-assistant-workflow-list">
            {skills.map((skill) => (
              <button type="button" key={skill.id} className="cv-assistant-workflow" onClick={() => chooseSkill(skill)}>
                <span className="cv-assistant-workflow-icon">{skill.avatar || '✦'}</span>
                <span className="cv-assistant-workflow-copy"><b>{skill.title}</b><small>{skill.summary || '使用 Agent 执行这套创作流程'}</small></span>
                <span className="cv-assistant-feature-go">使用 ›</span>
              </button>
            ))}
            {!skills.length && <div className="cv-assistant-empty">{loading ? '正在加载工作流…' : '暂无可用工作流'}</div>}
          </div>
        </section>
      )}

      {tab === 'tasks' && (
        <section id="cv-assistant-tasks" className="cv-assistant-body" role="tabpanel" aria-label="任务中心">
          <div className="cv-assistant-section-head"><div><h2>任务中心</h2><p>生成任务与 Agent 运行状态</p></div><span>已显示 {taskRows.length} 项{hasMore ? '，还有更早记录' : ''}</span></div>
          {loadError && <div className="cv-assistant-error">{loadError}</div>}
          <div className="cv-assistant-task-list" aria-live="polite">
            {taskRows.map((row) => {
              const isRunning = RUNNING.has(row.status);
              const isFailed = row.status === '失败' || row.status === '部分失败';
              return <article key={row.id} className="cv-assistant-task">
                <div className="cv-assistant-task-title">
                  <span className={`cv-assistant-task-type ${row.source}`}>{row.source === 'agent' ? '✦' : '◉'}</span>
                  <b title={row.title}>{row.source === 'agent' ? 'Agent：' : `${row.title}：`}{row.source === 'agent' ? row.title : row.subtitle}</b>
                  <span className={`cv-assistant-task-status ${isFailed ? 'failed' : row.status === '已完成' ? 'done' : ''}`}>{row.status}</span>
                </div>
                {row.progress !== null && <div className="cv-assistant-progress"><i className={isFailed ? 'failed' : ''} style={{ width: `${row.progress}%` }} /></div>}
                <div className="cv-assistant-task-meta"><span>{row.source === 'agent' ? row.subtitle : `${row.subtitle}${row.error ? ` · ${row.error}` : ''}`}</span><time>{row.updatedAt ? new Date(row.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</time></div>
                {isFailed && row.source === 'agent' && <button type="button" className="cv-assistant-retry-link"
                  onClick={() => openAgentDraft({ runId: row.runId, scriptId: row.scriptId })}>打开运行记录处理 ›</button>}
              </article>;
            })}
            {!taskRows.length && <div className="cv-assistant-empty">{loadError ? '任务加载失败，请稍后重试' : '还没有任务，开始一次创作后会显示在这里'}</div>}
            {hasMore && <button type="button" className="cv-assistant-more" onClick={() => setHistoryLimit((count) => Math.min(500, count + 20))}>加载更多任务</button>}
          </div>
        </section>
      )}
    </aside>
  );
}
