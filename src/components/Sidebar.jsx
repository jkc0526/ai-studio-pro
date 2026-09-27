import { useApp } from '../context.js';

const NAV = [
  { key: 'home', label: '创作台', icon: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { key: 'projects', label: '项目', icon: 'M4 6h6l2 2h8v11H4z' },
  { key: 'agents', label: 'Agent', icon: 'M12 2v3M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12h.01M15 12h.01M9.5 16h5M5 11H3M21 11h-2' },
  { key: 'canvas', label: '画布', icon: 'M5 5h6v6H5zM13 5h6v6h-6zM9 13h6v6H9zM11 8h2M12 11v2' },
];

function Icon({ d }) {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

export default function Sidebar() {
  const { view, setView, createScript, toggleSidebar, sidebarCollapsed, scripts } = useApp();

  return (
    <aside className="sidebar">
      <div className="side-brand" onClick={() => setView('home')} title="回到创作台">
        <span className="brand-mark">W</span>
        <span className="brand-text">Weave<b>Canvas</b></span>
      </div>

      <button className="side-new" onClick={createScript} title="新建空白项目">
        <span>＋</span><b>新建项目</b>
      </button>

      <nav className="side-nav" aria-label="主导航">
        {NAV.map((n) => (
          <button key={n.key} className={`side-item ${view === n.key ? 'active' : ''}`} onClick={() => setView(n.key)} title={n.label}>
            <Icon d={n.icon} />
            <span>{n.label}</span>
            {n.key === 'projects' && scripts.length > 0 && <em>{scripts.length}</em>}
          </button>
        ))}
      </nav>

      <div className="side-hint">
        <span className="side-hint-dot" />
        <span>工作区已就绪</span>
      </div>

      <div className="side-foot">
        <button className="side-item side-collapse" onClick={toggleSidebar} title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}>
          <Icon d={sidebarCollapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} />
          <span>{sidebarCollapsed ? '展开侧栏' : '收起侧栏'}</span>
        </button>
      </div>
    </aside>
  );
}
