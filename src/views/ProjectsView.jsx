import { useApp } from '../context.js';

export default function ProjectsView() {
  const { scripts, scriptId, openProject, createScript } = useApp();

  return (
    <div className="view-body projects-page">
      <div className="page-head">
        <div>
          <h2>项目</h2>
          <p className="hint">每个项目包含剧本、资产、分镜和成片，进入后继续上次工作。</p>
        </div>
        <button className="primary" onClick={createScript}>＋ 新建空白项目</button>
      </div>
      {!scripts.length && (
        <div className="empty-card">
          <h3>还没有项目</h3>
          <p className="hint">从一个空白项目开始，或回到创作台输入一句话创意。</p>
          <button className="primary" onClick={createScript}>创建第一个项目</button>
        </div>
      )}
      <div className="project-list">
        {scripts.map((s) => (
          <button className={`project-row ${s.id === scriptId ? 'active' : ''}`} key={s.id} onClick={() => openProject(s.id)}>
            <span className="project-thumb">{s.cover ? <img src={s.cover} alt="" /> : <i />}</span>
            <span className="project-info">
              <b>{s.title}</b>
              <small>{s.shot_count || 0} 镜 · {s.image_count || 0} 张图{s.video_count ? ` · ${s.video_count} 段视频` : ''}</small>
            </span>
            <span className="project-time">打开项目 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
