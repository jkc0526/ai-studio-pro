import { q, uid, now } from './db.js';
import { builtinSpec, customSpec, execute } from './endpoint.js';

/* ---------------- 配置解析 ----------------
   优先级：调用方临时覆盖 > 自定义接口 > 供应商 > 直填的 base_url/api_key */
export const PURPOSE_OF_KIND = { text: 'thinking', image: 'image_gen', video: 'video' };
export const KIND_OF_PURPOSE = { thinking: 'text', image_gen: 'image', video: 'video' };

/** 兼容三种调用：resolveTarget('thinking') / resolveTarget('text', cfgRowOrPurpose, override) / resolveTarget('video', 'video', {model}) */
export function resolveTarget(kindOrPurpose, arg = {}, override = {}) {
  let kind = kindOrPurpose;
  let passed = arg;
  if (KIND_OF_PURPOSE[kindOrPurpose]) {
    kind = KIND_OF_PURPOSE[kindOrPurpose];
    passed = kindOrPurpose;
  }
  const purpose = typeof passed === 'string' ? passed : (passed?.purpose || PURPOSE_OF_KIND[kind]);
  const cfg = (typeof passed === 'object' && passed?.base_url)
    ? passed
    : q.one('SELECT * FROM ai_config WHERE purpose = ?', purpose);
  if (!cfg) throw new Error('未找到模型配置，请先到「设置」里配置');

  const custom = override.customApiId
    ? q.one('SELECT * FROM custom_api WHERE id = ?', override.customApiId)
    : cfg.custom_api_id ? q.one('SELECT * FROM custom_api WHERE id = ?', cfg.custom_api_id) : null;
  const provider = custom ? null
    : (override.providerId ? q.one('SELECT * FROM provider WHERE id = ?', override.providerId)
      : cfg.provider_id ? q.one('SELECT * FROM provider WHERE id = ?', cfg.provider_id) : null);

  const baseURL = override.baseURL || provider?.base_url || cfg.base_url || '';
  const apiKey = override.apiKey || provider?.api_key || cfg.api_key || '';
  const protocol = override.protocol || provider?.protocol || 'openai';
  const model = override.model || cfg.model_id || '';
  const kindName = purpose === 'thinking' ? '文本' : purpose === 'image_gen' ? '图像' : '视频';

  if (!custom) {
    if (!apiKey) throw new Error(`「${kindName}模型」缺少 API Key，请到「设置」里填写或选择一个供应商`);
    if (!baseURL) throw new Error(`「${kindName}模型」缺少 Base URL，请到「设置」里填写或选择供应商`);
    if (!model) throw new Error(`「${kindName}模型」缺少模型名，请到「设置」里填写`);
  }
  return { purpose, cfg, custom, provider, baseURL, apiKey, protocol, model, label: custom?.name || provider?.name || purpose };
}

function specFor(kind, t, vars) {
  return t.custom
    ? customSpec(t.custom, { ...vars, model: t.model, base_url: t.baseURL, api_key: t.apiKey })
    : builtinSpec({ kind, protocol: t.protocol, baseURL: t.baseURL, model: t.model, vars });
}

/* ---------------- 文本 ---------------- */
export async function callLLM(arg, { model, system, user, maxTokens } = {}) {
  const t = resolveTarget('text', arg, { model });
  const spec = specFor('text', t, { system, user, maxTokens, model: t.model });
  const out = await execute({ spec, apiKey: t.apiKey, kind: 'text' });
  return {
    text: out.text,
    model: t.model || t.custom?.name,
    usage: out.raw?.usage || null,
    finishReason: out.raw?.choices?.[0]?.finish_reason || out.raw?.stop_reason || null,
    raw: out.raw,
  };
}

/* ---------------- 图像 ---------------- */
export async function callImage(arg, { model, prompt, size = '1024x1536' } = {}) {
  const t = resolveTarget('image', arg, { model });
  const spec = specFor('image', t, { prompt, size, model: t.model });
  const out = await execute({ spec, apiKey: t.apiKey, kind: 'image' });
  return { url: out.url, model: t.model, raw: out.raw, polls: out.polls };
}

/* ---------------- 视频 ---------------- */
export async function callVideo(arg, { model, prompt, image, duration = 5, ratio, resolution } = {}) {
  const t = resolveTarget('video', arg, { model });
  const spec = specFor('video', t, { prompt, image, duration, ratio, resolution, model: t.model });
  const out = await execute({ spec, apiKey: t.apiKey, kind: 'video' });
  return { url: out.url, sourceUrl: out.sourceUrl, model: t.model, raw: out.raw, polls: out.polls };
}

/* ---------------- 冒烟测试（设置页「测试连接」） ---------------- */
export async function testTarget(purpose, body = {}) {
  const override = {
    model: body.model_id || undefined,
    baseURL: body.base_url || undefined,
    apiKey: typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : undefined,
    customApiId: body.custom_api_id || undefined,
    providerId: body.provider_id || undefined,
  };
  const t = resolveTarget(purpose, {}, override);
  if (t.custom) {
    return {
      ok: true,
      detail: `将使用自定义接口「${t.custom.name}」：${t.custom.method || 'POST'} ${t.custom.url_template}；可用占位符 {{prompt}} {{image}} {{model}} {{size}} {{duration}} {{base_url}} {{api_key}}`,
    };
  }
  if (body.deep) {
    // 深度测试：真的发一次最小请求
    try {
      const kind = purpose === 'image_gen' ? 'image' : purpose === 'video' ? 'video' : 'text';
      const spec = builtinSpec({
        kind, protocol: t.protocol, baseURL: t.baseURL, model: t.model,
        vars: kind === 'text'
          ? { user: 'ping', system: '只回复 pong', maxTokens: 8 }
          : { prompt: 'test', size: '512x512', duration: 5 },
      });
      const out = await execute({ spec, apiKey: t.apiKey, kind, retry429: false });
      return { ok: true, detail: kind === 'text' ? `真实调用成功，模型回复：${String(out.text).slice(0, 40)}` : `真实调用成功，产物已落盘：${out.url}` };
    } catch (e) {
      return { ok: false, detail: `真实调用失败：${e.message}` };
    }
  }
  const url = `${String(t.baseURL).replace(/\/+$/, '')}/models`;
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${t.apiKey}` } });
    const text = await res.text();
    if (res.ok) {
      let count = null; let hit = null;
      try {
        const j = JSON.parse(text);
        count = j?.data?.length ?? null;
        hit = count && t.model ? j.data.some((m) => m.id === t.model) : null;
      } catch { /* ignore */ }
      return {
        ok: true,
        detail: `接口连通（${t.protocol}）${count !== null ? `，可用模型 ${count} 个` : ''}${hit === true ? `，已找到「${t.model}」` : hit === false ? `，列表中未见「${t.model}」，请核对模型名` : ''}`,
      };
    }
    return { ok: false, detail: `连接失败（HTTP ${res.status}）：${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, detail: `无法连接（${e.message}）— 请检查 Base URL 是否需要代理` };
  }
}

/* ---------------- 兼容旧签名 ---------------- */
export const resolveConfig = (cfg, model) => ({
  baseURL: String(cfg?.base_url || '').replace(/\/+$/, ''),
  apiKey: cfg?.api_key || '',
  model: model || cfg?.model_id || '',
});

export { uid, now };
