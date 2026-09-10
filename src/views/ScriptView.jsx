import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

export default function ScriptView() {
  const { script, createScript, updateScript, deleteScript, styleId, modelGroups, modelDefaults, notify, setView, bumpShots, reloadCharacters } = useApp();
  const [form, setForm] = useState({ title: '', outline: '', content: '' });
  const [count, setCount] = useState(6);
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState('');
  const [dirtyAt, setDirtyAt] = useState(null);
  const [existing, setExisting] = useState({ total: 0, withImage: 0 });
  const [mode, setMode] = useState('replace');

  useEffect(() => {
    if (!script) return;
    setForm({ title: script.title || '', outline: script.outline || '', content: script.content || '' });
    api.listShots(script.id).then((list) => {
      setExisting({ total: list.length, withImage: list.filter((s) => s.image_url).length });
    }).catch(() => setExisting({ total: 0, withImage: 0 }));
  }, [script?.id]);

  useEffect(() => {
    if (!script) return;
    const t = setTimeout(async () => {
      try {
        await updateScript(form);
        setDirtyAt(new Date());
      } catch (e) { notify(`保存失败：${e.message}`, true); }
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  const thinkingModels = modelGroups?.text || [];

  if (!script) {
    return (
      <div className="view-body center">
        <div className="empty-card">
          <h3>还没有剧本</h3>
          <p className="hint">新建一个剧本，粘贴小说或直接写故事，然后一键拆分镜。</p>
          <button className="primary" onClick={createScript}>+ 新建剧本</button>
        </div>
      </div>
    );
  }

  const split = async () => {
    if (mode === 'replace' && existing.total > 0) {
      const okToGo = window.confirm(
        `「覆盖」会删除当前剧本已有的 ${existing.total} 个镜头${existing.withImage ? `（其中 ${existing.withImage} 个已出图，会被一并删除）` : ''}，确定继续？`
      );
      if (!okToGo) return;
    }
    setBusy('split');
    try {
      const r = await api.splitShots(script.id, { count, styleId, modelId: model || undefined, mode });
      notify(`已生成 ${r.created} 个镜头${r.deleted ? `，清理旧镜头 ${r.deleted} 个` : ''}${r.warning ? ` · ${r.warning}` : ''}`);
      bumpShots();
      setView('storyboard');
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  const extract = async () => {
    setBusy('extract');
    try {
      const r = await api.extractCharacters(script.id, { modelId: model || undefined });
      await reloadCharacters();
      notify(`识别出 ${r.created} 个角色${r.skipped ? `，跳过 ${r.skipped} 个已存在` : ''}`);
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  return (
    <>
      <div className="view-bar">
        <span className="pill">剧本</span>
        <input style={{ width: 220 }} value={form.title} placeholder="剧本标题"
          onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <div className="sep" />
        <span className="pill">拆分镜</span>
        <select value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 90 }}>
          {[4, 6, 9, 12, 16].map((n) => <option key={n} value={n}>{n} 个镜头</option>)}
        </select>
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 190 }}>
          <option value="">用设置里的默认模型</option>
          {thinkingModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="primary" onClick={split} disabled={!!busy || !form.content.trim()}>
          {busy === 'split' ? '拆分中…' : '① 一键拆分镜'}
        </button>
        <select value={mode} onChange={(e) => setMode(e.target.value)} style={{ width: 150 }} title="已有镜头如何处理">
          <option value="replace">覆盖已有镜头</option>
          <option value="append">追加到现有镜头</option>
        </select>
        {existing.total > 0 && <span className="pill">现有 {existing.total} 镜（{existing.withImage} 镜已出图）</span>}
        <button onClick={extract} disabled={!!busy || !form.content.trim()}>
          {busy === 'extract' ? '识别中…' : '② 从剧本提取角色'}
        </button>
        <div className="sep" />
        <button onClick={() => setView('storyboard')}>去分镜 →</button>
        <div className="spacer" />
        <span className="pill">{form.content.length} 字{dirtyAt ? ` · 已保存 ${dirtyAt.toLocaleTimeString('zh-CN')}` : ''}</span>
        <button onClick={deleteScript}>删除剧本</button>
      </div>

      <div className="view-body script-grid">
        <div className="field">
          <label className="field-label">故事梗概（可选，会作为拆分镜的上下文）</label>
          <textarea rows={3} value={form.outline} placeholder="一两句话说明故事走向与核心冲突"
            onChange={(e) => setForm({ ...form, outline: e.target.value })} />
        </div>
        <div className="field grow">
          <label className="field-label">剧本正文 / 小说原文</label>
          <textarea className="script-body" value={form.content}
            placeholder={'直接粘贴小说原文，或按剧本格式书写：\n\n残阳如血。玄青独立孤峰断崖，玄色长袍被山风灌满。\n白鹤：师兄，秘宝交出来，我放你下山。\n玄青：当年师父死在你手上，你也是这么说的。'}
            onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </div>
        <div className="hint">
          流程：写剧本 → ① 一键拆分镜（AI 生成镜头表）→ ② 提取角色（生成形象锁定档案，保证每镜同一张脸）→ 去分镜页批量生图。
        </div>
      </div>
    </>
  );
}
