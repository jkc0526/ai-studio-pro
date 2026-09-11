import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

const GRIDS = [
  { v: 4, label: '2×2 (4)' },
  { v: 6, label: '2×3 (6)' },
  { v: 9, label: '3×3 (9)' },
  { v: 12, label: '3×4 (12)' },
  { v: 16, label: '4×4 (16)' },
  { v: 25, label: '5×5 (25)' },
];

const STATUS_TEXT = { running: '生成中', done: '完成', error: '失败' };

/* 九宫格节点：同一提示词生成多张不同构图（用于分镜一次性出图备选） */
export default function GridNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [showSystem, setShowSystem] = useState(false);

  const count = Number(data.count) || 9;
  const images = Array.isArray(data.images) ? data.images : [];

  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ width: 320 }}>
      <div className="node-head">
        <span className="dot" style={{ background: '#EC4899' }} />
        <span>{data.label || '九宫格生图'}</span>
        {data.status && <span className={`badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        <div>
          <span className="field-label">画面描述（{'{{input}}'} 引用上游）</span>
          <textarea
            className="nodrag"
            rows={3}
            value={data.prompt || ''}
            placeholder="例如：电影感打光，漫画分镜，主体人物，多种构图"
            onChange={(e) => ctx.updateNode(id, { prompt: e.target.value })}
          />
        </div>

        <div>
          <span className="field-label">
            <button className="ghost" style={{ padding: '0 4px', marginLeft: 6 }} onClick={() => setShowSystem((v) => !v)}>
              {showSystem ? '收起负向提示' : '负向提示'}
            </button>
          </span>
          {showSystem && (
            <textarea
              className="nodrag"
              rows={2}
              value={data.negativePrompt || ''}
              placeholder="低清，畸形，多余手指…"
              onChange={(e) => ctx.updateNode(id, { negativePrompt: e.target.value })}
            />
          )}
        </div>

        <div className="row2">
          <select className="nodrag" value={data.count || 9} onChange={(e) => ctx.updateNode(id, { count: Number(e.target.value) })}>
            {GRIDS.map((g) => <option key={g.v} value={g.v}>{g.label}</option>)}
          </select>
          <select className="nodrag" value={data.size || '1024x1024'} onChange={(e) => ctx.updateNode(id, { size: e.target.value })}>
            {['1024x1024', '1024x1536', '1536x1024', '512x512'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <input
          className="nodrag"
          value={data.modelId || ''}
          placeholder="模型名（留空用全局）"
          onChange={(e) => ctx.updateNode(id, { modelId: e.target.value })}
        />

        {data.status === 'error' && data.error && <div className="err-box">{data.error}</div>}

        {images.length > 0 ? (
          <div className="img-grid nodrag">
            {images.map((url, i) => (
              <div key={i} className={`img-grid-cell ${data.pickedIndex === i ? 'on' : ''}`}
                   onClick={() => ctx.updateNode(id, { pickedIndex: i, imageUrl: url })}>
                <img src={url} alt={`#${i + 1}`} />
                {data.pickedIndex === i && <span className="img-grid-mark">✓</span>}
              </div>
            ))}
          </div>
        ) : (
          <div className="out-box empty">尚未生成（点击下方「生成」会请求 {count} 张图）</div>
        )}
      </div>

      <div className="node-foot">
        <button className="primary" style={{ padding: '4px 9px' }} onClick={() => ctx.runNode(id)} disabled={data.status === 'running'}>
          ▶ 生成 {count} 张
        </button>
        {data.imageUrl && (
          <>
            <a className="btn" style={{ padding: '4px 9px' }} href={data.imageUrl} download>下载选中</a>
            <span className="pill">{images.length} 张</span>
          </>
        )}
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}