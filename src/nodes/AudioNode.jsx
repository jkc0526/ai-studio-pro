import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

/* 音频节点：当前网关无 TTS 接口，作为占位（可输入文本备注 / 或上传音频片段 URL） */
export default function AudioNode({ id, data, selected }) {
  const ctx = useCanvas();
  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ width: 260 }}>
      <div className="node-head">
        <span className="dot" style={{ background: '#10B981' }} />
        <span>{data.label || '音频节点'}</span>
        <span className="pill" style={{ background: '#FEF3C7', color: '#92400E' }}>占位</span>
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        <div className="out-box empty" style={{ textAlign: 'center', padding: '14px 8px', lineHeight: 1.5 }}>
          网关暂无 TTS 接口<br />
          <span style={{ fontSize: 12, color: '#999' }}>未来会接入配音 / BGM 生成</span>
        </div>

        <textarea
          className="nodrag"
          rows={3}
          value={data.text || ''}
          placeholder="可输入台词 / 旁白（暂不生成）"
          onChange={(e) => ctx.updateNode(id, { text: e.target.value })}
        />
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}