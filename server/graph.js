import { callLLM, callImage } from './ai.js';

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
    const upstream = incoming(nodes, edges, id).map(({ node: src }) => outputs.get(src.id) || '');
    const started = Date.now();
    try {
      if (node.type === 'textNode' || node.type === 'noteNode') {
        outputs.set(id, clip(node.data?.content || ''));
        steps.push({ nodeId: id, kind: node.type, status: 'skipped', ms: 0 });
        continue;
      }
      if (node.type === 'llmNode') {
        const prompt = buildPrompt(node, upstream);
        if (!prompt) throw new Error('提示词为空：请填写提示词或连接上游节点');
        const r = await callLLM(configs.thinking, {
          model: node.data?.modelId, system: node.data?.systemPrompt, user: prompt,
        });
        outputs.set(id, clip(r.text));
        patches.push({ nodeId: id, data: { output: r.text, status: 'done', error: null, modelUsed: r.model, tokens: r.usage?.total_tokens ?? null, ranAt: new Date().toISOString() } });
        steps.push({ nodeId: id, kind: 'llm', status: 'ok', ms: Date.now() - started, model: r.model });
        continue;
      }
      if (node.type === 'imageNode') {
        const prompt = buildPrompt(node, upstream);
        if (!prompt) throw new Error('提示词为空：请填写画面描述或连接上游节点');
        const r = await callImage(configs.image_gen, {
          model: node.data?.modelId, prompt, size: node.data?.size || '1024x1024',
        });
        outputs.set(id, prompt);
        patches.push({ nodeId: id, data: { imageUrl: r.url, promptUsed: prompt, status: 'done', error: null, modelUsed: r.model, ranAt: new Date().toISOString() } });
        steps.push({ nodeId: id, kind: 'image', status: 'ok', ms: Date.now() - started, model: r.model, url: r.url });
        continue;
      }
      steps.push({ nodeId: id, kind: node.type || 'unknown', status: 'skipped' });
    } catch (err) {
      const msg = err?.name === 'AbortError' ? '请求超时' : (err?.message || String(err));
      patches.push({ nodeId: id, data: { status: 'error', error: msg } });
      steps.push({ nodeId: id, kind: node.type, status: 'error', ms: Date.now() - started, error: msg });
      // 出错时中断下游，避免级联报错
      break;
    }
  }

  const failed = steps.find((s) => s.status === 'error');
  return {
    status: failed ? 'failed' : 'success',
    error: failed?.error || null,
    patches,
    steps: steps.filter((s) => s.kind !== 'textNode' && s.kind !== 'noteNode'),
  };
}
