import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

const SIZES = ['1024x1024', '1024x1536', '1536x1024', '512x512'];
const STATUS_TEXT = { running: '生成中', done: '完成', error: '失败' };

export default function ImageNode({ id, data, selected }) {
  const ctx = useCanvas();
  return (
    <div className="node ${selected ? 'selected' : ''}" style={{ width: 280 }}>
      <div className="node-head">
        <span className="dot" style={{ background: '#993C1D' }} />
        <span>{data.label || '图像生成'}</span>
        {data.status && <span className={`badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        <div>
          <span className="field-label">画面描述（可选 {'{{input}}'} 引用上游）</span>
          <textarea
            className="nodrag"
            rows={3}
            value={data.prompt || ''}
            placeholder="例如：电影感打光，人物特写，冷色调，超清细节"
            onChange={(e) => ctx.updateNode(id, { prompt: e.target.value })}
          />
        </div>

        <div className="row2">
          <select className="nodrag" value={data.size || '1024x1024'} onChange={(e) => ctx.updateNode(id, { size: e.target.value })}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            className="nodrag"
            value={data.modelId || ''}
            placeholder="模型名（留空用全局）"
            onChange={(e) => ctx.updateNode(id, { modelId: e.target.value })}
          />
        </div>

        {data.status === 'error' && data.error && <div className="err-box">{data.error}</div>}

        {data.imageUrl
          ? <img className="img-preview nodrag" src={data.imageUrl} alt="生成结果" />
          : <div className="out-box empty">尚未生成图片</div>}
      </div>

      <div className="node-foot">
        <button className="primary" style={{ padding: '4px 9px' }} onClick={() => ctx.runNode(id)} disabled={data.status === 'running'}>
          ▶ 生成
        </button>
        {data.imageUrl && (
          <>
            <a className="btn" style={{ padding: '4px 9px' }} href={data.imageUrl} download>下载</a>
            <button style={{ padding: '4px 9px' }} onClick={() => ctx.copy(`${location.origin}${data.imageUrl}`)}>复制链接</button>
          </>
        )}
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
