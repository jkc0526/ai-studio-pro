import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

const RATIOS = [
  { v: '16:9', label: '16:9 横屏' },
  { v: '9:16', label: '9:16 竖屏' },
  { v: '1:1', label: '1:1 方形' },
  { v: '4:3', label: '4:3' },
  { v: '3:4', label: '3:4' },
  { v: '21:9', label: '21:9 电影' },
];

const STATUS_TEXT = { running: '生成中', done: '完成', error: '失败' };

/* 视频节点：图生视频（参考图来自上游 UploadNode / AssetNode / ImageNode） */
export default function VideoNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [showSystem, setShowSystem] = useState(false);

  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ width: 300 }}>
      <div className="node-head">
        <span className="dot" style={{ background: '#9333EA' }} />
        <span>{data.label || '视频生成'}</span>
        {data.status && <span className={`badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        <div>
          <span className="field-label">运镜与动作（{'{{input}}'} 引用上游文本）</span>
          <textarea
            className="nodrag"
            rows={3}
            value={data.prompt || ''}
            placeholder="例如：镜头缓慢推近，发丝随风飘动，光影变化…"
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
              placeholder="不希望出现的内容（可选）"
              onChange={(e) => ctx.updateNode(id, { negativePrompt: e.target.value })}
            />
          )}
        </div>

        <div className="row2">
          <select className="nodrag" value={data.ratio || '16:9'} onChange={(e) => ctx.updateNode(id, { ratio: e.target.value })}>
            {RATIOS.map((r) => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
          <select className="nodrag" value={data.duration || 5} onChange={(e) => ctx.updateNode(id, { duration: Number(e.target.value) })}>
            {[3, 4, 5, 6, 8, 10].map((s) => <option key={s} value={s}>{s} 秒</option>)}
          </select>
        </div>

        <input
          className="nodrag"
          value={data.modelId || ''}
          placeholder="视频模型名（留空用全局设置）"
          onChange={(e) => ctx.updateNode(id, { modelId: e.target.value })}
        />

        {data.status === 'error' && data.error && <div className="err-box">{data.error}</div>}

        {data.videoUrl
          ? <video className="img-preview nodrag" src={data.videoUrl} controls />
          : (
            <div className="out-box empty">
              {data.imageUrl ? '已就绪参考图，运行后生成视频' : '等待上游图片（参考图会自动取最近的上游图像/素材）'}
            </div>
          )}
      </div>

      <div className="node-foot">
        <button className="primary" style={{ padding: '4px 9px' }} onClick={() => ctx.runNode(id)} disabled={data.status === 'running'}>
          ▶ 生成视频
        </button>
        {data.videoUrl && (
          <>
            <a className="btn" style={{ padding: '4px 9px' }} href={data.videoUrl} download>下载</a>
            <button style={{ padding: '4px 9px' }} onClick={() => ctx.copy(`${location.origin}${data.videoUrl}`)}>复制链接</button>
          </>
        )}
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}