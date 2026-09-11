import { useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas, useApp } from '../context.js';
import { api } from '../api.js';

/* 脚本节点：把剧本正文 / 梗概 / 标题当作输入，常用于「剧本 → 分镜」 */
export default function ScriptNode({ id, data, selected }) {
  const ctx = useCanvas();
  const app = useApp();
  const [items, setItems] = useState([]);

  useEffect(() => {
    api.listScripts().then((list) => {
      setItems(list || []);
      if (!data.scriptId && list?.length) {
        ctx.updateNode(id, { scriptId: list[0].id });
      }
    }).catch(() => setItems([]));
  }, [id]);

  const script = items.find((s) => s.id === data.scriptId) || (data.scriptId ? { id: data.scriptId, title: '加载中…', content: '' } : null);

  const onPick = (e) => {
    const newId = e.target.value;
    ctx.updateNode(id, { scriptId: newId });
  };

  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ width: 280 }}>
      <div className="node-head">
        <span className="dot" style={{ background: '#7C3AED' }} />
        <span>{data.label || '剧本引用'}</span>
        {script && <span className={`badge done`}>{script.title?.slice(0, 16) || ''}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        <select className="nodrag" value={data.scriptId || ''} onChange={onPick}>
          <option value="" disabled>选择一个剧本…</option>
          {items.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>

        {script ? (
          <>
            {script.outline && (
              <div className="out-box" style={{ maxHeight: 80, overflow: 'auto' }}>
                <strong>梗概：</strong>{script.outline}
              </div>
            )}
            <div className="out-box empty" style={{ maxHeight: 160, overflow: 'auto', fontFamily: 'var(--font-mono, monospace)', fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {script.content || '（剧本正文为空）'}
            </div>
            <div className="row2">
              <label className="hint"><input type="checkbox" checked={data.includeOutline !== false} onChange={(e) => ctx.updateNode(id, { includeOutline: e.target.checked })} /> 含梗概</label>
              <span className="pill">{(script.content || '').length} 字</span>
            </div>
          </>
        ) : (
          <div className="out-box empty" style={{ textAlign: 'center', padding: '14px 8px' }}>
            没有可引用的剧本
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}