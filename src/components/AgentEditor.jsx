import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

/* ============================================================================
   Agent 岗位编辑弹窗：人设 / 模型 / 工具白名单 / 预算 / 自动执行
   ask_user 与 finish 是控制类工具，永远可用，不占用白名单勾选。
   ============================================================================ */

const GROUPS = [
  { kind: 'read', label: '只读 / 写档（不花钱）', hint: '查现状、改镜头档案、切风格等，即时生效不消耗额度' },
  { kind: 'text', label: '文本模型（消耗 token）', hint: '写剧本、提取角色场景、拆分镜、合成提示词' },
  { kind: 'image', label: '图像额度（花钱，默认需确认）', hint: '出图 / 多版本 / 三视图 / 场景设定图' },
  { kind: 'video', label: '视频域', hint: '批量图生视频（消耗额度）；成片导出只跑本机 ffmpeg 不花钱' },
];
const CONTROL_TOOLS = ['ask_user', 'finish'];

export default function AgentEditor({ agent, onClose, onSaved, notify }) {
  const { models } = useApp();
  const [tools, setTools] = useState(null);       // 分组工具清单
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(() => ({
    name: agent?.name || '',
    role: agent?.role || '',
    avatar: agent?.avatar || '',
    system_prompt: agent?.system_prompt || '',
    model_id: agent?.model_id || '',
    auto_run: !!agent?.auto_run,
    tools: new Set(agent?.tools || []),
    budget: { maxSteps: 30, maxImages: 12, maxVideos: 10, deadlineSec: 1800, ...(agent?.budget || {}) },
  }));

  useEffect(() => {
    (async () => {
      try {
        const groups = await api.agentTools();
        const flat = Object.values(groups || {}).flat();
        setTools(flat);
        // 新建岗位：默认给一套安全的起步权限（只读 + 文本 + 控制）
        setForm((f) => (agent ? f : {
          ...f,
          tools: new Set(flat.filter((t) => t.kind === 'read' || t.kind === 'text').map((t) => t.name)),
        }));
      } catch (e) { notify(`工具清单加载失败：${e.message}`, true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const grouped = useMemo(() => {
    const m = { read: [], text: [], image: [], video: [] };
    for (const t of tools || []) (m[t.group || t.kind] || m.read).push(t);
    return m;
  }, [tools]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setBudget = (k, v) => setForm((f) => ({ ...f, budget: { ...f.budget, [k]: v } }));
  const toggleTool = (name) => setForm((f) => {
    const next = new Set(f.tools);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return { ...f, tools: next };
  });

  const save = async () => {
    if (!form.name.trim()) return notify('请填写岗位名称', true);
    setBusy(true);
    try {
      const saved = await api.saveAgent({
        name: form.name.trim(),
        role: form.role.trim(),
        avatar: form.avatar.trim().slice(0, 4),
        system_prompt: form.system_prompt,
        model_id: form.model_id,
        auto_run: form.auto_run,
        tools: [...form.tools],
        budget: {
          maxSteps: Math.max(1, Number(form.budget.maxSteps) || 30),
          maxImages: Math.max(0, Number(form.budget.maxImages) || 0),
          maxVideos: Math.max(0, Number(form.budget.maxVideos) || 0),
          deadlineSec: Math.max(60, Number(form.budget.deadlineSec) || 1800),
        },
      }, agent?.id);
      onSaved(saved);
      notify(agent ? '岗位已更新' : '岗位已创建');
    } catch (e) { notify(e.message, true); } finally { setBusy(false); }
  };

  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal wide">
        <div className="modal-head">
          <span>{agent ? `编辑岗位 · ${agent.name}` : '新建岗位'}</span>
          <button className="ghost tiny" onClick={onClose}>×</button>
        </div>
        <div className="modal-body scroll">
          <div className="row3">
            <div className="field">
              <label className="field-label">岗位名称 *</label>
              <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="如：制片人" />
            </div>
            <div className="field">
              <label className="field-label">一句话定位</label>
              <input value={form.role} onChange={(e) => set({ role: e.target.value })} placeholder="如：统筹全局" />
            </div>
            <div className="field">
              <label className="field-label">名册头像字（≤4 字）</label>
              <input value={form.avatar} onChange={(e) => set({ avatar: e.target.value })} placeholder="如：制片" />
            </div>
          </div>

          <div className="field">
            <label className="field-label">岗位人设（会作为 Agent 的 system 提示词）</label>
            <textarea rows={5} value={form.system_prompt} onChange={(e) => set({ system_prompt: e.target.value })}
              placeholder="写清楚这个岗位的职责边界、做事顺序与禁忌。例如：先看清现状再动手；花钱前必须先 ask_user；不要重复生成已存在的素材…" />
          </div>

          <div className="field">
            <label className="field-label">决策模型（留空用「设置」里的默认文本模型）</label>
            <select value={form.model_id} onChange={(e) => set({ model_id: e.target.value })}>
              <option value="">用全局默认文本模型</option>
              {(models || []).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="field">
            <label className="field-label">工具白名单（决定这个岗位能干什么）</label>
            {!tools && <span className="hint">工具清单加载中…</span>}
            {GROUPS.map((g) => (
              <details key={g.kind} className="adv" open={g.kind === 'read' || g.kind === 'text'}>
                <summary>
                  {g.label} · 已选 {(grouped[g.kind] || []).filter((t) => form.tools.has(t.name)).length}/{(grouped[g.kind] || []).length}
                  <span className="hint"> — {g.hint}</span>
                </summary>
                <div className="ag-perm-grid">
                  {(grouped[g.kind] || []).map((t) => (
                    <label key={t.name} className={`ag-perm ${form.tools.has(t.name) ? 'on' : ''}`}>
                      <input type="checkbox" checked={form.tools.has(t.name)} onChange={() => toggleTool(t.name)} />
                      <span className="ag-perm-name">{t.name}</span>
                      <span className="ag-perm-desc">{t.desc}</span>
                    </label>
                  ))}
                  {!grouped[g.kind]?.length && <span className="hint">（无）</span>}
                </div>
              </details>
            ))}
            <div className="ag-perm-locked">
              永远可用（控制类）：<code>ask_user</code>（向你提问 / 请求确认）、<code>finish</code>（结束并交付总结）
            </div>
          </div>

          <div className="row3">
            <div className="field">
              <label className="field-label">最多步数</label>
              <input type="number" min={1} value={form.budget.maxSteps} onChange={(e) => setBudget('maxSteps', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">最多生图（张）</label>
              <input type="number" min={0} value={form.budget.maxImages} onChange={(e) => setBudget('maxImages', e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label">最多生视频（条）</label>
              <input type="number" min={0} value={form.budget.maxVideos} onChange={(e) => setBudget('maxVideos', e.target.value)} />
            </div>
          </div>
          <div className="row3">
            <div className="field">
              <label className="field-label">时限（秒）</label>
              <input type="number" min={60} step={60} value={form.budget.deadlineSec} onChange={(e) => setBudget('deadlineSec', e.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: 'span 2' }}>
              <label className="field-label">执行方式</label>
              <label className="ag-auto">
                <input type="checkbox" checked={form.auto_run} onChange={(e) => set({ auto_run: e.target.checked })} />
                <span>
                  全自动（<b style={{ color: 'var(--warn)' }}>跳过花钱确认</b>，图像/视频工具直接执行，仍受上方预算上限约束）
                </span>
              </label>
              {!form.auto_run && <span className="hint">默认半自动：每次生图 / 生视频前都会暂停等你确认</span>}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>取消</button>
          <button className="primary" onClick={save} disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}
