import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

export default function CharactersView() {
  const { characters, reloadCharacters, script, styleId, models, notify } = useApp();
  const [busy, setBusy] = useState('');
  const [model, setModel] = useState('');
  const imageModels = models.filter((m) => /image|dall|flux|sd/i.test(m));

  const patch = async (id, body) => {
    await api.updateCharacter(id, body);
    await reloadCharacters();
  };

  const add = async () => {
    await api.createCharacter({ name: `角色 ${characters.length + 1}`, role: '配角' });
    await reloadCharacters();
  };

  const remove = async (id, name) => {
    if (!window.confirm(`删除角色「${name}」？`)) return;
    await api.deleteCharacter(id);
    await reloadCharacters();
  };

  const extract = async () => {
    if (!script) return notify('先创建剧本', true);
    setBusy('extract');
    try {
      const r = await api.extractCharacters(script.id, { modelId: model || undefined });
      await reloadCharacters();
      notify(`识别出 ${r.created} 个角色${r.skipped ? `，跳过 ${r.skipped} 个已存在` : ''}`);
    } catch (e) { notify(e.message, true); } finally { setBusy(''); }
  };

  const sheet = async (c) => {
    setBusy(c.id);
    try {
      const r = await api.characterSheet(c.id, { styleId, modelId: model || undefined });
      await reloadCharacters();
      notify(`已生成「${c.name}」三视图`);
      return r;
    } catch (e) { notify(`三视图生成失败：${e.message}`, true); } finally { setBusy(''); }
  };

  return (
    <>
      <div className="view-bar">
        <span className="pill">角色档案 · 用于跨镜头保持一致</span>
        <div className="sep" />
        <select value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 190 }}>
          <option value="">用设置里的默认模型</option>
          {imageModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={extract} disabled={!!busy || !script}>
          {busy === 'extract' ? '识别中…' : '从剧本提取角色'}
        </button>
        <button onClick={add}>+ 新建角色</button>
        <div className="spacer" />
        <span className="pill">{characters.length} 个角色 · 风格：{styleId ? '已选' : '默认'}</span>
      </div>

      <div className="view-body">
        {!characters.length && (
          <div className="empty-card">
            <h3>还没有角色档案</h3>
            <p className="hint">点「从剧本提取角色」，AI 会为每个角色生成形象锁定描述（发型、服装、识别特征），生图时会自动注入到每一个镜头，解决"崩脸"问题。</p>
          </div>
        )}
        <div className="board" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {characters.map((c) => (
            <div className="shot" key={c.id}>
              <div className="shot-head">
                <span className="dot" style={{ background: '#D4537E' }} />
                <input style={{ width: 110, fontWeight: 500 }} value={c.name}
                  onChange={(e) => patch(c.id, { name: e.target.value })} />
                <input style={{ width: 76 }} value={c.role || ''} placeholder="定位"
                  onChange={(e) => patch(c.id, { role: e.target.value })} />
                <span className="spacer" />
                <button className="ghost tiny" onClick={() => remove(c.id, c.name)}>×</button>
              </div>

              <div className="shot-img" style={{ aspectRatio: '3 / 2' }}>
                {c.sheet_image_url
                  ? <img src={c.sheet_image_url} alt={`${c.name} 三视图`} />
                  : <span className="hint">三视图未生成</span>}
              </div>

              <div className="shot-body">
                <div className="field">
                  <label className="field-label">外形锁定（会写进每一镜的提示词）</label>
                  <textarea rows={4} value={c.appearance || ''} placeholder="性别年龄、发型发色、五官特征、体型、显著识别特征"
                    onChange={(e) => patch(c.id, { appearance: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">服装</label>
                  <textarea rows={2} value={c.outfit || ''} placeholder="常驻服装的颜色与材质"
                    onChange={(e) => patch(c.id, { outfit: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">性格</label>
                  <textarea rows={2} value={c.personality || ''} placeholder="性格与行为特征"
                    onChange={(e) => patch(c.id, { personality: e.target.value })} />
                </div>
              </div>

              <div className="shot-foot">
                <button className="primary" onClick={() => sheet(c)} disabled={busy === c.id}>
                  {busy === c.id ? '生成中…' : c.sheet_image_url ? '重做三视图' : '生成三视图'}
                </button>
                {c.sheet_image_url && <a className="btn" href={c.sheet_image_url} download>下载</a>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
