import { useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';
import { api } from '../api.js';

/* 素材库节点：从生成的图像/视频里挑一个作为输入，下游节点可以引用 */
export default function AssetNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.media(data.scriptId || '')
      .then((list) => { if (alive) setItems(list || []); })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [data.scriptId]);

  const visible = items
    .filter((m) => !filter || m.kind === filter)
    .filter((m) => !data.scriptId || m.script_id === data.scriptId || !m.script_id);

  const selectedAsset = items.find((m) => m.id === data.assetId);

  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ width: 280 }}>
      <div className="node-head">
        <span className="dot" style={{ background: '#F59E0B' }} />
        <span>{data.label || '素材库'}</span>
        {selectedAsset && <span className={`badge done`}>{selectedAsset.kind === 'video' ? '视频' : '图片'}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        {selectedAsset ? (
          selectedAsset.kind === 'video'
            ? <video className="img-preview nodrag" src={selectedAsset.file_path} controls />
            : <img className="img-preview nodrag" src={selectedAsset.file_path} alt="" />
        ) : (
          <div className="out-box empty" style={{ textAlign: 'center', padding: '14px 8px' }}>
            {loading ? '加载素材…' : '下方挑一个素材'}
          </div>
        )}

        <div className="row2">
          <select className="nodrag" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部类型</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
          </select>
          <span className="pill">{items.length} 个素材</span>
        </div>

        <div className="grid-pick nodrag" style={{ maxHeight: 160, overflow: 'auto' }}>
          {visible.length === 0 && <div style={{ color: '#999', fontSize: 12, padding: 6 }}>暂无素材</div>}
          {visible.map((m) => (
            <button
              key={m.id}
              className={`thumb ${data.assetId === m.id ? 'on' : ''}`}
              onClick={() => ctx.updateNode(id, { assetId: m.id, url: m.file_path, kind: m.kind })}
              title={m.prompt || m.file_path}
            >
              {m.kind === 'video'
                ? <span className="thumb-vid">▶</span>
                : null}
              <img src={m.file_path} alt="" />
            </button>
          ))}
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}