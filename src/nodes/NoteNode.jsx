import { useCanvas } from '../context.js';

export default function NoteNode({ id, data, selected }) {
  const ctx = useCanvas();
  return (
    <div className={`node ${selected ? 'selected' : ''}`} style={{ background: '#FFFBF0', borderColor: '#F0DCB6' }}>
      <div className="node-head" style={{ borderColor: '#F0DCB6' }}>
        <span className="dot" style={{ background: '#BA7517' }} />
        <span>{data.label || '备注'}</span>
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>
      <div className="node-body">
        <textarea
          className="nodrag"
          rows={3}
          value={data.content || ''}
          placeholder="写点创作思路 / 待办"
          onChange={(e) => ctx.updateNode(id, { content: e.target.value })}
        />
      </div>
    </div>
  );
}
