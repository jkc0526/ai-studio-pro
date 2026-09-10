import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { AppCtx } from './context.js';
import SettingsModal from './components/SettingsModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import HomeView from './views/HomeView.jsx';
import ScriptView from './views/ScriptView.jsx';
import StoryboardView from './views/StoryboardView.jsx';
import CharactersView from './views/CharactersView.jsx';
import CanvasView from './views/CanvasView.jsx';
import MediaView from './views/MediaView.jsx';
import StylesView from './views/StylesView.jsx';

const TITLES = {
  home: '创作台', script: '剧本', storyboard: '分镜', characters: '角色',
  canvas: '画布', media: '素材库', styles: '风格库',
};

export default function App() {
  const [view, setView] = useState('home');
  const [scripts, setScripts] = useState([]);
  const [scriptId, setScriptId] = useState(null);
  const [script, setScript] = useState(null);
  const [characters, setCharacters] = useState([]);
  const [styles, setStyles] = useState([]);
  const [modelInfo, setModelInfo] = useState({ list: [], groups: { text: [], image: [], video: [] }, defaults: {}, blocked: [] });
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

  const loadModels = useCallback(async (purpose = 'thinking') => {
    try {
      const m = await api.listModels(`purpose=${purpose}`);
      setModelInfo((prev) => ({
        list: m.list?.length ? m.list : prev.list,
        groups: (m.groups?.text?.length || m.groups?.image?.length || m.groups?.video?.length) ? m.groups : prev.groups,
        defaults: m.defaults || prev.defaults,
        blocked: m.blocked || [],
        source: m.source || prev.source,
        error: m.error,
      }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listScripts();
        setScripts(list);
        if (list.length) { setScriptId(list[0].id); setScript(list[0]); }
        await reloadCharacters();
        await reloadStyles();
        await loadModels();
        const media = await api.media();
        setMediaCount(media.length);
      } catch (e) { notify(`初始化失败：${e.message}`, true); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { localStorage.setItem('weave.styleId', styleId); }, [styleId]);

  const selectScript = useCallback(async (id) => {
    setScriptId(id);
    setScript(scripts.find((s) => s.id === id) || null);
  }, [scripts]);

  const createScript = useCallback(async () => {
    try {
      const s = await api.createScript({ title: `新剧本 ${scripts.length + 1}` });
      await reloadScripts(s.id);
      setScript(s);
      setView('script');
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
    view, setView,
    scripts, script, scriptId, selectScript, createScript, updateScript, deleteScript, reloadScripts,
    characters, reloadCharacters,
    styles, styleId, setStyleId, reloadStyles,
    models: modelInfo.list, modelGroups: modelInfo.groups, modelDefaults: modelInfo.defaults,
    blockedModels: modelInfo.blocked, modelSource: modelInfo.source, loadModels,
    mediaCount,
    openSettings: () => setShowSettings(true),
    notify,
    shotsTick, bumpShots: () => setShotsTick((t) => t + 1),
  }), [view, scripts, script, scriptId, selectScript, createScript, updateScript, deleteScript, reloadScripts,
    characters, reloadCharacters, styles, styleId, reloadStyles, modelInfo, loadModels, mediaCount, notify, shotsTick]);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="shell">
        <Sidebar />
        <div className="main">
          <header className="topbar">
            <span className="crumb">{TITLES[view] || ''}</span>
            {script && !['home', 'canvas', 'styles', 'media'].includes(view) && (
              <>
                <span className="sep" />
                <select style={{ width: 190 }} value={scriptId || ''} onChange={(e) => selectScript(e.target.value)}>
                  {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                </select>
              </>
            )}
            <div className="spacer" />
            <span className="pill">{modelInfo.source ? `模型来源：${modelInfo.source}` : '模型未配置'}</span>
            <span className="pill">
              文本 {modelInfo.groups?.text?.length || 0} · 图像 {modelInfo.groups?.image?.length || 0} · 视频 {modelInfo.groups?.video?.length || 0}
            </span>
            <button className="ghost" onClick={() => { loadModels(); notify('已刷新模型列表'); }}>刷新模型</button>
            <button onClick={() => setShowSettings(true)}>设置</button>
          </header>

          <div className="content">
            {view === 'home' && <HomeView />}
            {view === 'script' && <ScriptView />}
            {view === 'storyboard' && <StoryboardView />}
            {view === 'characters' && <CharactersView />}
            {view === 'canvas' && <CanvasView notify={notify} />}
            {view === 'media' && <MediaView />}
            {view === 'styles' && <StylesView />}
          </div>
        </div>
      </div>

      <SettingsModal
        open={showSettings}
        onClose={async () => { setShowSettings(false); await loadModels(); }}
        notify={notify}
      />
      {toast && <div className={`toast ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>}
    </AppCtx.Provider>
  );
}
