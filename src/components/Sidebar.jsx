import { useApp } from '../context.js';

const NAV = [
  { key: 'home', label: '创作台', icon: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { key: 'script', label: '剧本', icon: 'M6 3h9l5 5v13H6zM15 3v5h5' },
  { key: 'storyboard', label: '分镜', icon: 'M4 5h16v14H4zM4 9h16M9 5v14M15 5v14' },
  { key: 'characters', label: '角色', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0' },
  { key: 'canvas', label: '画布', icon: 'M5 5h6v6H5zM13 5h6v6h-6zM9 13h6v6H9zM11 8h2M12 11v2' },
];

export default function Sidebar() {
  const { view, setView, scripts, scriptId, selectScript, createScript, characters, styles, mediaCount, openSettings, notify } = useApp();

  return (
    <aside className="sidebar">
      <div className="side-brand" onClick={() => setView('home')} title="回到创作台">
        <span className="brand-mark">W</span>
        <span className="brand-text">Weave<b>Canvas</b></span>
      </div>

      <button className="side-new" onClick={createScript}>＋ 新建剧本</button>

      <nav className="side-nav">
        {NAV.map((n) => (
          <button key={n.key} className={`side-item ${view === n.key ? 'active' : ''}`} onClick={() => setView(n.key)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={n.icon} />
            </svg>
            <span>{n.label}</span>
            {n.key === 'characters' && characters.length > 0 && <em>{characters.length}</em>}
          </button>
        ))}
      </nav>

      <div className="side-sec">
        <div className="side-sec-head">
          <span>我的剧本</span>
          <em>{scripts.length}</em>
        </div>
        <div className="side-list">
          {!scripts.length && <div className="side-empty">还没有剧本</div>}
          {scripts.map((s) => (
            <button key={s.id} className={`side-proj ${s.id === scriptId ? 'on' : ''}`}
              onClick={() => { selectScript(s.id); setView('storyboard'); }}
              title={s.title}>
              <span className="thumb">
                {s.cover ? <img src={s.cover} alt="" /> : <i />}
              </span>
              <span className="meta">
                <b>{s.title}</b>
                <small>{s.shot_count} 镜 · {s.image_count} 图{s.video_count ? ` · ${s.video_count} 视频` : ''}</small>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="side-foot">
        <button className="side-item" onClick={() => setView('media')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18v12H3zM8 6l1.5-2h5L16 6M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
          </svg>
          <span>素材库</span>
          {mediaCount ? <em>{mediaCount}</em> : null}
        </button>
        <button className="side-item" onClick={() => setView('styles')}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-.6-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h1.8A4.2 4.2 0 0 0 21 10.1C20.6 6 16.7 3 12 3z" />
          </svg>
          <span>风格库</span>
          {styles.length ? <em>{styles.length}</em> : null}
        </button>
        <button className="side-item" onClick={openSettings}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.2a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z" />
          </svg>
          <span>设置</span>
        </button>
      </div>
    </aside>
  );
}
