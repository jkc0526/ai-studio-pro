import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { useCanvas } from '../context.js';
import MentionInput from '../components/MentionInput.jsx';
import MediaPreview from '../components/MediaPreview.jsx';

const STATUS_TEXT = { running: '生成中', done: '完成', error: '失败' };

/* 视频模式（对齐 OiiOii 的四个 tab） */
const MODES = [
  { v: 'text', label: '文生视频', needImage: false },
  { v: 'omni', label: '全能参考', needImage: true },
  { v: 'image', label: '图生视频', needImage: true },
  { v: 'frames', label: '首尾帧', needImage: true },
];

const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
const RESOLUTIONS = ['480p', '720p', '1080p'];
const DURATIONS = [3, 4, 5, 6, 8, 10];

const PLACEHOLDER = {
  text: '描述你想生成的视频内容.Ctrl+Enter 快速生成',
  omni: '上传参考图并描述运动方式，模型会保持主体一致',
  image: '上传或连接首帧图，描述画面如何运动',
  frames: '连接首帧与尾帧图，模型自动补全中间过渡',
};

/* 视频节点：浮动工具条 + tab 模式 + 下方大输入框
   上游素材（连线传进来的图片/视频）会显示成「参考」缩略图行，
   提示词里用 @图片1 引用，生成时传给模型（后端 engine.js 按同名解析）。 */
export default function VideoNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [preview, setPreview] = useState(null);   // 点击缩略图放大
  const miRef = useRef(null);                     // 富文本输入的命令式接口

  const mode = data.mode || 'text';
  const modeCfg = MODES.find((m) => m.v === mode) || MODES[0];
  const ratio = data.ratio || '16:9';
  const resolution = data.resolution || '1080p';
  const duration = Number(data.duration) || 5;
  const models = ctx.videoModels || [];

  /* 订阅 React Flow 的图结构：连线/上游节点产物变化时本节点会重渲染，
     从而让「参考」行立刻反映最新连线（只读 CanvasView 的 ref 会有一帧延迟且不触发重渲染） */
  const graphNodes = useStore((s) => s.nodes);
  const graphEdges = useStore((s) => s.edges);
  const refs = useMemo(() => ctx.refsOf?.(id, { nodes: graphNodes, edges: graphEdges }) || [],
    [ctx, id, graphNodes, graphEdges]);
  const prompt = data.prompt || '';
  const usedKeys = useMemo(() => (prompt.match(/@\s*(?:图片|视频)\s*\d+/g) || []).map((s) => s.replace(/@\s*/, '').replace(/\s+/g, '')), [prompt]);

  // 素材编号表同步给节点数据 → 后端按同样的 key 解析 @图片N
  useEffect(() => {
    if (JSON.stringify(refs) !== JSON.stringify(data.mediaRefs || [])) {
      ctx.updateNode(id, { mediaRefs: refs });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(refs)]);

  const gen = () => {
    if (modeCfg.needImage && !refs.some((r) => r.type === 'image')) {
      ctx.updateNode(id, { status: 'error', error: '该模式需要图片参考：请把图片节点连到本节点左侧' });
      return;
    }
    ctx.updateNode(id, { needsImage: modeCfg.needImage });
    ctx.runNode(id);
  };

  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

  return (
    <div className={`oii-node oii-node-video ${selected ? 'on' : ''}`}>
      {selected && (
        <div className="oii-toolbar nodrag">
          <button className="oii-tb" title="风格" onClick={() => ctx.openStyles?.(id)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" />
            </svg>
          </button>
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
          <path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" />
        </svg>
        {data.label || '视频'}
        {data.status && <span className={`oii-badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
      </div>

      <div className={`oii-card ${data.videoUrl ? 'has-media' : ''}`}>
        {data.videoUrl ? (
          <video src={data.videoUrl} controls muted loop playsInline className="nodrag" />
        ) : data.status === 'running' ? (
          <span className="oii-ph loading">
            <span className="oii-spinner" />
            <small>生成中…</small>
          </span>
        ) : (
          <span className="oii-ph">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" />
            </svg>
          </span>
        )}
        {/* 连接桩挂在卡片边缘的垂直中点 */}
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>

      {data.status === 'error' && data.error && <div className="oii-err">{data.error}</div>}

      <div className="oii-prompt">
        {/* 模式 tab */}
        <div className="oii-tabs nodrag">
          {MODES.map((m) => (
            <button key={m.v} className={`oii-tab ${mode === m.v ? 'on' : ''}`}
              onClick={() => ctx.updateNode(id, { mode: m.v })}>
              {m.label}
            </button>
          ))}
        </div>

        {/* 参考素材（连线传进来的图/视频）—— 点缩略图即插入 @ 引用 */}
        {refs.length > 0 && (
          <div className="oii-refs nodrag">
            <span className="oii-refs-tag">参考</span>
            {refs.map((r) => (
              <button key={r.key} className={`oii-ref ${usedKeys.includes(r.key) ? 'on' : ''}`}
                title={`@${r.key}${r.label ? ` · ${r.label}` : ''}（点击插入引用）`}
                onClick={() => miRef.current?.insert(r.key)}>
                {r.type === 'image'
                  ? <img src={r.url} alt="" />
                  : <video src={r.url} muted preload="metadata" />}
                <b>{r.key}</b>
              </button>
            ))}
            <span className="oii-refs-hint">输入 @ 可引用 · 点提示词里的缩略图放大</span>
          </div>
        )}

        {/* 富文本输入：@图片N 会内联成缩略图，点击可放大 */}
        <MentionInput
          ref={miRef}
          value={prompt}
          onChange={(text) => ctx.updateNode(id, { prompt: text })}
          refs={refs}
          rows={3}
          placeholder={PLACEHOLDER[mode]}
          onPreview={(ref) => setPreview(ref)}
          onSubmit={gen}
        />

        <div className="oii-params">
          <select className="nodrag" value={data.modelId || ''} title="视频模型"
            onChange={(e) => ctx.updateNode(id, { modelId: e.target.value })}>
            <option value="">默认模型</option>
            {models.map((m) => <option key={m.id || m} value={m.id || m}>{m.label || m.id || m}</option>)}
          </select>

          <button className="nodrag oii-mini" title="切换比例" onClick={() => ctx.updateNode(id, { ratio: cycle(RATIOS, ratio) })}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
            </svg>
            {ratio}
          </button>
          <button className="nodrag oii-mini" title="切换分辨率" onClick={() => ctx.updateNode(id, { resolution: cycle(RESOLUTIONS, resolution) })}>
            {resolution}
          </button>
          <button className="nodrag oii-mini" onClick={() => ctx.updateNode(id, { duration: cycle(DURATIONS, duration) })}>
            {duration}s
          </button>

          <span className="oii-spacer" />
          <button className="nodrag oii-mini" title="1x">1x</button>
          <button className="nodrag oii-send" disabled={data.status === 'running'} onClick={gen}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>

      <MediaPreview item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
