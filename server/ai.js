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

  const custom = override.providerId ? null : override.customApiId
    ? q.one('SELECT * FROM custom_api WHERE id = ?', override.customApiId)
    : cfg.custom_api_id ? q.one('SELECT * FROM custom_api WHERE id = ?', cfg.custom_api_id) : null;
  const provider = custom ? null
    : (override.providerId ? q.one('SELECT * FROM provider WHERE id = ?', override.providerId)
      : cfg.provider_id ? q.one('SELECT * FROM provider WHERE id = ?', cfg.provider_id) : null);

  if (override.providerId && !provider) throw new Error('所选供应商不存在，请重新选择');
  if (provider && !provider.enabled) throw new Error(`供应商「${provider.name}」已停用，请到设置中启用后重试`);

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
export async function callImage(arg, { model, providerId, prompt, image, size = '1024x1536' } = {}) {
  const t = resolveTarget('image', arg, { model, providerId });
  const spec = specFor('image', t, { prompt, image, size, model: t.model });
  const out = await execute({ spec, apiKey: t.apiKey, kind: 'image' });
  return { url: out.url, model: t.model, raw: out.raw, polls: out.polls };
}

/* ---------------- 视频 ----------------
   入参说明（mode 系列为可选；不传则沿用旧的最小请求体，保持对既有调用方兼容）：
   - mode：Agnes 视频 mode（'text' | 'keyframe' | 'reference'）
   - referenceImages：reference 模式的参考图 URL 列表
   - firstFrame / lastFrame：keyframe 模式的首帧 / 尾帧 URL
   - size：网关分辨率枚举（如 '720P'），与前端分辨率解耦
   - audios：可选的音频参考 URL 列表                                            */
export async function callVideo(arg, {
  model, providerId, prompt, image, duration = 5, ratio, resolution,
  mode, referenceImages, firstFrame, lastFrame, audios, size,
} = {}) {
  const t = resolveTarget('video', arg, { model, providerId });
  const spec = specFor('video', t, {
    model: t.model,
    prompt,
    mode,
    images: referenceImages,
    audios,
    firstFrame,
    lastFrame,
    seconds: duration,
    duration: t.custom ? duration : undefined,
    size: size || resolution,
    ratio,
    image,
  });
  const out = await execute({ spec, apiKey: t.apiKey, kind: 'video' });
  return { url: out.url, sourceUrl: out.sourceUrl, model: t.model, raw: out.raw, polls: out.polls };
}

/* ---------------- 冒烟测试（设置页「测试连接」） ---------------- */

/**
 * 深度测试用的最小探活入参。
 * 注意：video + protocol='agnes-video' 必须带 mode（Agnes 把 mode 作为必填，缺失会 400，
 * 会让配置正确的用户误看到「真实调用失败」）；这里用最轻量的 mode='text'（无需任何媒体）。
 * 其它协议（openai / openai-video）保持不带 mode，行为不变。
 */
export function deepTestVars(kind, protocol) {
  if (kind === 'text') return { user: 'ping', system: '只回复 pong', maxTokens: 8 };
  const vars = { prompt: 'test', size: '512x512', duration: 5 };
  if (kind === 'video' && protocol === 'agnes-video') vars.mode = 'text';
  return vars;
}

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
        vars: deepTestVars(kind, t.protocol),
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
