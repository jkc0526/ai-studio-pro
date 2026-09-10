import { useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

const STATUS_TEXT = { running: '运行中', done: '完成', error: '失败' };

export default function LlmNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [showSystem, setShowSystem] = useState(false);

  return (
    <div className={`node ${selected ? 'selected' : ''}`}>
      <div className="node-head">
        <span className="dot" style={{ background: '#1D9E75' }} />
        <span>{data.label || '大模型'}</span>
        {data.status && <span className={`badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} onClick={() => ctx.deleteNode(id)}>×</button>
      </div>

      <div className="node-body">
        <div>
          <span className="field-label">
            提示词（用 {'{{input}}'} 引用上游输出）
            <button className="ghost" style={{ padding: '0 4px', marginLeft: 6 }} onClick={() => setShowSystem((v) => !v)}>
              {showSystem ? '收起系统提示' : '系统提示'}
            </button>
          </span>
          <textarea
            className="nodrag"
            rows={4}
            value={data.prompt || ''}
            placeholder="例如：把下面这段小说改写成 AI 漫剧剧本…&#10;{{input}}"
            onChange={(e) => ctx.updateNode(id, { prompt: e.target.value })}
          />
        </div>

        {showSystem && (
          <textarea
            className="nodrag"
            rows={2}
            value={data.systemPrompt || ''}
            placeholder="系统提示词（可选）"
            onChange={(e) => ctx.updateNode(id, { systemPrompt: e.target.value })}
          />
        )}

        <input
          className="nodrag"
          value={data.modelId || ''}
          placeholder="模型名（留空用全局设置）"
          onChange={(e) => ctx.updateNode(id, { modelId: e.target.value })}
        />

        {data.status === 'error' && data.error && <div className="err-box">{data.error}</div>}

        <div>
          <span className="field-label">模型输出</span>
          <div className={`out-box ${data.output ? '' : 'empty'}`}>{data.output || '尚未运行'}</div>
        </div>
      </div>

      <div className="node-foot">
        <button className="primary" style={{ padding: '4px 9px' }} onClick={() => ctx.runNode(id)} disabled={data.status === 'running'}>
          ▶ 运行
        </button>
        <button style={{ padding: '4px 9px' }} onClick={() => ctx.openSnippets(id)}>片段库</button>
        {data.output && (
          <button style={{ padding: '4px 9px' }} onClick={() => ctx.copy(data.output)}>复制</button>
        )}
        {data.modelUsed && <span className="pill">{data.modelUsed}</span>}
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
