import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.js';

export default function StylesView() {
  const { styles, reloadStyles, styleId, setStyleId, notify, script } = useApp();
  const [draft, setDraft] = useState({ name: '', promptPrefix: '' });
  const [adding, setAdding] = useState(false);

  const add = async () => {
    if (!draft.name.trim() || !draft.promptPrefix.trim()) return notify('名称和风格描述都要填', true);
    await api.createStyle(draft);
    setDraft({ name: '', promptPrefix: '' });
    setAdding(false);
    await reloadStyles();
    notify('风格已添加');
  };

  return (
    <>
      <div className="view-bar">
        <span className="pill">风格库 · 会作为前缀注入每一条绘图提示词</span>
        <div className="sep" />
        <button className="primary" onClick={() => setAdding((v) => !v)}>{adding ? '收起' : '+ 新建风格'}</button>
        <div className="spacer" />
        <span className="hint">当前项目：{script?.title || '未选择剧本'}</span>
      </div>

      <div className="view-body">
        {adding && (
          <div className="config-card" style={{ marginBottom: 12 }}>
            <div className="row3">
              <div className="field"><label className="field-label">风格名称</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="例如：胶片黑白" /></div>
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label className="field-label">风格提示词前缀</label>
                <input value={draft.promptPrefix} onChange={(e) => setDraft({ ...draft, promptPrefix: e.target.value })}
                  placeholder="例如：35mm 黑白胶片摄影，高对比颗粒，硬光，纪实风格" />
              </div>
            </div>
            <div className="snippet-actions"><button className="primary" onClick={add}>保存风格</button></div>
          </div>
        )}

        <div className="style-grid">
          {styles.map((s) => (
            <div className={`style-card ${styleId === s.id ? 'on' : ''}`} key={s.id}>
              <div className="style-head">
                <b>{s.name}</b>
                {s.builtin ? <span className="keytag">内置</span> : <span className="keytag">自定义</span>}
              </div>
              <p className="hint">{s.prompt_prefix}</p>
              <div className="snippet-actions">
                <button className={styleId === s.id ? 'primary' : ''} onClick={() => { setStyleId(s.id); notify(`已切换风格：${s.name}`); }}>
                  {styleId === s.id ? '使用中' : '设为当前'}
                </button>
                {!s.builtin && (
                  <button className="ghost tiny" onClick={async () => {
                    if (!window.confirm(`删除风格「${s.name}」？`)) return;
                    await api.deleteStyle(s.id); await reloadStyles();
                  }}>删除</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
