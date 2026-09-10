import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

export default function TextNode({ id, data, selected }) {
  const ctx = useCanvas();
  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      <div className="node-head">
        <span className="dot" style={{ background: '#378ADD' }} />
        <span>{data.label || '文本'}</span>
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>
      <div className="node-body">
        <textarea
          className="nodrag"
          rows={6}
          value={data.content || ''}
          placeholder="粘贴小说 / 剧本 / 素材文本"
          onChange={(e) => ctx.updateNode(id, { content: e.target.value })}
        />
      </div>
      <div className="node-foot">
        <span className="hint">{(data.content || '').length} 字 · 输出给下游节点</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
