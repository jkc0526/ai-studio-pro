import { callLLM, callImage, callVideo } from './ai.js';
import { q, uid, now } from './db.js';

export function topoOrder(nodes, edges, targetIds) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map();
  const order = [];
  const visit = (id) => {
    if (!map.has(id) || state.get(id)) return;
    state.set(id, 1);
    for (const e of edges) if (e.target === id) visit(e.source);
    state.set(id, 2);
    order.push(id);
  };
  targetIds.forEach(visit);
  return order;
}

function incoming(nodes, edges, id) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.target === id && map.has(e.source))
    .map((e) => ({ edge: e, node: map.get(e.source) }));
}

function buildPrompt(node, upstream) {
  const joined = upstream.filter(Boolean).join('\n\n').trim();
  const tpl = (node.data?.prompt || '').trim();
  if (!tpl) return joined;
  if (tpl.includes('{{input}}')) return tpl.replaceAll('{{input}}', joined);
  return joined ? `${tpl}\n\n---\n${joined}` : tpl;
}

/* 找出最靠近当前节点的「图片类」上游输出：uploadNode / assetNode / imageNode / gridNode */
function findUpstreamImage(node, upstreamOutputs, upstreamNodes) {
  // 按上游顺序倒推，取第一个非空 URL
  for (let i = upstreamNodes.length - 1; i >= 0; i--) {
    const src = upstreamNodes[i];
    const out = upstreamOutputs.get(src.id);
    if (!out) continue;
    if (src.type === 'uploadNode' || src.type === 'assetNode') {
      const url = out.url || src.data?.url;
      if (url) return url;
    }
    if (src.type === 'imageNode' && out.url) return out.url;
    if (src.type === 'gridNode' && out.images?.length) return out.images[out.pickedIndex ?? out.images.length - 1];
  }
  return null;
}

const MAX_UPSTREAM_CHARS = 12000;
const clip = (s) => (s.length > MAX_UPSTREAM_CHARS ? s.slice(0, MAX_UPSTREAM_CHARS) + '\n…(已截断)' : s);

/**
 * 执行画布工作流：从 targetIds 出发，连同其全部上游节点按拓扑序执行。
 * @returns {{ patches: object[], steps: object[], outputs: object }}
 */
