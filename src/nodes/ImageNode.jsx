import { useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { useCanvas } from '../context.js';
import { api } from '../api.js';
import MentionInput from '../components/MentionInput.jsx';
import MediaPreview from '../components/MediaPreview.jsx';
import GenerationLoading from '../components/GenerationLoading.jsx';
import ErrorSummary from '../components/ErrorSummary.jsx';
import { providerSupportsMedia } from '../../shared/providerCapabilities.js';

const STATUS_TEXT = { running: '生成中', done: '完成', error: '失败' };

const RATIOS = [
  { v: '16:9', label: '16:9' },
  { v: '9:16', label: '9:16' },
  { v: '1:1', label: '1:1' },
  { v: '4:3', label: '4:3' },
  { v: '3:4', label: '3:4' },
];
const QUALITIES = ['1K', '2K', '4K'];

/* 比例 + 画质 → 具体像素尺寸 */
const SIZE_MAP = {
  '16:9': { '1K': '1536x864', '2K': '2048x1152', '4K': '3840x2160' },
  '9:16': { '1K': '864x1536', '2K': '1152x2048', '4K': '2160x3840' },
  '1:1': { '1K': '1024x1024', '2K': '1536x1536', '4K': '2048x2048' },
  '4:3': { '1K': '1152x864', '2K': '1600x1200', '4K': '3024x2268' },
  '3:4': { '1K': '864x1152', '2K': '1200x1600', '4K': '2268x3024' },
};
const sizeOf = (ratio, quality) => SIZE_MAP[ratio]?.[quality] || '1024x1024';

const UPGRADES = [
  { key: '', label: '裁剪', icon: 'M7 3v14h14M3 7h14v14' },
  { key: 'panorama', label: '720°全景', icon: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12h16M12 4c2 2.5 2 13.5 0 16' },
];

const PLACEHOLDER = '描述任何你想要生成或编辑的内容（输入 @ 可引用上游素材）';

/* 图片节点：浮动工具条 + 节点卡片 + 下方大输入框（与视频节点对齐的 @ 引用功能） */
export default function ImageNode({ id, data, selected }) {
  const ctx = useCanvas();
  const [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);   // 点击缩略图放大
  const [providerModels, setProviderModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const miRef = useRef(null);                     // 富文本输入的命令式接口

  const ratio = data.ratio || '16:9';
  const quality = data.quality || '1K';
  const defaultProvider = ctx.imageDefaultProvider || null;
  const providerId = data.providerId && data.providerId !== defaultProvider?.id ? data.providerId : '';
  const imageProtocols = ['openai', 'agnes-video'];
  const availableProviders = (ctx.imageProviders || []).filter((p) => p.enabled && p.has_key && p.base_url
    && imageProtocols.includes(p.protocol) && providerSupportsMedia(p, 'image') && p.id !== defaultProvider?.id);
  const selectedProvider = availableProviders.find((p) => p.id === providerId);
  const models = providerId ? providerModels : (ctx.imageModels || []);
  const modelIdOf = (model) => typeof model === 'string' ? model : (model?.id || model?.name || '');

  useEffect(() => {
    if (!providerId) {
      setProviderModels([]);
      setModelsLoading(false);
      setModelsError('');
      return undefined;
    }
    let active = true;
    setProviderModels([]);
    setModelsLoading(true);
    setModelsError('');
    api.listModels(`purpose=image_gen&providerId=${encodeURIComponent(providerId)}`)
      .then((result) => {
        if (!active) return;
        setProviderModels((result.groups?.image || []).filter(Boolean));
        setModelsError(result.error || '');
      })
      .catch((error) => { if (active) setModelsError(error.message || '模型列表获取失败'); })
      .finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [providerId, selectedProvider?.base_url, selectedProvider?.update_time]);

  /* 订阅 React Flow 的图结构：连线/上游节点产物变化时本节点会重渲染 */
  const graphNodes = useStore((s) => s.nodes);
  const graphEdges = useStore((s) => s.edges);
  const refs = useMemo(() => ctx.refsOf?.(id, { nodes: graphNodes, edges: graphEdges }) || [],
    [ctx, id, graphNodes, graphEdges]);
  const prompt = data.prompt || '';
  const usedKeys = useMemo(() => (prompt.match(/@\s*(?:图片|视频)\s*\d+/g) || []).map((s) => s.replace(/@\s*/, '').replace(/\s+/g, '')), [prompt]);

  // 素材编号表同步给节点数据 → 后端按同样的 key 解析 @图片N（与视频节点一致）
  useEffect(() => {
    if (JSON.stringify(refs) !== JSON.stringify(data.mediaRefs || [])) {
      ctx.updateNode(id, { mediaRefs: refs });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(refs)]);

  const pickFile = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result); r.onerror = rej;
        r.readAsDataURL(file);
      });
      const { url } = await api.upload({ name: file.name, dataUrl });
      ctx.updateNode(id, { imageUrl: url, sourceUrl: url, status: 'done', sourceName: file.name });
    } catch (e) { ctx.updateNode(id, { status: 'error', error: e.message }); }
    finally { setBusy(false); }
  };

  const gen = () => {
    if (providerId && !models.some((model) => modelIdOf(model) === data.modelId)) {
      ctx.updateNode(id, { status: 'error', error: '请先从所选供应商的模型列表中选择一个图像模型' });
      return;
    }
    // 把比例/画质合成为后端认识的 size
    ctx.updateNode(id, { size: sizeOf(ratio, quality) });
    ctx.runNode(id);
  };

  return (
    <div className={`oii-node oii-node-image ${selected ? 'on' : ''}`}>
      {/* 浮动工具条（选中时出现在节点上方） */}
      {selected && (
        <div className="oii-toolbar nodrag">
          <button className="oii-tb" title="风格" onClick={() => ctx.openStyles?.(id)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" />
            </svg>
          </button>
          {UPGRADES.map((u) => (
            <button key={u.key} className="oii-tb oii-tb-text" disabled={!data.imageUrl}
              title={data.imageUrl ? u.label : '先生成图片'} onClick={() => setMenu(u.key)}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d={u.icon} />
              </svg>
              {u.label}
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          ))}
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
          <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" />
        </svg>
        {data.label || '图片'}
        {data.status && <span className={`oii-badge ${data.status}`}>{STATUS_TEXT[data.status] || data.status}</span>}
      </div>

      <div className={`oii-card ${data.imageUrl ? 'has-media' : ''}`} aria-busy={data.status === 'running'}>
        {data.imageUrl
          ? <img
              src={data.imageUrl}
              alt="生成结果"
              className="oii-result-image"
              draggable={false}
              title="双击放大预览"
              onDoubleClick={(event) => {
                event.stopPropagation();
                setPreview({ type: 'image', url: data.imageUrl, key: data.label || '图片预览' });
              }}
            />
          : data.status !== 'running' ? <span className="oii-ph">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5" />
              </svg>
            </span> : null}
        <label className="oii-upload nodrag" title={data.imageUrl ? '替换图片' : '上传图片'}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          </svg>
          <input type="file" accept="image/*" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>
        {data.status === 'running' && <GenerationLoading media="图片" />}
        {/* 连接桩挂在卡片边缘的垂直中点（放在 .oii-card 内定位，否则会悬在节点外框上） */}
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
      </div>

      {data.status === 'error' && <ErrorSummary error={data.error} className="oii-err" />}

      {/* 下方大输入框 */}
      {!data.sourceUrl && <div className="oii-prompt">
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
          placeholder={PLACEHOLDER}
          onPreview={(ref) => setPreview(ref)}
          onSubmit={gen}
        />

        <div className="oii-params">
          <select className="nodrag oii-image-provider-select" value={providerId} title="图像供应商" aria-label="图像供应商"
            onChange={(e) => ctx.updateNode(id, { providerId: e.target.value || undefined, modelId: undefined, status: 'draft', error: undefined })}>
            <option value="">{defaultProvider?.name ? `默认 · ${defaultProvider.name}` : '默认供应商'}</option>
            {providerId && !selectedProvider && <option value={providerId} disabled>所选供应商不可用</option>}
            {availableProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <select className="nodrag oii-image-model-select" value={data.modelId || ''} title={modelsError || '图像模型'} aria-label="图像模型"
            disabled={!!providerId && (modelsLoading || !models.length)}
            onChange={(e) => ctx.updateNode(id, { modelId: e.target.value || undefined })}>
            <option value="">{modelsLoading ? '加载模型中…' : models.length ? '默认模型' : providerId ? '未获取到模型' : '默认模型'}</option>
            {models.map((model) => {
              const modelId = modelIdOf(model);
              return modelId ? <option key={modelId} value={modelId}>{model.label || modelId}</option> : null;
            })}
          </select>

          <div className="oii-ratio">
            <button className="nodrag" onClick={() => ctx.updateNode(id, { ratio: nextOf(RATIOS, ratio) })} title="切换比例">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
              </svg>
              {ratio}
            </button>
            <button className="nodrag oii-mini" onClick={() => ctx.updateNode(id, { quality: QUALITIES[(QUALITIES.indexOf(quality) + 1) % QUALITIES.length] })} title="切换画质">
              {quality}
            </button>
          </div>

          <span className="oii-spacer" />

          <button className="nodrag oii-mini" title="片段库" onClick={() => ctx.openSnippets?.(id)}>片段</button>
          <button className="nodrag oii-mini" title="1x">1x</button>
          <button className="nodrag oii-send" disabled={busy || data.status === 'running' || modelsLoading || (!!providerId && !data.modelId)} onClick={gen}
            title={modelsError || (providerId && !models.length && !modelsLoading ? '供应商没有返回可识别的图像模型' : '生成图片')}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
        </div>
      </div>}

      <MediaPreview item={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function nextOf(list, cur) {
  const i = list.findIndex((x) => x.v === cur);
  return list[(i + 1) % list.length].v;
}
