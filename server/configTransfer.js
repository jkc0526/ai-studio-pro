const cleanModelId = (value) => String(value || '').trim().replace(/^default::/i, '');
const safeText = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';

function normalizeModels(models) {
  if (!Array.isArray(models)) return [];
  return models.slice(0, 1000).map((model) => {
    const row = typeof model === 'string' ? { name: model } : (model || {});
    const id = cleanModelId(row.id || row.name || row.model);
    if (!id) return null;
    const durationRange = row.durationRange && typeof row.durationRange === 'object'
      ? Object.fromEntries(['min', 'max', 'default', 'minSeconds', 'maxSeconds', 'seconds', 'step']
        .filter((key) => Number.isFinite(Number(row.durationRange[key])))
        .map((key) => [key, Number(row.durationRange[key])]))
      : null;
    return {
      id,
      name: id,
      capability: safeText(row.capability || row.kind || row.type, 40).toLowerCase(),
      description: safeText(row.description || row.desc),
      ...(durationRange && Object.keys(durationRange).length ? { durationRange } : {}),
      ...(typeof row.price === 'number' || typeof row.price === 'string' ? { price: row.price } : {}),
    };
  }).filter(Boolean);
}

function normalizeBaseUrl(value) {
  const baseUrl = safeText(value, 2048).trim();
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('配置中的 Base URL 无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('配置中的 Base URL 必须是无账号密码、查询参数或片段的 HTTP(S) 地址');
  }
  return baseUrl.replace(/\/+$/, '');
}

function normalizeProvider(channel, fallback = {}) {
  const name = safeText(channel?.name || fallback.name, 120).trim();
  const base_url = normalizeBaseUrl(channel?.baseUrl || channel?.base_url || fallback.baseUrl || fallback.base_url);
  const apiFormat = String(channel?.apiFormat || channel?.protocol || fallback.apiFormat || 'openai').toLowerCase();
  const protocol = ['openai', 'openai-video', 'agnes-video', 'anthropic', 'gemini'].includes(apiFormat) ? apiFormat : 'openai';
  if (!name) throw new Error('配置中的供应商名称不能为空');
  return {
    name, protocol, base_url,
    models: normalizeModels(channel?.models || fallback.models),
    notes: safeText(channel?.notes || '从 infinite-canvas 配置导入'),
    enabled: channel?.enabled === false ? 0 : 1,
    source_id: safeText(channel?.id, 120),
  };
}

function normalizeAiConfigs(value, { withKeys = false } = {}) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(['thinking', 'image_gen', 'video']);
  return value.slice(0, 20).map((row) => {
    if (!row || typeof row !== 'object' || !allowed.has(row.purpose)) throw new Error('备份中的用途配置无效');
    return {
      purpose: row.purpose, provider: safeText(row.provider, 120),
      base_url: safeText(row.base_url, 2048),
      model_id: cleanModelId(row.model_id), provider_id: safeText(row.provider_id, 120),
      provider_name: safeText(row.provider_name, 120),
      custom_api_id: safeText(row.custom_api_id, 120),
      // v0.7.9：仅管理员导出（schemaVersion 2）携带 API Key
      ...(withKeys && safeText(row.api_key, 500) ? { api_key: safeText(row.api_key, 500) } : {}),
    };
  });
}

export function normalizeConfigImport(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置文件格式无效');

  if (raw.app === 'infinite-canvas') {
    const config = raw.config;
    if (!config || typeof config !== 'object') throw new Error('infinite-canvas 配置缺少 config');
    const channels = Array.isArray(config.channels) && config.channels.length
      ? config.channels
      : [{ name: '默认渠道', baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models }];
    if (channels.length > 100) throw new Error('配置中的渠道数量超出限制');
    const providers = channels.map((channel) => normalizeProvider(channel, config));
    const defaults = {
      image: cleanModelId(config.imageModel || config.model),
      video: cleanModelId(config.videoModel),
    };
    return { format: 'infinite-canvas', providers, defaults };
  }

  if (raw.app === 'weave-canvas' && (raw.schemaVersion === 1 || raw.schemaVersion === 2)) {
    const schemaV2 = raw.schemaVersion === 2;
    const providers = Array.isArray(raw.providers) ? raw.providers.slice(0, 100) : [];
    const aiConfigs = normalizeAiConfigs(raw.aiConfigs, { withKeys: schemaV2 });
    const safeProviders = providers.map((provider) => {
      if (!provider || typeof provider !== 'object') throw new Error('备份中的供应商配置无效');
      const name = safeText(provider.name, 120).trim();
      if (!name) throw new Error('备份中的供应商名称不能为空');
      const protocol = safeText(provider.protocol || 'openai', 40).toLowerCase();
      return {
        ...(safeText(provider.id, 120) ? { source_id: safeText(provider.id, 120) } : {}),
        name, protocol: ['openai', 'openai-video', 'agnes-video', 'anthropic', 'gemini'].includes(protocol) ? protocol : 'openai',
        base_url: normalizeBaseUrl(provider.base_url), models: normalizeModels(provider.models),
        notes: '从配置文件导入', enabled: provider.enabled === false || provider.enabled === 0 ? 0 : 1,
        // v0.7.9：仅管理员导出的 schemaVersion 2 携带 API Key
        ...(schemaV2 && safeText(provider.api_key, 500) ? { api_key: safeText(provider.api_key, 500) } : {}),
      };
    });
    return { format: 'weave-canvas', providers: safeProviders, aiConfigs, defaults: {} };
  }

  throw new Error('不支持的配置文件格式');
}
