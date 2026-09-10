import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

const QUICK = [
  { key: 'canvas', title: '自由画布', desc: '节点式自由创作与精调', tag: '画布' },
  { key: 'script', title: '剧情创作', desc: '写剧本 → 一键拆分镜', tag: '剧本' },
  { key: 'characters', title: '角色设计', desc: '形象锁定，跨镜不崩脸', tag: '角色' },
  { key: 'storyboard', title: '故事板生视频', desc: '分镜批量出图 → 图生视频', tag: '分镜' },
  { key: 'styles', title: '风格库', desc: '12 款内置画风一键套用', tag: '风格' },
  { key: 'media', title: '成片与素材', desc: 'MP4 / SRT / 全部产物', tag: '素材' },
];

export default function HomeView() {
  const { scripts, selectScript, setView, createScript, styleId, styles, setStyleId, notify, reloadScripts, characters } = useApp();
  const [idea, setIdea] = useState('');
  const [count, setCount] = useState(6);
  const [busy, setBusy] = useState('');
  const [media, setMedia] = useState([]);

  useEffect(() => {
    api.media().then((list) => setMedia(list.filter((m) => m.kind === 'movie').slice(0, 3))).catch(() => {});
  }, []);

  const run = async () => {
    if (!idea.trim()) return notify('先用一句话描述你的故事', true);
    setBusy('run');
    try {
      const script = await api.createScript({ title: idea.trim().slice(0, 18) || '新剧本', outline: idea.trim(), styleId });
      await api.updateScript(script.id, { content: idea.trim() });
      const r = await api.splitShots(script.id, { count, styleId, mode: 'replace' });
      await reloadScripts(script.id);
      notify(`已生成剧本与 ${r.created} 个镜头，去补角色档案可以保证跨镜一致`);
      setView('storyboard');
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  return (
    <div className="view-body home">
      <div className="home-head">
        <h2>说出你的创意，剩下的交给流水线</h2>
        <p className="hint">一句话 → 自动写剧本、拆分镜；再到「角色」锁定形象，最后批量出图与成片</p>
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
          <select style={{ width: 110 }} value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[4, 6, 9, 12, 16].map((n) => <option key={n} value={n}>{n} 个镜头</option>)}
          </select>
          {!!characters.length && <span className="pill">已有 {characters.length} 个角色档案会自动注入</span>}
          <span className="spacer" />
          <span className="hint">{idea.length} 字</span>
          <button className="primary" onClick={run} disabled={busy === 'run'}>
            {busy === 'run' ? '正在拆分镜…' : '开始创作 ↑'}
          </button>
        </div>
      </div>

      <div className="quick-grid">
        {QUICK.map((q) => (
          <button className="quick-card" key={q.key} onClick={() => setView(q.key)}>
            <span className="quick-tag">{q.tag}</span>
            <b>{q.title}</b>
            <small>{q.desc}</small>
          </button>
        ))}
      </div>

      {!!scripts.length && (
        <section className="home-sec">
          <div className="home-sec-head"><b>我的剧本</b><span className="hint">点卡片直接进分镜</span></div>
          <div className="proj-grid">
            {scripts.map((s) => (
              <button className="proj-card" key={s.id} onClick={() => { selectScript(s.id); setView('storyboard'); }}>
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

      {!!media.length && (
        <section className="home-sec">
          <div className="home-sec-head"><b>最近成片</b><span className="hint">导出记录</span></div>
          <div className="movie-row">
            {media.map((m) => (
              <div className="movie-mini" key={m.id}>
                <video src={m.file_path} controls muted />
                <div className="hint">{Math.round(m.duration || 0)} 秒 · {new Date(m.create_time).toLocaleString('zh-CN')}</div>
                <a className="btn" href={m.file_path} download>下载</a>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
