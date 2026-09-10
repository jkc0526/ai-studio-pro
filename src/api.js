const json = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  if (!payload) throw new Error(`请求失败（HTTP ${res.status}）`);
  if (!payload.success) throw new Error(payload.error || '请求失败');
  return payload.data;
};

export const api = {
  health: () => json('/api/health'),
  listCanvases: () => json('/api/canvases'),
  getCanvas: (id) => json(`/api/canvases/${id}`),
  createCanvas: (body) => json('/api/canvases', { method: 'POST', body }),
  updateCanvas: (id, body) => json(`/api/canvases/${id}`, { method: 'PUT', body }),
  deleteCanvas: (id) => json(`/api/canvases/${id}`, { method: 'DELETE' }),
  getAiConfig: () => json('/api/ai-config'),
  saveAiConfig: (purpose, body) => json(`/api/ai-config/${purpose}`, { method: 'PUT', body }),
  testAiConfig: (purpose, body) => json(`/api/ai-config/${purpose}/test`, { method: 'POST', body }),
  listSnippets: () => json('/api/snippets'),
  createSnippet: (body) => json('/api/snippets', { method: 'POST', body }),
  deleteSnippet: (id) => json(`/api/snippets/${id}`, { method: 'DELETE' }),
  run: (body) => json('/api/run', { method: 'POST', body }),
  upload: (body) => json('/api/upload', { method: 'POST', body }),

  // 剧本
  listScripts: () => json('/api/scripts'),
  createScript: (body) => json('/api/scripts', { method: 'POST', body }),
  updateScript: (id, body) => json(`/api/scripts/${id}`, { method: 'PUT', body }),
  deleteScript: (id) => json(`/api/scripts/${id}`, { method: 'DELETE' }),
  splitShots: (id, body) => json(`/api/scripts/${id}/split`, { method: 'POST', body }),
  extractCharacters: (id, body) => json(`/api/scripts/${id}/extract-characters`, { method: 'POST', body }),

  // 镜头
  listShots: (scriptId) => json(`/api/scripts/${scriptId}/shots`),
  createShot: (scriptId, body) => json(`/api/scripts/${scriptId}/shots`, { method: 'POST', body }),
  updateShot: (id, body) => json(`/api/shots/${id}`, { method: 'PUT', body }),
  deleteShot: (id) => json(`/api/shots/${id}`, { method: 'DELETE' }),
  shotImage: (id, body) => json(`/api/shots/${id}/image`, { method: 'POST', body }),
  shotVideo: (id, body) => json(`/api/shots/${id}/video`, { method: 'POST', body }),
  batchImages: (scriptId, body) => json(`/api/scripts/${scriptId}/images`, { method: 'POST', body }),
  batchVideos: (scriptId, body) => json(`/api/scripts/${scriptId}/videos`, { method: 'POST', body }),
  listVariants: (shotId) => json(`/api/shots/${shotId}/variants`),
  selectVariant: (shotId, body) => json(`/api/shots/${shotId}/select-variant`, { method: 'POST', body }),
  exportMovie: (scriptId, body) => json(`/api/scripts/${scriptId}/export`, { method: 'POST', body }),
  ffmpeg: () => json('/api/ffmpeg'),
  media: (scriptId) => json(scriptId ? `/api/media?scriptId=${scriptId}` : '/api/media'),

  // 角色
  listCharacters: () => json('/api/characters'),
  createCharacter: (body) => json('/api/characters', { method: 'POST', body }),
  updateCharacter: (id, body) => json(`/api/characters/${id}`, { method: 'PUT', body }),
  deleteCharacter: (id) => json(`/api/characters/${id}`, { method: 'DELETE' }),
  characterSheet: (id, body) => json(`/api/characters/${id}/sheet`, { method: 'POST', body }),

  // 风格与模型
  listStyles: () => json('/api/styles'),
  createStyle: (body) => json('/api/styles', { method: 'POST', body }),
  deleteStyle: (id) => json(`/api/styles/${id}`, { method: 'DELETE' }),
  listModels: (qs) => json('/api/models' + (qs ? `?${qs}` : '')),
  probeModels: (body) => json('/api/models/probe', { method: 'POST', body }),

  // 供应商与自定义接口
  protocols: () => json('/api/protocols'),
  listProviders: () => json('/api/providers'),
  createProvider: (body) => json('/api/providers', { method: 'POST', body }),
  updateProvider: (id, body) => json(`/api/providers/${id}`, { method: 'PUT', body }),
  deleteProvider: (id) => json(`/api/providers/${id}`, { method: 'DELETE' }),
  listCustomApis: () => json('/api/custom-apis'),
  createCustomApi: (body) => json('/api/custom-apis', { method: 'POST', body }),
  updateCustomApi: (id, body) => json(`/api/custom-apis/${id}`, { method: 'PUT', body }),
  deleteCustomApi: (id) => json(`/api/custom-apis/${id}`, { method: 'DELETE' }),
  tryCustomApi: (id, body) => json(`/api/custom-apis/${id}/try`, { method: 'POST', body }),

  // 任务
  getJob: (id) => json(`/api/jobs/${id}`),
};
