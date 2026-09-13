/**
 * 工作流调度器（替代 graph.js 的调度部分）。
 *
 * 设计目标（按"全是 API 调用"场景）：
 *  1. DAG 环检测 — 任何环直接报错，不进入执行
 *  2. stage-based 并发 — 同 stage 节点 Promise.all，跨 stage 串行
 *  3. 错误隔离 — 一节点挂掉，独立的分支继续；记录错误到 ctx.errors
 *  4. 指数退避重试 — 429 / 网络抖动自动重试 3 次
 *  5. 进度回调 — ProgressEmitter.emit('node', {id, status}) 给前端 SSE
 *  6. 超时控制 — 每个 API 调用 90s 超时
 *  7. 不做内容缓存（用户确认不需要，每次跑拿新结果）
 */
import { EventEmitter } from 'node:events';
import { callLLM, callImage, callVideo } from './ai.js';
import { q } from './db.js';
import { concatClips } from './export.js';

const MAX_UPSTREAM_CHARS = 12000;
const clip = (s) => (s.length > MAX_UPSTREAM_CHARS ? s.slice(0, MAX_UPSTREAM_CHARS) + '\n…(已截断)' : s);
const PER_NODE_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 800;

/* ---------- 进度事件 ---------- */
export class ProgressEmitter extends EventEmitter {
  constructor() { super(); this.setMaxListeners(100); }
  emitNode(patch) { this.emit('node', patch); }
  emitProgress(done, total) { this.emit('progress', { done, total }); }
  emitError(msg) { this.emit('error', { message: msg }); }
}

/* ---------- 1. 环检测（DFS 染色） ---------- */
export function validateGraph(nodes, edges) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const color = new Map(); // 0=白 1=灰 2=黑
  const out = new Map();   // id → outgoing edge source
  for (const n of nodes) out.set(n.id, []);
  for (const e of edges) {
    if (map.has(e.source) && map.has(e.target)) out.get(e.source).push(e.target);
  }
  const cycle = [];
  const dfs = (id, path) => {
    const c = color.get(id) ?? 0;
    if (c === 1) { // back edge — 找到环
      const i = path.indexOf(id);
      cycle.push(...path.slice(i), id);
      return true;
    }
    if (c === 2) return false;
    color.set(id, 1);
    for (const t of out.get(id)) if (dfs(t, [...path, id])) return true;
    color.set(id, 2);
    return false;
  };
  for (const n of nodes) {
    if ((color.get(n.id) ?? 0) === 0 && dfs(n.id, [])) {
      throw new Error(`画布存在环：${cycle.join(' → ')}。请断开这条连线。`);
    }
  }
  // 校验连线类型（TODO：未来按 INPUT_TYPES 做严格校验）
  return { nodeCount: nodes.length, edgeCount: edges.length };
}

/* ---------- 2. 拓扑分层（Kahn 算法，按 stage 切分） ----------
 * 先收集所有 target 的上游闭包（避免执行无关节点），
 * 再对闭包内节点做 Kahn，按入度归零顺序切 stage。*/
export function topoStages(nodes, edges, targetIds) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  const validTargets = targetIds.length ? targetIds : nodes.map((n) => n.id);

  // 收集上游闭包（visited 与 inClosure 分离：target 本身已在闭包里，但仍需向上遍历其上游边）
  const inClosure = new Set(validTargets);
  const visited = new Set();
  const visit = (id) => {
    if (visited.has(id)) return;
    visited.add(id);
    inClosure.add(id);
    for (const e of edges) if (e.target === id && map.has(e.source)) visit(e.source);
  };
  validTargets.forEach(visit);

  // 建图（仅闭包内）
  const inDeg = new Map();
  const outEdges = new Map();
  for (const id of inClosure) { inDeg.set(id, 0); outEdges.set(id, []); }
  for (const e of edges) {
    if (!inClosure.has(e.source) || !inClosure.has(e.target)) continue;
    inDeg.set(e.target, (inDeg.get(e.target) || 0) + 1);
    outEdges.get(e.source).push(e.target);
  }

  // 按层切 stage
  const stages = [];
  let current = [...inClosure].filter((id) => inDeg.get(id) === 0);
  while (current.length) {
    stages.push(current);
    const next = [];
    for (const id of current) {
      for (const t of outEdges.get(id)) {
        const d = inDeg.get(t) - 1;
        inDeg.set(t, d);
        if (d === 0) next.push(t);
      }
    }
    current = next;
  }
  if (stages.flat().length !== inClosure.size) {
    // 理论上 validateGraph 已经挡住，但兜底
    throw new Error('拓扑排序失败：可能存在环');
  }
  return stages;
}

