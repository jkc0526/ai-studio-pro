import { useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';
import { api } from '../api.js';

/* 上传节点：支持拖入 / 选择本地文件（图片/视频），落盘后 URL 作为下游节点输入 */
export default function UploadNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => () => { /* unmount cleanup, no-op */ }, []);

  const handle = async (file) => {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { url } = await api.upload({ name: file.name, dataUrl });
      const isVideo = (file.type || '').startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
      ctx.updateNode(id, { url, fileName: file.name, kind: isVideo ? 'video' : 'image', status: 'done' });
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(false); }
  };

  const onPick = async (ev) => {
    const file = ev.target.files?.[0];
    if (file) await handle(file);
    ev.target.value = '';
  };

  const isVideo = data.kind === 'video';
  const labelColor = isVideo ? '#9333EA' : '#0EA5E9';

  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ width: 260 }}>
      <div className="node-head">
        <span className="dot" style={{ background: labelColor }} />
        <span>{data.label || (isVideo ? '上传视频' : '上传图片')}</span>
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        {!data.url ? (
          <div className="out-box empty" style={{ textAlign: 'center', padding: '14px 8px' }}>
            {busy ? '上传中…' : '拖入文件 或 点击下方按钮选择'}
          </div>
        ) : (
          isVideo
            ? <video className="img-preview nodrag" src={data.url} controls />
            : <img className="img-preview nodrag" src={data.url} alt={data.fileName || '上传'} />
        )}

        {err && <div className="err-box">{err}</div>}

        <input
          className="nodrag"
          value={data.label || ''}
          placeholder="节点备注（可选）"
          onChange={(e) => ctx.updateNode(id, { label: e.target.value })}
        />
      </div>

      <div className="node-foot">
        <label className="btn" style={{ padding: '4px 9px', cursor: 'pointer' }}>
          {data.url ? '替换文件' : '选择文件'}
          <input type="file" accept="image/*,video/*" hidden onChange={onPick} />
        </label>
        {data.url && (
          <button style={{ padding: '4px 9px' }} onClick={() => ctx.updateNode(id, { url: '', fileName: '', kind: null })}>清除</button>
        )}
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}