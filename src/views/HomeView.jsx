import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';
import SkillCatalog from '../components/SkillCatalog.jsx';

export default function HomeView() {
  const { scripts, openProject, createScript, styleId, styles, setStyleId, notify, reloadScripts, openAgentDraft } = useApp();
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState('');
  const [skills, setSkills] = useState([]);
  const [pickedSkill, setPickedSkill] = useState(null);

  useEffect(() => {
    api.listSkills().then((list) => setSkills(list.slice(0, 6))).catch(() => {});
  }, []);

  const run = async () => {
    if (!idea.trim()) return notify('先用一句话描述你的故事', true);
    setBusy('run');
    try {
      const script = await api.createScript({ title: idea.trim().slice(0, 18) || '新剧本', outline: idea.trim(), styleId });
      await api.updateScript(script.id, { content: idea.trim() });
      await reloadScripts(script.id);
      openAgentDraft({ scriptId: script.id, goal: idea.trim(), skillId: pickedSkill?.id || null, count, styleId });
      notify('项目已创建，请确认创作任务后开始');
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  return (
    <div className="view-body home">
      <div className="home-head">
        <span className="eyebrow">AI漫剧工作室</span>
        <h2>从一句话开始创作</h2>
        <p className="hint">写下故事想法，创建项目后确认创作任务，再开始生成。</p>
      </div>

      <div className="hero-card">
        <textarea
          rows={3}
          value={idea}
          placeholder={'例如：末世第七天，曹坤骑着改装电动车冲进迷雾，用三支火箭筒炸开怪物的巢穴…\n（写一段故事、粘贴小说原文，或只给一句话设定都行）'}
          onChange={(e) => setIdea(e.target.value)}
        />
        <div className="hero-bar">
          <span className="pill">风格</span>
          <select style={{ width: 150 }} value={styleId} onChange={(e) => setStyleId(e.target.value)}>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select style={{ width: 110 }} value={count} onChange={(e) => setCount(Number(e.target.value))} title="预期镜头数">
            {[4, 6, 9, 12, 16].map((n) => <option key={n} value={n}>{n} 个镜头</option>)}
          </select>
          {pickedSkill && <span className="pill">已选工作流：{pickedSkill.title}</span>}
          <span className="spacer" />
          <span className="hint">{idea.length} 字</span>
          <button className="primary" onClick={run} disabled={busy === 'run'}>
            {busy === 'run' ? '正在创建…' : '开始创作 ↑'}
          </button>
        </div>
      </div>

      {!!skills.length && (
        <section className="home-sec skill-recommendations">
          <div className="home-sec-head"><b>创作工作流</b><span className="hint">选择后会带入创作任务，启动前可修改</span></div>
          <SkillCatalog compact skills={skills} selectedId={pickedSkill?.id} onUse={(skill) => setPickedSkill(pickedSkill?.id === skill.id ? null : skill)} />
        </section>
      )}

      <div className="home-actions">
        <button className="outline-action" onClick={createScript}><span>＋</span><b>新建空白项目</b><small>手动写剧本和拆分镜</small></button>
        <button className="outline-action" onClick={() => openProject(scripts[0]?.id, scripts[0] ? 'storyboard' : 'script')}><span>▦</span><b>浏览项目</b><small>从已有项目继续工作</small></button>
      </div>

      {!!scripts.length && (
        <section className="home-sec">
          <div className="home-sec-head"><b>最近项目</b><span className="hint">继续上次的工作</span></div>
          <div className="proj-grid">
            {scripts.map((s) => (
              <button className="proj-card" key={s.id} onClick={() => openProject(s.id)}>
                <span className="proj-cover">
                  {s.cover ? <img src={s.cover} alt="" /> : <i>还没有分镜图</i>}
                  <em>{s.shot_count} 镜</em>
                </span>
                <span className="proj-meta">
                  <b>{s.title}</b>
                  <small>{s.image_count} 张分镜图{s.video_count ? ` · ${s.video_count} 段视频` : ''}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