/* ---------- 3. 工具：构建上游输出 / 拼接 prompt / 找上游图片 ---------- */
function incoming(nodes, edges, id) {
  const map = new Map(nodes.map((n) => [n.id, n]));
  return edges
    .filter((e) => e.target === id && map.has(e.source))
    .map((e) => ({ node: map.get(e.source), output: null /* 调用方填 */ }));
}

function buildPrompt(node, upstreamTexts) {
  const joined = upstreamTexts.filter(Boolean).join('\n\n').trim();
  const tpl = (node.data?.prompt || '').trim();
  if (!tpl) return joined;
  if (tpl.includes('{{input}}')) return tpl.replaceAll('{{input}}', joined);
  return joined ? `${tpl}\n\n---\n${joined}` : tpl;
}

function findUpstreamImage(upstreamNodes) {
  for (let i = upstreamNodes.length - 1; i >= 0; i--) {
    const src = upstreamNodes[i];
    const out = src._output;
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

/* ---------- 上游素材引用（@图片N / @视频N） ----------
   前端 CanvasView.refsOf 把连线素材按顺序编号写进 node.data.mediaRefs：
   [{ key: '图片1', type: 'image', url }]，编号规则两端一致。
   提示词里写 @图片2 就取第二张；没写 mention 时回落「取上游最后一张图」，行为向后兼容。 */
function mentionKeys(prompt) {
  const out = [];
  // 容忍 @ 与名字之间有空格（手打常见）
  const re = /@\s*(图片|视频)\s*(\d+)/g;
  let m;
  while ((m = re.exec(prompt || ''))) out.push(`${m[1]}${m[2]}`);
  return out;
}

function pickRefUrl(node, prompt, upstreamNodes, wantType = 'image') {
  const list = Array.isArray(node.data?.mediaRefs) ? node.data.mediaRefs : [];
  for (const key of mentionKeys(prompt)) {
    const hit = list.find((r) => r.key === key && r.type === wantType);
    if (hit?.url) return hit.url;
  }
  const first = list.find((r) => r.type === wantType && r.url);
  if (first?.url) return first.url;
  return wantType === 'image' ? findUpstreamImage(upstreamNodes) : null;
}

/** 送给模型的提示词里不要留 @ 记号（模型不认识），换成可读的「参考图N」 */
const stripMentions = (prompt) => String(prompt || '')
  .replace(/@\s*(图片|视频)\s*(\d+)/g, (_, t, n) => (t === '图片' ? `参考图${n}` : `参考视频${n}`))
  .trim();

// 供测试直接断言 @ 引用解析（test/agent-e2e 之外的小单测）
export { mentionKeys, stripMentions, pickRefUrl };

/* ---------- 4. 节点 handler 注册表 ---------- */
const HANDLERS = {
  textNode(node, ctx) {
    return { text: clip(node.data?.content || '') };
  },
  noteNode(node, ctx) {
    return { text: clip(node.data?.content || '') };
  },
  audioNode(node, ctx) {
    // 网关暂无 TTS，透传文本
    return { text: clip(node.data?.text || '') };
  },
  uploadNode(node, ctx) {
    const url = node.data?.url || '';
    return { url, kind: node.data?.kind || 'image', text: url };
  },
  assetNode(node, ctx) {
    const url = node.data?.url || '';
    return { url, kind: node.data?.kind || 'image', text: url };
  },
  async scriptNode(node, ctx) {
    const sid = node.data?.scriptId;
    if (!sid) throw new Error('请先选择一个剧本');
    const s = q.one('SELECT * FROM script WHERE id = ?', sid);
    if (!s) throw new Error('剧本不存在');
    const includeOutline = node.data?.includeOutline !== false;
    const text = [
      s.title && `【剧本标题】${s.title}`,
      includeOutline && s.outline && `【梗概】${s.outline}`,
      s.content,
    ].filter(Boolean).join('\n\n');
    return { text: clip(text), extra: { scriptTitle: s.title } };
  },
  async llmNode(node, ctx) {
    const prompt = buildPrompt(node, ctx.upstreamTexts);
    if (!prompt) throw new Error('提示词为空：请填写提示词或连接上游节点');
    const r = await callLLM(ctx.configs.thinking, {
      model: node.data?.modelId,
      system: node.data?.systemPrompt,
      user: prompt,
    });
    return { text: clip(r.text), extra: { modelUsed: r.model, tokens: r.usage?.total_tokens ?? null } };
  },
  async imageNode(node, ctx) {
    const prompt = buildPrompt(node, ctx.upstreamTexts);
    if (!prompt) throw new Error('提示词为空：请填写画面描述或连接上游节点');
    // 与视频节点一致：@图片N 优先；没写 mention 时取上游最后一张图（向后兼容）
    const imageUrl = pickRefUrl(node, node.data?.prompt || '', ctx.upstreamNodes, 'image');
    const r = await callImage(ctx.configs.image_gen, {
      model: node.data?.modelId,
      prompt: stripMentions(prompt),
      image: imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('data:') || imageUrl.startsWith('/outputs/')) ? imageUrl : undefined,
      size: node.data?.size || '1024x1024',
    });
    return { url: r.url, imageUrl: r.url, kind: 'image', text: prompt, extra: { modelUsed: r.model, imageUrl } };
  },
  async gridNode(node, ctx) {
    const prompt = buildPrompt(node, ctx.upstreamTexts);
    if (!prompt) throw new Error('提示词为空：请填写画面描述或连接上游节点');
    const count = Math.min(25, Math.max(2, Number(node.data?.count) || 9));
    const size = node.data?.size || '1024x1024';
    const images = [];
    for (let i = 0; i < count; i++) {
      const r = await callImage(ctx.configs.image_gen, { model: node.data?.modelId, prompt, size });
      images.push(r.url);
    }
    const pickedIndex = Number.isInteger(node.data?.pickedIndex) ? node.data.pickedIndex : images.length - 1;
    return {
      url: images[pickedIndex],
      images,
      pickedIndex,
      text: prompt,
      extra: { modelUsed: node.data?.modelId || ctx.configs.image_gen?.model_id || null },
    };
  },
  async videoNode(node, ctx) {
    const mode = node.data?.mode || 'text';
    const prompt = buildPrompt(node, ctx.upstreamTexts) || (node.data?.prompt || '');
    // 文生视频不需要上游图；其余模式（全能参考/图生视频/首尾帧）需要
    const needImage = mode !== 'text';
    // @图片N 优先；没写 mention 时取上游最后一张图（与旧行为一致）
    const imageUrl = needImage ? pickRefUrl(node, node.data?.prompt || '', ctx.upstreamNodes, 'image') : null;
    if (needImage && !imageUrl) throw new Error('该模式需要上游图片（上传/素材库/生图/分镜格子或首帧图）');
    if (!needImage && !prompt) throw new Error('提示词为空：请描述你想生成的视频内容');
    const r = await callVideo(ctx.configs.video, {
      model: node.data?.modelId,
      prompt: stripMentions(prompt),
      image: imageUrl && (imageUrl.startsWith('http') || imageUrl.startsWith('data:') || imageUrl.startsWith('/outputs/')) ? imageUrl : null,
      duration: Number(node.data?.duration) || 5,
      ratio: node.data?.ratio || '16:9',
      resolution: node.data?.resolution,
    });
    return { url: r.url, videoUrl: r.url, kind: 'video', text: prompt || r.url, extra: { modelUsed: r.model, imageUrl } };
  },

  /* 批量上传：把节点上的全部素材 URL 透传给下游 */
  batchUploadNode(node, ctx) {
    const items = Array.isArray(node.data?.items) ? node.data.items : [];
    const urls = items.map((i) => i.url).filter(Boolean);
    return { url: urls[0] || '', urls, kind: items[0]?.kind || 'image', text: urls.join('\n'), extra: { count: urls.length } };
  },

  /* 3D导演台：输出结构化运镜描述，供下游视频节点作为提示词引用 */
  directorNode(node, ctx) {
    const text = (node.data?.output || '').trim();
    if (!text) throw new Error('请先点「生成运镜描述」');
    return { text, extra: {} };
  },

  /* 视频合成：收集上游全部图片/视频，按顺序拼成一条成片（ffmpeg） */
  async composeNode(node, ctx) {
    const urls = [];
    for (const up of ctx.upstreamNodes) {
      const out = up._output;
      if (!out) continue;
      if (Array.isArray(out.urls)) urls.push(...out.urls);
      if (Array.isArray(out.images)) urls.push(...out.images);
      if (out.videoUrl) urls.push(out.videoUrl);
      else if (out.url) urls.push(out.url);
    }
    const uniq = [...new Set(urls)].filter(Boolean);
    if (!uniq.length) throw new Error('没有可合成的片段，请连接上游的图片或视频节点');
    const ratio = node.data?.ratio || '16:9';
    const [w, h] = ratio === '9:16' ? [1080, 1920] : ratio === '1:1' ? [1080, 1080] : [1920, 1080];
    const r = await concatClips({ urls: uniq, width: w, height: h, perImageSeconds: Number(node.data?.imageSeconds) || 3 });
    return { url: r.url, videoUrl: r.url, kind: 'video', text: r.url, extra: { clips: r.clips, skipped: r.skipped } };
  },
};

/* ---------- 5. 带超时 + 重试的执行包装 ---------- */
async function withRetry(fn, { retries = MAX_RETRIES, baseMs = BASE_BACKOFF_MS, timeoutMs = PER_NODE_TIMEOUT_MS } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await withTimeout(fn, timeoutMs);
    } catch (e) {
      lastErr = e;
      const transient = isTransient(e);
      if (!transient || attempt === retries) break;
      const wait = baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(Object.assign(new Error(`请求超时（${ms / 1000}s）`), { code: 'ETIMEDOUT' })); } }, ms);
    // 包一层 Promise.resolve 让同步 handler 也能走 then 分支
    Promise.resolve().then(() => fn()).then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(t); reject(e); } }
    );
  });
}

