import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function SnippetsPanel({ open, targetNodeId, onInsert, onClose, notify }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState({ name: '', content: '' });
  const [adding, setAdding] = useState(false);

  const refresh = () => api.listSnippets().then(setItems).catch((e) => notify(e.message, true));

  useEffect(() => { if (open) refresh(); }, [open]);

  if (!open) return null;
  const targetLabel = targetNodeId ? '点击片段插入到所选节点' : '先在画布上选中一个节点';

  const add = async () => {
    if (!draft.name.trim() || !draft.content.trim()) return notify('名称和内容都不能为空', true);
    try {
      await api.createSnippet(draft);
      setDraft({ name: '', content: '' });
      setAdding(false);
      refresh();
    } catch (e) { notify(e.message, true); }
  };

  return (
    <div className="panel">
      <h3>
        <span>提示词片段库</span>
        <button className="ghost" onClick={onClose}>×</button>
      </h3>
      <div className="panel-body">
        <p className="hint" style={{ margin: 0 }}>{targetLabel}</p>

        {items.map((s) => (
          <div className="snippet" key={s.id}>
            <b>{s.name}</b>
            <p>{s.content}</p>
            <div className="snippet-actions">
              <button disabled={!targetNodeId} onClick={() => onInsert(s.content)}>插入到节点</button>
              <button onClick={() => { navigator.clipboard.writeText(s.content); notify('已复制'); }}>复制</button>
              <button onClick={async () => { await api.deleteSnippet(s.id); refresh(); }}>删除</button>
            </div>
          </div>
        ))}

        {adding ? (
          <div className="snippet">
            <input placeholder="片段名称" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <textarea rows={4} style={{ marginTop: 6 }} placeholder="提示词内容" value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })} />
            <div className="snippet-actions" style={{ marginTop: 6 }}>
              <button className="primary" onClick={add}>保存</button>
              <button onClick={() => setAdding(false)}>取消</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)}>+ 新建片段</button>
        )}
      </div>
    </div>
  );
}
