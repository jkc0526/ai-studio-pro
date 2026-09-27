import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { useCanvas } from '../context.js';
import { api } from '../api.js';
import MentionInput from '../components/MentionInput.jsx';
import MediaPreview from '../components/MediaPreview.jsx';
import GenerationLoading from '../components/GenerationLoading.jsx';
import ErrorSummary from '../components/ErrorSummary.jsx';
import { clampVideoDuration, getVideoDurationRange } from '../../shared/videoCapabilities.js';
import { providerSupportsMedia } from '../../shared/providerCapabilities.js';

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
/* 各模式在请求体里会用到的媒体字段（与后端 engine.js 的映射保持一致）。
   切换模式时清掉不适用的字段，避免把上一次模式的参考图 / 首尾帧带进新模式的请求。 */
const VIDEO_MEDIA_FIELDS = ['images', 'firstFrame', 'lastFrame', 'imageUrl'];
const MODE_MEDIA_FIELDS = {
  text: [],
  omni: ['images', 'imageUrl'],
  image: ['firstFrame', 'imageUrl'],
  frames: ['firstFrame', 'lastFrame'],
};

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
  const [providerModels, setProviderModels] = useState([]);
  const [providerModelCapabilities, setProviderModelCapabilities] = useState({});
  const [providerModelPrices, setProviderModelPrices] = useState({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [durationOpen, setDurationOpen] = useState(false);
  const [durationDraft, setDurationDraft] = useState(Number(data.duration) || 5);
  const miRef = useRef(null);                     // 富文本输入的命令式接口
  const durationSettingsRef = useRef(null);
  const durationTriggerRef = useRef(null);

  const mode = data.mode || 'text';
  const modeCfg = MODES.find((m) => m.v === mode) || MODES[0];
  const ratio = data.ratio || '16:9';
  // 默认 720p：当前网关（Agnes Video 2.5-flash）仅支持 720P
  const resolution = data.resolution || '720p';
  const defaultProvider = ctx.videoDefaultProvider || null;
  const providerId = data.providerId && data.providerId !== defaultProvider?.id ? data.providerId : '';
  const supportedProtocols = ['openai', 'openai-video', 'agnes-video'];
  const availableProviders = (ctx.videoProviders || []).filter((p) => p.enabled && p.has_key && p.base_url
    && supportedProtocols.includes(p.protocol) && providerSupportsMedia(p, 'video') && p.id !== defaultProvider?.id);
  const selectedProvider = availableProviders.find((p) => p.id === providerId);
  const models = providerId ? providerModels : (ctx.videoModels || []);
  const modelIdOf = (model) => typeof model === 'string' ? model : (model?.id || model?.name || '');
  const modelCapabilities = providerId ? providerModelCapabilities : (ctx.videoModelCapabilities || {});
  const modelPrices = providerId ? providerModelPrices : (ctx.videoModelPrices || {});
  const durationModel = data.modelId || (!providerId ? ctx.videoDefaultModel : '');
  const videoPrice = modelPrices[durationModel] || '';
  const durationRange = getVideoDurationRange(durationModel, modelCapabilities[durationModel]);
  const rawDuration = Number(data.duration) || 5;
  const duration = clampVideoDuration(rawDuration, durationRange);

  useEffect(() => {
    setDurationDraft(duration);
  }, [duration]);

  useEffect(() => {
    if (!durationOpen) return undefined;
    const onPointerDown = (event) => {
      if (!durationSettingsRef.current?.contains(event.target)) setDurationOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setDurationOpen(false);
      durationTriggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [durationOpen]);

  const commitDuration = () => {
    const nextDuration = clampVideoDuration(durationDraft, durationRange);
    setDurationDraft(nextDuration);
    ctx.updateNode(id, {
      duration: nextDuration,
      durationRange: { min: durationRange.min, max: durationRange.max },
    });
  };

  useEffect(() => {
    if (!providerId) {
      setProviderModels([]);
      setProviderModelCapabilities({});
      setProviderModelPrices({});
      setModelsLoading(false);
      setModelsError('');
      return undefined;
    }
    let active = true;
    setProviderModels([]);
    setProviderModelPrices({});
    setModelsLoading(true);
    setModelsError('');
    api.listModels(`purpose=video&providerId=${encodeURIComponent(providerId)}`)
      .then((result) => {
        if (!active) return;
        setProviderModels((result.groups?.video || []).filter(Boolean));
        setProviderModelCapabilities(result.modelCapabilities || {});
        setProviderModelPrices(result.modelPrices || {});
        setModelsError(result.error || '');
      })
      .catch((error) => { if (active) setModelsError(error.message || '模型列表获取失败'); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [providerId, selectedProvider?.base_url, selectedProvider?.update_time]);

  useEffect(() => {
    const capability = modelCapabilities[durationModel];
    if (!durationModel || !capability) return;
    const nextRange = getVideoDurationRange(durationModel, capability);
    const currentRange = data.durationRange;
    const nextDuration = clampVideoDuration(rawDuration, nextRange);
    if (currentRange?.min !== nextRange.min || currentRange?.max !== nextRange.max || nextDuration !== rawDuration) {
      ctx.updateNode(id, { durationRange: { min: nextRange.min, max: nextRange.max }, duration: nextDuration });
    }
  }, [ctx, id, modelCapabilities, durationModel, data.durationRange, rawDuration]);

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
    if (providerId && !models.some((model) => modelIdOf(model) === data.modelId)) {
      ctx.updateNode(id, { status: 'error', error: '请先从所选供应商的模型列表中选择一个视频模型' });
      return;
    }
    if (modeCfg.needImage && !refs.some((r) => r.type === 'image')) {
      ctx.updateNode(id, { status: 'error', error: '该模式需要图片参考：请把图片节点连到本节点左侧' });
      return;
    }
    ctx.updateNode(id, { needsImage: modeCfg.needImage });
    ctx.runNode(id);
  };

  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];

  /* 切换视频模式：写入新模式，并清掉新模式不适用的媒体字段（如从「全能参考」切到「文生视频」
     时残留的参考图），保证请求体只带当前模式允许的字段。 */
  const setMode = (next) => {
    const applicable = MODE_MEDIA_FIELDS[next] || [];
    const patch = { mode: next };
    for (const field of VIDEO_MEDIA_FIELDS) {
      if (!applicable.includes(field)) patch[field] = undefined;
    }
    ctx.updateNode(id, patch);
  };

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

      <div className={`oii-card ${data.videoUrl ? 'has-media' : ''}`} aria-busy={data.status === 'running'}>
        {data.videoUrl ? (
          <video src={data.videoUrl} controls muted loop playsInline className="nodrag" />
        ) : data.status !== 'running' ? (
          <span className="oii-ph">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" />
            </svg>
          </span>
        ) : null}
        {data.status === 'running' && <GenerationLoading media="视频" />}
        {/* 连接桩挂在卡片边缘的垂直中点 */}
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>

      {data.status === 'error' && <ErrorSummary error={data.error} className="oii-err" />}

      <div className="oii-prompt">
        {/* 模式 tab */}
        <div className="oii-tabs nodrag">
          {MODES.map((m) => (
            <button key={m.v} className={`oii-tab ${mode === m.v ? 'on' : ''}`}
              onClick={() => setMode(m.v)}>
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
          <select className="nodrag oii-video-provider-select" value={providerId} title="视频供应商" aria-label="视频供应商"
            onChange={(e) => ctx.updateNode(id, { providerId: e.target.value || undefined, modelId: undefined, status: 'draft', error: undefined })}>
            <option value="">{defaultProvider?.name ? `默认 · ${defaultProvider.name}` : '默认供应商'}</option>
            {providerId && !selectedProvider && <option value={providerId} disabled>所选供应商不可用</option>}
            {availableProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select className="nodrag oii-video-model-select" value={data.modelId || ''} title="视频模型" aria-label="视频模型"
            disabled={!!providerId && (modelsLoading || !models.length)}
            onChange={(e) => {
              const modelId = e.target.value || undefined;
              const rangeModelId = modelId || (!providerId ? ctx.videoDefaultModel : '');
              const nextRange = getVideoDurationRange(rangeModelId, modelCapabilities[rangeModelId]);
              const nextDuration = clampVideoDuration(data.duration, nextRange);
              ctx.updateNode(id, { modelId, duration: nextDuration, durationRange: { min: nextRange.min, max: nextRange.max }, status: 'draft', error: undefined });
            }}>
            <option value="">{modelsLoading ? '加载模型中…' : models.length ? '默认模型' : providerId ? '未获取到模型' : '默认模型'}</option>
            {models.map((m) => {
              const modelId = modelIdOf(m);
              return modelId ? <option key={modelId} value={modelId}>{m.label || modelId}</option> : null;
            })}
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
          <div className="oii-duration-control nodrag" ref={durationSettingsRef}>
            <button ref={durationTriggerRef} type="button" className="nodrag oii-mini oii-duration-trigger"
              title={`视频时长 ${durationRange.min}–${durationRange.max} 秒${durationRange.source === 'provider' ? '（供应商能力）' : ''}`}
              aria-label={`视频时长，当前 ${duration} 秒`} aria-expanded={durationOpen}
              aria-controls={`video-duration-settings-${id}`}
              onClick={(event) => {
                event.stopPropagation();
                setDurationDraft(duration);
                setDurationOpen((open) => !open);
              }}>
              {duration}s
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <path d="m7 10 5 5 5-5" />
              </svg>
            </button>
            {durationOpen && (
              <div id={`video-duration-settings-${id}`} className="oii-duration-popover nodrag"
                role="group" aria-label="视频生成时长">
                <div className="oii-duration-heading">
                  <strong>视频时长</strong>
                  <span>{durationRange.min}–{durationRange.max} 秒</span>
                </div>
                <div className="oii-duration-row">
                  <input type="range" min={durationRange.min} max={durationRange.max} step="1" value={durationDraft}
                    aria-label="视频时长滑杆" aria-valuetext={`${durationDraft} 秒`}
                    onChange={(event) => setDurationDraft(Number(event.target.value))}
                    onPointerUp={commitDuration} onKeyUp={commitDuration} />
                  <label className="oii-duration-number">
                    <input type="number" min={durationRange.min} max={durationRange.max} step="1" value={durationDraft}
                      aria-label="视频时长（秒）"
                      onChange={(event) => setDurationDraft(event.target.value)}
                      onBlur={commitDuration}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitDuration();
                          event.currentTarget.blur();
                        }
                      }} />
                    <span aria-hidden="true">s</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          <span className="oii-spacer" />
          {videoPrice && <span className="oii-video-price" aria-live="polite" aria-label={`模型价格 ${videoPrice}`} title={`模型价格：${videoPrice}`}>{videoPrice}</span>}
          <button className="nodrag oii-mini" title="1x">1x</button>
          <button className="nodrag oii-send" disabled={data.status === 'running' || modelsLoading || (!!providerId && !data.modelId)} onClick={gen}
            title={modelsError || (providerId && !models.length && !modelsLoading ? '供应商没有返回可识别的视频模型' : '生成视频')}>
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