function isTransient(err) {
  if (!err) return false;
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') return true;
  const msg = String(err.message || err);
  if (/timeout|ECONNRESET|ETIMEDOUT|fetch failed|aborted/i.test(msg)) return true;
  // HTTP 状态码（在 message 里）
  const m = msg.match(/\b(429|500|502|503|504)\b/);
  return !!m;
}

/* ---------- 6. 主调度 ---------- */
export async function runWorkflow({ nodes = [], edges = [], targetIds = [], configs = {}, emitter = null }) {
  validateGraph(nodes, edges);

  const stages = topoStages(nodes, edges, targetIds);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outputs = new Map();   // nodeId → output
  const patches = [];          // 给前端的增量更新
  const steps = [];            // 调度日志
  const errors = [];           // 错误聚合
  let done = 0;
  const total = stages.reduce((s, x) => s + x.length, 0);

  const startedAt = Date.now();

  for (let si = 0; si < stages.length; si++) {
    const stageNodes = stages[si].map((id) => byId.get(id)).filter(Boolean);

    // 每个节点：先准备 ctx（上游输出 + 文本），再触发 running 事件
    const tasks = stageNodes.map((node) => {
      const upList = incoming(nodes, edges, node.id);
      upList.forEach((u) => { u.output = outputs.get(u.node.id) || null; });
      const ctx = {
        configs,
        upstreamNodes: upList.map((u) => ({ ...u.node, _output: u.output })),
        upstreamTexts: upList.map((u) => u.output?.text ?? ''),
      };

      const stepBase = { nodeId: node.id, kind: node.type, stage: si };
      emitter?.emitNode({ nodeId: node.id, kind: node.type, status: 'running', stage: si });
      patches.push({ nodeId: node.id, data: { status: 'running', error: null, stage: si, startedAt: new Date().toISOString() } });
      const t0 = Date.now();

      const handler = HANDLERS[node.type];
      if (!handler) {
        const ms = Date.now() - t0;
        const msg = `未知节点类型：${node.type}`;
        errors.push({ nodeId: node.id, message: msg });
        emitter?.emitNode({ nodeId: node.id, kind: node.type, status: 'error', error: msg, ms, stage: si });
        patches.push({ nodeId: node.id, data: { status: 'error', error: msg } });
        steps.push({ ...stepBase, status: 'error', error: msg, ms });
        return Promise.resolve();
      }

      return withRetry(() => handler(node, ctx), { timeoutMs: perNodeTimeout(node) })
        .then((out) => {
          const ms = Date.now() - t0;
          outputs.set(node.id, out);
          done += 1;
          const patch = { status: 'done', error: null, ranAt: new Date().toISOString(), ms };
          // 把 handler 返回的扩展字段合到 patch（imageUrl / videoUrl / images 等）
          if (out?.videoUrl) patch.videoUrl = out.videoUrl;
          else if (out?.url) patch.imageUrl = out.url;
          if (Array.isArray(out?.urls)) patch.urls = out.urls;
          if (Array.isArray(out?.images)) patch.images = out.images;
          if (Number.isInteger(out?.pickedIndex)) patch.pickedIndex = out.pickedIndex;
          if (out?.text) patch.output = out.text;
          if (out?.extra?.modelUsed) patch.modelUsed = out.extra.modelUsed;
          if (out?.extra?.tokens) patch.tokens = out.extra.tokens;
          if (out?.extra?.imageUrl) patch.imageUrl = out.extra.imageUrl;
          if (out?.extra?.scriptTitle) patch.scriptTitle = out.extra.scriptTitle;
          // SSE 实时事件必须带完整结果字段，前端才能回写 imageUrl / videoUrl / images / output 等
          emitter?.emitNode({ nodeId: node.id, kind: node.type, status: 'done', ms, stage: si, ...patch });
          patches.push({ nodeId: node.id, data: patch });
          steps.push({ ...stepBase, status: 'ok', ms });
          emitter?.emitProgress(done, total);
        })
        .catch((err) => {
          const ms = Date.now() - t0;
          const msg = err?.name === 'AbortError' ? '请求超时' : (err?.message || String(err));
          errors.push({ nodeId: node.id, message: msg });
          // 仅当"无可救药"时记 error；transient 重试 3 次仍失败也算 error
          emitter?.emitNode({ nodeId: node.id, kind: node.type, status: 'error', error: msg, ms, stage: si });
          patches.push({ nodeId: node.id, data: { status: 'error', error: msg } });
          steps.push({ ...stepBase, status: 'error', error: msg, ms });
          // 注意 — 不 break，让独立 stage 后续节点能跑
        });
    });

    await Promise.all(tasks);
  }

  const status = errors.length ? (errors.length === steps.length ? 'failed' : 'partial') : 'success';
  return {
    status,
    error: errors[0]?.message || null,
    errors,
    patches,
    steps,
    ms: Date.now() - startedAt,
    totalNodes: total,
    stages: stages.length,
  };
}

function perNodeTimeout(node) {
  // 视频节点普遍更慢，给 5 分钟；其他默认 90s
  if (node.type === 'videoNode') return 300_000;
  if (node.type === 'imageNode' || node.type === 'gridNode') return 120_000;
  return PER_NODE_TIMEOUT_MS;
}