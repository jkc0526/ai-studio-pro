const safeModel = (model) => {
  if (typeof model === 'string') return model;
  if (!model || typeof model !== 'object') return null;
  const fields = ['id', 'name', 'model', 'capability', 'kind', 'type', 'description', 'desc', 'durationRange', 'price'];
  const safe = Object.fromEntries(fields.filter((key) => model[key] !== undefined).map((key) => [key, model[key]]));
  if (safe.durationRange && typeof safe.durationRange === 'object') {
    const durationFields = ['min', 'max', 'default', 'minSeconds', 'maxSeconds', 'seconds', 'step'];
    safe.durationRange = Object.fromEntries(durationFields.filter((key) => safe.durationRange[key] !== undefined).map((key) => [key, safe.durationRange[key]]));
  }
  if (safe.price !== undefined && !['string', 'number'].includes(typeof safe.price)) delete safe.price;
  return safe;
};

const safeBaseUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return value;
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Base URL 必须是无账号密码的 HTTP(S) 地址');
  }
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
};

export function sanitizeConfigForImport(raw) {
  if (raw?.app === 'infinite-canvas' && raw.config && typeof raw.config === 'object') {
    const configFields = ['baseUrl', 'apiFormat', 'models', 'imageModel', 'videoModel', 'model'];
    const channelFields = ['id', 'name', 'baseUrl', 'base_url', 'apiFormat', 'protocol', 'enabled', 'models'];
    const safeConfig = {
      app: raw.app, version: raw.version,
      config: Object.fromEntries(configFields.filter((key) => raw.config[key] !== undefined).map((key) => [
        key, key === 'baseUrl' ? safeBaseUrl(raw.config[key])
          : key === 'models' && Array.isArray(raw.config[key]) ? raw.config[key].map(safeModel).filter(Boolean)
            : raw.config[key],
      ])),
    };
    if (Array.isArray(raw.config.channels)) {
      safeConfig.config.channels = raw.config.channels.map((channel) => Object.fromEntries(
        channelFields.filter((key) => channel?.[key] !== undefined).map((key) => [
          key, ['baseUrl', 'base_url'].includes(key) ? safeBaseUrl(channel[key])
            : key === 'models' && Array.isArray(channel[key]) ? channel[key].map(safeModel).filter(Boolean)
              : channel[key],
        ]),
      ));
    }
    return safeConfig;
  }

  if (raw?.app === 'weave-canvas' && [1, 2].includes(raw.schemaVersion)) {
    const importApiKeys = raw.schemaVersion === 2 && raw.withKeys === true;
    const safeConfig = {
      app: 'weave-canvas', schemaVersion: raw.schemaVersion,
      providers: (Array.isArray(raw.providers) ? raw.providers : []).map((provider) => ({
        id: provider?.id, name: provider?.name, protocol: provider?.protocol, base_url: safeBaseUrl(provider?.base_url),
        models: Array.isArray(provider?.models) ? provider.models.map(safeModel).filter(Boolean) : [],
        enabled: provider?.enabled,
        ...(importApiKeys && typeof provider?.api_key === 'string' ? { api_key: provider.api_key } : {}),
      })),
      aiConfigs: (Array.isArray(raw.aiConfigs) ? raw.aiConfigs : []).map((config) => ({
        purpose: config?.purpose, provider: config?.provider, provider_name: config?.provider_name,
        base_url: safeBaseUrl(config?.base_url), model_id: config?.model_id, provider_id: config?.provider_id,
        custom_api_id: config?.custom_api_id,
        ...(importApiKeys && typeof config?.api_key === 'string' ? { api_key: config.api_key } : {}),
      })),
    };
    return safeConfig;
  }

  throw new Error('不支持的配置文件格式');
}
