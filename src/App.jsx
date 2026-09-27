import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { AppCtx } from './context.js';
import SettingsModal from './components/SettingsModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import HomeView from './views/HomeView.jsx';
import ProjectsView from './views/ProjectsView.jsx';

const ProjectWorkspace = lazy(() => import('./views/ProjectWorkspace.jsx'));
const CanvasView = lazy(() => import('./views/CanvasView.jsx'));
const AgentView = lazy(() => import('./views/AgentView.jsx'));

const TITLES = {
  home: '创作台', projects: '项目', canvas: '画布', agents: 'Agent 应用',
};

export default function App() {
  const [view, setView] = useState('home');
  const [projectTab, setProjectTab] = useState('script');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('weave.sidebarCollapsed') === '1');
  const [agentDraft, setAgentDraft] = useState(null);
  const [scripts, setScripts] = useState([]);
  const [scriptId, setScriptId] = useState(null);
  const [script, setScript] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [styles, setStyles] = useState([]);
  const [modelInfo, setModelInfo] = useState({ list: [], groups: { text: [], image: [], video: [] }, defaults: {}, blocked: [], imageProvider: null, videoProvider: null, videoCapabilities: {}, videoPrices: {} });
  const [providers, setProviders] = useState([]);
  const [styleId, setStyleId] = useState(() => localStorage.getItem('weave.styleId') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const [shotsTick, setShotsTick] = useState(0);
  const [mediaCount, setMediaCount] = useState(0);

  const notify = useCallback((msg, isError = false) => {
    setToast({ msg: String(msg), isError });
    setTimeout(() => setToast(null), isError ? 6500 : 2600);
  }, []);

  const reloadScripts = useCallback(async (keepId) => {
    const list = await api.listScripts();
    setScripts(list);
    setScriptId((cur) => {
      const next = keepId || cur || list[0]?.id || null;
      setScript(list.find((s) => s.id === next) || null);
      return next;
    });
    return list;
  }, []);

  const reloadCharacters = useCallback(async () => setCharacters(await api.listCharacters()), []);

  const reloadStyles = useCallback(async () => {
    const list = await api.listStyles();
    setStyles(list);
    setStyleId((cur) => cur || list[0]?.id || '');
  }, []);

  const loadProviders = useCallback(async () => {
    try { setProviders(await api.listProviders()); }
    catch { /* settings/provider list may be unavailable while the server starts */ }
  }, []);

  const loadModels = useCallback(async (purpose = 'all') => {
    try {
      if (purpose && purpose !== 'all') {
        const m = await api.listModels(`purpose=${purpose}`);
        setModelInfo((prev) => ({
          list: m.list?.length ? m.list : prev.list,
          groups: (m.groups?.text?.length || m.groups?.image?.length || m.groups?.video?.length) ? m.groups : prev.groups,
          defaults: m.defaults || prev.defaults,
          blocked: m.blocked || [],
          imageProvider: purpose === 'image_gen' ? {
            id: m.providerId || null,
            name: m.providerName || m.source || '默认供应商',
            protocol: m.providerProtocol || null,
          } : prev.imageProvider,
          videoProvider: purpose === 'video' ? {
            id: m.providerId || null,
            name: m.providerName || m.source || '默认供应商',
            protocol: m.providerProtocol || null,
          } : prev.videoProvider,
          videoCapabilities: purpose === 'video' ? (m.modelCapabilities || {}) : prev.videoCapabilities,
          videoPrices: purpose === 'video' ? (m.modelPrices || {}) : prev.videoPrices,
          source: m.source || prev.source,
          error: m.error,
        }));
        return;
      }
      // 默认刷新三个用途，各自取对应 provider 的模型，避免视频节点下拉出现 thinking provider 的模型
      const purposes = ['thinking', 'image_gen', 'video'];
      const maps = { thinking: 'text', image_gen: 'image', video: 'video' };
      const merged = { list: [], groups: { text: [], image: [], video: [] }, defaults: {}, blocked: [], sources: [], imageProvider: null, videoProvider: null, videoCapabilities: {}, videoPrices: {} };
      for (const p of purposes) {
        const m = await api.listModels(`purpose=${p}`);
        const kind = maps[p];
        if (m.groups?.[kind]?.length) merged.groups[kind] = m.groups[kind];
        if (m.defaults?.[kind]) merged.defaults[kind] = m.defaults[kind];
        if (m.list?.length) merged.list = [...merged.list, ...m.list];
        if (m.blocked?.length) merged.blocked = [...merged.blocked, ...m.blocked];
        if (m.source) merged.sources.push(m.source);
        if (p === 'image_gen') merged.imageProvider = {
          id: m.providerId || null,
          name: m.providerName || m.source || '默认供应商',
          protocol: m.providerProtocol || null,
        };
        if (p === 'video') merged.videoProvider = {
          id: m.providerId || null,
          name: m.providerName || m.source || '默认供应商',
          protocol: m.providerProtocol || null,
        };
        if (p === 'video') {
          merged.videoCapabilities = m.modelCapabilities || {};
          merged.videoPrices = m.modelPrices || {};
        }
        if (m.error && !merged.error) merged.error = m.error;
      }
      setModelInfo((prev) => ({
        list: merged.list.length ? [...new Set(merged.list)] : prev.list,
        groups: (merged.groups.text.length || merged.groups.image.length || merged.groups.video.length) ? merged.groups : prev.groups,
        defaults: Object.keys(merged.defaults).length ? merged.defaults : prev.defaults,
        blocked: merged.blocked.length ? [...new Set(merged.blocked)] : prev.blocked,
        imageProvider: merged.imageProvider || prev.imageProvider,
        videoProvider: merged.videoProvider || prev.videoProvider,
        videoCapabilities: Object.keys(merged.videoCapabilities).length ? merged.videoCapabilities : prev.videoCapabilities,
        videoPrices: merged.videoPrices,
        source: merged.sources.length ? merged.sources.join(' / ') : prev.source,
        error: merged.error,
      }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listScripts();
        setScripts(list);
        if (list.length) { setScriptId(list[0].id); setScript(list[0]); setProjectTab(list[0].shot_count ? 'storyboard' : 'script'); }
        await reloadCharacters();
        await reloadStyles();
        await Promise.all([loadModels(), loadProviders()]);
        const media = await api.media();
        setMediaCount(media.length);
      } catch (e) { notify(`初始化失败：${e.message}`, true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { localStorage.setItem('weave.styleId', styleId); }, [styleId]);
  useEffect(() => { localStorage.setItem('weave.sidebarCollapsed', sidebarCollapsed ? '1' : '0'); }, [sidebarCollapsed]);

  const selectScript = useCallback(async (id) => {
    setScriptId(id);
    setScript(scripts.find((s) => s.id === id) || null);
  }, [scripts]);

  const openProject = useCallback((id, tab = null) => {
    const selected = scripts.find((s) => s.id === id) || null;
    if (id) {
      setScriptId(id);
      setScript(selected);
    }
    setProjectTab(tab || (selected?.shot_count ? 'storyboard' : 'script'));
    setView('projects');
  }, [scripts]);

  const openAgentDraft = useCallback((draft) => {
    setAgentDraft(draft || null);
    setView('agents');
  }, []);

  const openProjects = useCallback(() => {
    setScriptId(null);
    setScript(null);
    setView('projects');
  }, []);

  const navigateView = useCallback((next) => {
    const projectTabs = { script: 'script', storyboard: 'storyboard', characters: 'assets', styles: 'assets', media: 'output', production: 'script' };
    if (projectTabs[next]) {
      setProjectTab(projectTabs[next]);
      setView('projects');
      return;
    }
    setView(next);
  }, []);

  const createScript = useCallback(async () => {
    try {
      const s = await api.createScript({ title: `新剧本 ${scripts.length + 1}` });
      await reloadScripts(s.id);
      setScript(s);
      setProjectTab('script');
      setView('projects');
      notify('已新建剧本');
      return s;
    } catch (e) { notify(e.message, true); }
  }, [scripts.length, reloadScripts, notify]);

  const updateScript = useCallback(async (patch) => {
    if (!script) return;
    const saved = await api.updateScript(script.id, patch);
    setScript(saved);
    setScripts((list) => list.map((s) => (s.id === saved.id ? { ...s, title: saved.title } : s)));
  }, [script]);

  const deleteScript = useCallback(async () => {
    if (!script || !window.confirm(`删除剧本「${script.title}」及其全部分镜？`)) return;
    await api.deleteScript(script.id);
    const list = await reloadScripts();
    setScript(list[0] || null);
    notify('剧本已删除');
  }, [script, reloadScripts, notify]);

  const ctx = useMemo(() => ({
    view, setView: navigateView, projectTab, setProjectTab, openProject, openProjects, openAgentDraft,
    sidebarCollapsed, toggleSidebar: () => setSidebarCollapsed((v) => !v),
    agentDraft, clearAgentDraft: () => setAgentDraft(null),
    scripts, script, scriptId, selectScript, createScript, updateScript, deleteScript, reloadScripts,
    characters, reloadCharacters,
    styles, styleId, setStyleId, reloadStyles,
    models: modelInfo.list, modelGroups: modelInfo.groups, modelDefaults: modelInfo.defaults,
    imageDefaultProvider: modelInfo.imageProvider, imageProviders: providers,
    videoDefaultProvider: modelInfo.videoProvider, videoDefaultModel: modelInfo.defaults.video,
    videoModelCapabilities: modelInfo.videoCapabilities, videoProviders: providers, loadProviders,
    videoModelPrices: modelInfo.videoPrices,
    blockedModels: modelInfo.blocked, modelSource: modelInfo.source, loadModels,
    mediaCount,
    openSettings: () => setShowSettings(true),
    notify,
    shotsTick, bumpShots: () => setShotsTick((t) => t + 1),
  }), [view, navigateView, projectTab, openProject, openProjects, openAgentDraft, sidebarCollapsed, agentDraft,
    scripts, script, scriptId, selectScript, createScript, updateScript, deleteScript, reloadScripts,
    characters, reloadCharacters, styles, styleId, reloadStyles, modelInfo, providers, loadProviders, loadModels, mediaCount, notify, shotsTick]);

  return (
    <AppCtx.Provider value={ctx}>
      <div className={`shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <Sidebar />
        <div className="main">
          <header className="topbar">
            <span className="crumb">{TITLES[view] || ''}</span>
            {script && view === 'projects' && (
              <>
                <span className="sep" />
                <select style={{ width: 190 }} value={scriptId || ''} onChange={(e) => selectScript(e.target.value)}>
                  {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
              </>
            )}
            {script && view === 'projects' && <button className="ghost tiny" onClick={openProjects}>所有项目</button>}
            <div className="spacer" />
            <button className="model-status" title="查看模型状态" onClick={() => setShowSettings(true)}>
              <span className={`status-dot ${modelInfo.source ? 'ok' : ''}`} />
              <span>{modelInfo.source ? '模型已连接' : '模型未配置'}</span>
            </button>
            <button className="icon-btn" title="刷新模型" aria-label="刷新模型" onClick={() => { loadModels(); loadProviders(); notify('已刷新模型列表'); }}>↻</button>
            <button className="icon-btn" title="设置" aria-label="设置" onClick={() => setShowSettings(true)}>⚙</button>
          </header>

          <div className="content">
            {view === 'home' && <HomeView />}
            {view === 'projects' && !script && <ProjectsView />}
            <Suspense fallback={<div className="view-body center"><div className="hint">正在加载工作区…</div></div>}>
              {view === 'projects' && script && <ProjectWorkspace />}
              {view === 'canvas' && <CanvasView notify={notify} />}
              {view === 'agents' && <AgentView />}
            </Suspense>
          </div>
        </div>
      </div>

      <SettingsModal
        open={showSettings}
        onClose={async () => { setShowSettings(false); await Promise.all([loadModels(), loadProviders()]); }}
        notify={notify}
      />
      {toast && <div className={`toast ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>}
    </AppCtx.Provider>
  );
}
