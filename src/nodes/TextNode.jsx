import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';
import ErrorSummary from '../components/ErrorSummary.jsx';

const STATUS_TEXT = { running: '处理中', done: '完成', error: '失败' };
const modelIdOf = (model) => typeof model === 'string' ? model : (model?.id || model?.name || '');
const modelLabelOf = (model) => typeof model === 'string' ? model : (model?.label || model?.name || model?.id || '');

export default function TextNode({ id, data, selected }) {
  const ctx = useCanvas();
  const models = ctx.textModels || [];
  const defaultModel = ctx.textDefaultModel || '';
  const processWithModel = data.processWithModel ?? Boolean(data.modelId);
  const modelValue = processWithModel ? (data.modelId || '__default__') : '';
  const content = data.content || '';
  const canRun = Boolean(content.trim()) && data.status !== 'running'
    && (!processWithModel || Boolean(data.modelId || defaultModel));

  return (
    <div className={`node text-node ${selected ? 'selected' : ''}`}>
      <div className="node-head">
        <span className="dot" style={{ background: '#378ADD' }} />
        <span>{data.label || '文本'}</span>
        {data.status && <span className={`badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
        <span className="spacer" />
        <button className="ghost" style={{ padding: '2px 6px' }} aria-label="删除文本节点" onClick={() => ctx.deleteNode(id)}>×</button>
      </div>
      <div className="node-body">
        <label className="field-label" htmlFor={`${id}-text-content`}>输入文本</label>
        <textarea
          id={`${id}-text-content`}
          className="nodrag"
          rows={6}
          value={content}
          placeholder="粘贴小说 / 剧本 / 素材文本"
          onChange={(e) => ctx.updateNode(id, { content: e.target.value, output: undefined, modelUsed: undefined, status: null, error: null })}
        />
        {data.status === 'error' && <ErrorSummary error={data.error} />}
        {(data.output || data.status === 'running') && (
          <div>
            <span className="field-label">处理输出</span>
            <div className={`out-box ${data.status === 'running' ? 'empty' : ''}`} aria-live="polite">
              {data.status === 'running' ? '正在处理文本…' : data.output}
            </div>
          </div>
        )}
      </div>
      <div className="node-foot text-node-foot">
        <select
          className="nodrag text-model-select"
          aria-label="文本大模型"
          title="选择文本大模型"
          value={modelValue}
          onChange={(e) => {
            const value = e.target.value;
            ctx.updateNode(id, {
              modelId: value && value !== '__default__' ? value : undefined,
              processWithModel: Boolean(value),
              output: undefined,
              modelUsed: undefined,
              status: null,
              error: null,
            });
          }}
        >
          <option value="">直接输出原文</option>
          <option value="__default__" disabled={!defaultModel}>
            {defaultModel ? `默认模型 · ${defaultModel}` : '默认模型未配置'}
          </option>
          {models.map((model) => {
            const modelId = modelIdOf(model);
            return modelId ? <option key={modelId} value={modelId}>{modelLabelOf(model)}</option> : null;
          })}
        </select>
        <button
          className="primary text-node-run"
          title={processWithModel ? '调用所选大模型处理文本' : '将原文输出给下游节点'}
          aria-label={processWithModel ? '处理文本' : '输出文本'}
          disabled={!canRun}
          onClick={() => ctx.runNode(id)}
        >
          {data.status === 'running' ? '处理中…' : processWithModel ? '处理' : '输出'}
        </button>
      </div>
      <div className="node-foot text-node-meta">
        <span className="hint">{content.length} 字 · {data.output ? '处理结果输出给下游' : '输入输出给下游节点'}</span>
        {data.modelUsed && <span className="pill">{data.modelUsed}</span>}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
