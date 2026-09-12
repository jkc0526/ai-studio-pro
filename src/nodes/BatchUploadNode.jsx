import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';
import { api } from '../api.js';

/* 批量上传：一次导入多个图片 / 视频，落盘后每个文件作为可引用的素材
   节点上列出缩略图，下游节点用 {{input}} 会接到全部文件 URL（换行分隔）。 */
export default function BatchUploadNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const items = Array.isArray(data.items) ? data.items : [];

  const onPick = async (ev) => {
    const files = Array.from(ev.target.files || []);
    if (!files.length) return;
    setBusy(true); setErr(null);
    try {
      const payload = [];
      for (const f of files) {
        const dataUrl = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result); r.onerror = rej;
          r.readAsDataURL(f);
        });
        payload.push({ name: f.name, type: f.type, dataUrl });
      }
      const { saved } = await api.uploadBatch({ files: payload });
      const next = [...items, ...saved];
      ctx.updateNode(id, { items: next, status: 'done' });
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); ev.target.value = ''; }
  };

  const remove = (url) => {
    ctx.updateNode(id, { items: items.filter((it) => it.url !== url) });
  };

  return (
    <div className={`oii-node oii-node-batch ${selected ? 'on' : ''}`}>
      {selected && (
        <div className="oii-toolbar nodrag">
          <button className="oii-tb oii-tb-text" onClick={() => ctx.deleteNode(id)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
            </svg>
            删除
          </button>
        </div>
      )}

      <div className="oii-node-title">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
        </svg>
        {data.label || '批量上传'}
        {items.length > 0 && <span className="oii-count">{items.length}</span>}
      </div>

      <div className="oii-card oii-batch-card">
        {items.length === 0
          ? <span className="oii-ph" style={{ flexDirection: 'column', gap: 6 }}>
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
              </svg>
              <small>{busy ? '上传中…' : '批量导入图片或其他文件'}</small>
            </span>
          : (
            <div className="oii-batch-grid nodrag">
              {items.map((it) => (
                <div className="oii-batch-cell" key={it.url} title={it.name}>
                  {it.kind === 'video'
                    ? <video src={it.url} muted />
                    : <img src={it.url} alt={it.name} />}
                  <button className="oii-batch-del" onClick={() => remove(it.url)}>×</button>
                </div>
              ))}
            </div>
          )}
      </div>

      {err && <div className="oii-err">{err}</div>}

      <div className="oii-prompt">
        <div className="oii-params">
          <label className="nodrag oii-upload-btn">
            {busy ? '上传中…' : '＋ 选择文件'}
            <input type="file" accept="image/*,video/*" multiple hidden onChange={onPick} />
          </label>
          <span className="oii-spacer" />
          {items.length > 0 && <span className="oii-hint">{items.length} 个文件</span>}
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