export async function runWorkflow({ nodes = [], edges = [], targetIds = [], configs = {} }) {
  const targets = targetIds.length ? targetIds : nodes.map((n) => n.id);
  const order = topoOrder(nodes, edges, targets);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outputs = new Map();
  const patches = [];
  const steps = [];

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const isTarget = targets.includes(id);
    const upstream = incoming(nodes, edges, id);
    const upstreamTexts = upstream.map(({ node: src }) => outputs.get(src.id) || '');
    const started = Date.now();
    try {
      /* ---- 文本类（直接透传，无副作用） ---- */
      if (node.type === 'textNode') {
        outputs.set(id, clip(node.data?.content || ''));
        steps.push({ nodeId: id, kind: node.type, status: 'skipped', ms: 0 });
        continue;
      }
      if (node.type === 'noteNode') {
        outputs.set(id, clip(node.data?.content || ''));
        steps.push({ nodeId: id, kind: node.type, status: 'skipped', ms: 0 });
        continue;
      }
      if (node.type === 'audioNode') {
        outputs.set(id, clip(node.data?.text || ''));
        steps.push({ nodeId: id, kind: node.type, status: 'skipped', ms: 0 });
        continue;
      }

      /* ---- 资源类：直接透传 URL ---- */
      if (node.type === 'uploadNode' || node.type === 'assetNode') {
        const url = node.data?.url || '';
        outputs.set(id, { url, kind: node.data?.kind || 'image', text: url });
        patches.push({ nodeId: id, data: { url, status: 'done', error: null, ranAt: new Date().toISOString() } });
        steps.push({ nodeId: id, kind: node.type, status: 'skipped', ms: 0 });
        continue;
      }

      /* ---- 脚本节点：拼接剧本正文 + 梗概 ---- */
      if (node.type === 'scriptNode') {
        const sid = node.data?.scriptId;
        if (!sid) throw new Error('请先选择一个剧本');
        const s = q.one('SELECT * FROM script WHERE id = ?', sid);
        if (!s) throw new Error('剧本不存在');
        const includeOutline = node.data?.includeOutline !== false;
        const text = [s.title && `【剧本标题】${s.title}`, includeOutline && s.outline && `【梗概】${s.outline}`, s.content].filter(Boolean).join('\n\n');
        outputs.set(id, clip(text));
        patches.push({ nodeId: id, data: { scriptTitle: s.title, status: 'done', error: null, ranAt: new Date().toISOString() } });
        steps.push({ nodeId: id, kind: node.type, status: 'ok', ms: Date.now() - started });
        continue;
      }

      /* ---- 大模型 ---- */
      if (node.type === 'llmNode') {
        const prompt = buildPrompt(node, upstreamTexts);
        if (!prompt) throw new Error('提示词为空：请填写提示词或连接上游节点');
        const r = await callLLM(configs.thinking, {
          model: node.data?.modelId, system: node.data?.systemPrompt, user: prompt,
        });
        outputs.set(id, clip(r.text));
        patches.push({ nodeId: id, data: { output: r.text, status: 'done', error: null, modelUsed: r.model, tokens: r.usage?.total_tokens ?? null, ranAt: new Date().toISOString() } });
        steps.push({ nodeId: id, kind: 'llm', status: 'ok', ms: Date.now() - started, model: r.model });
        continue;
      }

      /* ---- 单张图 ---- */
      if (node.type === 'imageNode') {
        const prompt = buildPrompt(node, upstreamTexts);
        if (!prompt) throw new Error('提示词为空：请填写画面描述或连接上游节点');
        const r = await callImage(configs.image_gen, {
          model: node.data?.modelId, prompt, size: node.data?.size || '1024x1024',
        });
        outputs.set(id, { url: r.url, text: prompt });
        patches.push({ nodeId: id, data: { imageUrl: r.url, promptUsed: prompt, status: 'done', error: null, modelUsed: r.model, ranAt: new Date().toISOString() } });
        steps.push({ nodeId: id, kind: 'image', status: 'ok', ms: Date.now() - started, model: r.model, url: r.url });
        continue;
      }

      /* ---- 九宫格：依次生成 count 张 ---- */
      if (node.type === 'gridNode') {
        const prompt = buildPrompt(node, upstreamTexts);
        if (!prompt) throw new Error('提示词为空：请填写画面描述或连接上游节点');
        const count = Math.min(25, Math.max(2, Number(node.data?.count) || 9));
        const size = node.data?.size || '1024x1024';
        const images = [];
        for (let i = 0; i < count; i++) {
          const r = await callImage(configs.image_gen, { model: node.data?.modelId, prompt, size });
          images.push(r.url);
        }
        const pickedIndex = images.length - 1;
        outputs.set(id, { images, pickedIndex, url: images[pickedIndex], text: prompt });
        patches.push({
          nodeId: id,
          data: { images, pickedIndex, imageUrl: images[pickedIndex], promptUsed: prompt, status: 'done', error: null,
            modelUsed: node.data?.modelId || configs.image_gen?.model_id || null, ranAt: new Date().toISOString() },
        });
        steps.push({ nodeId: id, kind: 'grid', status: 'ok', ms: Date.now() - started, count: images.length });
        continue;
      }

      /* ---- 视频（图生视频） ---- */
      if (node.type === 'videoNode') {
        const prompt = buildPrompt(node, upstreamTexts) || (node.data?.prompt || '');
        const imageUrl = findUpstreamImage(node, outputs, upstream.map(({ node: n }) => n));
        if (!imageUrl) throw new Error('视频节点需要上游图片（上传/素材库/生图/九宫格），但没有找到');
        const r = await callVideo(configs.video, {
          model: node.data?.modelId,
          prompt,
          image: imageUrl.startsWith('http') || imageUrl.startsWith('data:') || imageUrl.startsWith('/outputs/') ? imageUrl : null,
          duration: Number(node.data?.duration) || 5,
          ratio: node.data?.ratio || '16:9',
        });
        outputs.set(id, { url: r.url, text: r.url });
        patches.push({
          nodeId: id,
          data: { videoUrl: r.url, imageUrl, promptUsed: prompt, status: 'done', error: null, modelUsed: r.model, ranAt: new Date().toISOString() },
        });
        steps.push({ nodeId: id, kind: 'video', status: 'ok', ms: Date.now() - started, model: r.model, url: r.url });
        continue;
      }

      steps.push({ nodeId: id, kind: node.type || 'unknown', status: 'skipped' });
    } catch (err) {
      const msg = err?.name === 'AbortError' ? '请求超时' : (err?.message || String(err));
      patches.push({ nodeId: id, data: { status: 'error', error: msg } });
      steps.push({ nodeId: id, kind: node.type, status: 'error', ms: Date.now() - started, error: msg });
      break;
    }
  }

  const failed = steps.find((s) => s.status === 'error');
  return {
    status: failed ? 'failed' : 'success',
    error: failed?.error || null,
    patches,
    steps: steps.filter((s) => !['textNode', 'noteNode', 'audioNode', 'uploadNode', 'assetNode'].includes(s.kind)),
  };
}