import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { AppCtx } from './context.js';
import SettingsModal from './components/SettingsModal.jsx';
import ScriptView from './views/ScriptView.jsx';
import StoryboardView from './views/StoryboardView.jsx';
import CharactersView from './views/CharactersView.jsx';
import CanvasView from './views/CanvasView.jsx';

const VIEWS = [
  { key: 'script', label: '剧本' },
  { key: 'storyboard', label: '分镜' },
  { key: 'characters', label: '角色' },
  { key: 'canvas', label: '画布' },
];

export default function App() {
  const [view, setView] = useState('script');
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

  const notify = useCallback((msg, isError = false) => {
    setToast({ msg: String(msg), isError });
    setTimeout(() => setToast(null), isError ? 6000 : 2600);
  }, []);

  const reloadScripts = useCallback(async (keepId) => {
    const list = await api.listScripts();
    setScripts(list);
    const next = keepId || scriptId || list[0]?.id || null;
    setScriptId(next);
    setScript(list.find((s) => s.id === next) || null);
    return list;
  }, [scriptId]);

  const reloadCharacters = useCallback(async () => {
    setCharacters(await api.listCharacters());
  }, []);

  const reloadStyles = useCallback(async () => {
    const list = await api.listStyles();
    setStyles(list);
    setStyleId((cur) => cur || list[0]?.id || '');
  }, []);

  const loadModels = useCallback(async () => {
    try {
      const m = await api.listModels();
      setModelInfo({
        list: m.list || [],
        groups: m.groups || { text: m.list || [], image: m.list || [], video: [] },
        defaults: m.defaults || {},
        blocked: m.blocked || [],
      });
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
      notify('已新建剧本');
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
    models: modelInfo.list, modelGroups: modelInfo.groups, modelDefaults: modelInfo.defaults, blockedModels: modelInfo.blocked, loadModels,
    notify,
    shotsTick, bumpShots: () => setShotsTick((t) => t + 1),
  }), [view, scripts, script, scriptId, selectScript, createScript, updateScript, deleteScript, reloadScripts,
    characters, reloadCharacters, styles, styleId, reloadStyles, modelInfo, loadModels, notify, shotsTick]);

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <div className="topbar">
          <div className="brand">Weave<span>Canvas</span></div>
          <div className="tabs-bar">
            {VIEWS.map((v) => (
              <button key={v.key} className={view === v.key ? 'active' : ''} onClick={() => setView(v.key)}>{v.label}</button>
            ))}
          </div>
          <div className="sep" />
          {view !== 'canvas' && (
            <>
              <select style={{ width: 200 }} value={scriptId || ''} onChange={(e) => selectScript(e.target.value)}>
                {!scripts.length && <option value="">（还没有剧本）</option>}
                {scripts.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <button onClick={createScript}>新建剧本</button>
            </>
          )}
          {view !== 'canvas' && (
            <>
              <div className="sep" />
              <span className="pill">风格</span>
              <select style={{ width: 150 }} value={styleId} onChange={(e) => setStyleId(e.target.value)}>
                {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          )}
          <div className="spacer" />
          <button onClick={() => setShowSettings(true)}>设置</button>
        </div>

        {view === 'script' && <ScriptView />}
        {view === 'storyboard' && <StoryboardView />}
        {view === 'characters' && <CharactersView />}
        {view === 'canvas' && <CanvasView notify={notify} />}
      </div>

      <SettingsModal
        open={showSettings}
        onClose={async () => {
          setShowSettings(false);
          await loadModels();
        }}
        notify={notify}
      />
      {toast && <div className={`toast ${toast.isError ? 'error' : ''}`}>{toast.msg}</div>}
    </AppCtx.Provider>
  );
}
