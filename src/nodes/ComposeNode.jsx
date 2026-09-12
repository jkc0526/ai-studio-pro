import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

const STATUS_TEXT = { running: '合成中', done: '完成', error: '失败' };

/* 视频合成：把上游的图片 / 视频片段按顺序拼成一条成片（服务端 ffmpeg） */
export default function ComposeNode({ id, data, selected }) {
  const ctx = useCanvas();

  return (
    <div className={`oii-node oii-node-compose ${selected ? 'on' : ''}`}>
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
          <path d="M4 6h16M4 12h10M4 18h16M18 10l3 2-3 2" />
        </svg>
        {data.label || '视频合成'}
        {data.status && <span className={`oii-badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
      </div>

      <div className={`oii-card ${data.videoUrl ? 'has-media' : ''}`} style={{ aspectRatio: '16 / 9' }}>
        {data.videoUrl
          ? <video src={data.videoUrl} controls muted loop playsInline className="nodrag" />
          : <span className="oii-ph">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M4 6h16M4 12h10M4 18h16" />
              </svg>
            </span>}
      </div>

      {data.status === 'error' && data.error && <div className="oii-err">{data.error}</div>}

      <div className="oii-prompt">
        <div className="oii-note">
          连接上游的<b>图片</b>或<b>视频</b>节点，按顺序拼接为一条成片。
        </div>
        <div className="oii-params">
          <select className="nodrag" value={data.ratio || '16:9'} onChange={(e) => ctx.updateNode(id, { ratio: e.target.value })}>
            {['16:9', '9:16', '1:1'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="nodrag" value={data.imageSeconds || 3} onChange={(e) => ctx.updateNode(id, { imageSeconds: Number(e.target.value) })}>
            {[2, 3, 4, 5].map((s) => <option key={s} value={s}>静帧 {s}s</option>)}
          </select>
          <span className="oii-spacer" />
          <button className="nodrag oii-send" disabled={data.status === 'running'} title="合成"
            onClick={() => ctx.runNode(id)}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
        {data.videoUrl && (
          <a className="oii-download nodrag" href={data.videoUrl} download>下载成片</a>
        )}
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
