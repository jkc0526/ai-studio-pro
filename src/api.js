const json = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
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
  /* 工作流运行：默认走 SSE 实时进度，事件回调 onEvent({event, data})
     - event 可能是 'node' / 'progress' / 'done' / 'fatal'
     - 返回 Promise，resolve 时拿到 done 事件的完整结果
     - 不需要 SSE 时传 stream:false，会走 JSON 接口 */
  run: (body, { stream = true, onEvent } = {}) => {
    if (!stream) return json('/api/run', { method: 'POST', body: { ...body, stream: false } });
    return runSSE('/api/run', { ...body, stream: true }, onEvent);
  },
  upload: (body) => json('/api/upload', { method: 'POST', body }),
  uploadBatch: (body) => json('/api/upload/batch', { method: 'POST', body }),
  composeClips: (body) => json('/api/compose/clips', { method: 'POST', body }),

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

  // 场景（资产链第二环）
  listScenes: (scriptId) => json(`/api/scenes${scriptId ? `?scriptId=${scriptId}` : ''}`),
  createScene: (body) => json('/api/scenes', { method: 'POST', body }),
  updateScene: (id, body) => json(`/api/scenes/${id}`, { method: 'PUT', body }),
  deleteScene: (id) => json(`/api/scenes/${id}`, { method: 'DELETE' }),
  sceneImage: (id, body) => json(`/api/scenes/${id}/image`, { method: 'POST', body }),
  extractScenes: (id, body) => json(`/api/scripts/${id}/extract-scenes`, { method: 'POST', body }),

  // 项目工作区：脚本生成 / 提示词合成
  generateScript: (id, body) => json(`/api/scripts/${id}/generate`, { method: 'POST', body }),
  composeShots: (id, body) => json(`/api/scripts/${id}/compose`, { method: 'POST', body }),

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
  importConfiguration: (body) => json('/api/config/import', { method: 'POST', body }),
  exportConfiguration: () => json('/api/config/export'),
  // 管理员（v0.7.9）：登录后可导出/导入含 API Key 的完整配置
  adminStatus: () => json('/api/admin/status'),
  adminSetup: (body) => json('/api/admin/setup', { method: 'POST', body }),
  adminLogin: (body) => json('/api/admin/login', { method: 'POST', body }),
  exportConfigurationRaw: (withKeys, token) => json(
    '/api/config/export' + (withKeys ? '?withKeys=1' : ''),
    { headers: token ? { 'x-admin-token': token } : {} },
  ),
  listCustomApis: () => json('/api/custom-apis'),
  createCustomApi: (body) => json('/api/custom-apis', { method: 'POST', body }),
  updateCustomApi: (id, body) => json(`/api/custom-apis/${id}`, { method: 'PUT', body }),
  deleteCustomApi: (id) => json(`/api/custom-apis/${id}`, { method: 'DELETE' }),
  tryCustomApi: (id, body) => json(`/api/custom-apis/${id}/try`, { method: 'POST', body }),

  // 任务
  getJob: (id) => json(`/api/jobs/${id}`),

  // Agent 应用（v0.6）
  listAgents: () => json('/api/agents'),
  agentTools: () => json('/api/agents/tools'),

  // Skill 套路（v0.7）
  listSkills: (params) => json(`/api/skills${params ? `?${params}` : ''}`),
  skillMeta: () => json('/api/skills/meta'),
  getSkill: (id) => json(`/api/skills/${id}`),
  saveSkill: (body, id) => json(id ? `/api/skills/${id}` : '/api/skills', { method: id ? 'PUT' : 'POST', body }),
  deleteSkill: (id) => json(`/api/skills/${id}`, { method: 'DELETE' }),
  applySkill: (id, body) => json(`/api/skills/${id}/apply`, { method: 'POST', body }),
  saveAgent: (body, id) => json(id ? `/api/agents/${id}` : '/api/agents', { method: id ? 'PUT' : 'POST', body }),
  deleteAgent: (id) => json(`/api/agents/${id}`, { method: 'DELETE' }),
  listAgentRuns: (scriptId) => json(`/api/agent-runs${scriptId ? `?scriptId=${scriptId}` : ''}`),
  startAgentRun: (body) => json('/api/agent-runs', { method: 'POST', body }),
  getAgentRun: (id) => json(`/api/agent-runs/${id}`),
  resumeAgentRun: (id, body) => json(`/api/agent-runs/${id}/resume`, { method: 'POST', body }),
  stopAgentRun: (id) => json(`/api/agent-runs/${id}/stop`, { method: 'POST', body }),
  retryAgentRun: (id, fromSeq) => json(`/api/agent-runs/${id}/retry`, { method: 'POST', body: { fromSeq } }),
  /* 实时事件流：snapshot（全量快照）→ step / ask / budget（增量）→ done / fatal（终态后自动关闭）。
     返回 close 函数，组件卸载时调用。 */
  agentStream: (id, onEvent) => streamSSE(`/api/agent-runs/${id}/stream`, onEvent),
};

/* ---- GET SSE 客户端（EventSource 自带断线重连；终态时主动关闭） ---- */
function streamSSE(url, onEvent) {
  const es = new EventSource(url);
  const close = () => { try { es.close(); } catch { /* ignore */ } };
  for (const name of ['snapshot', 'step', 'ask', 'budget', 'done', 'fatal']) {
    es.addEventListener(name, (e) => {
      let data = null;
      try { data = JSON.parse(e.data); } catch { /* ping 或非 JSON */ }
      onEvent?.({ event: name, data });
      if (name === 'done' || name === 'fatal') close();
    });
  }
  es.onerror = () => { /* 断线时 EventSource 会自动重连；终态已 close，无需处理 */ };
  return close;
}

/* ---- SSE 客户端 ---- */
async function runSSE(url, body, onEvent) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`请求失败（HTTP ${res.status}）：${t.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';
  let final = null;
  let fatal = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    // 按空行分割事件
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
      let event = 'message', dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataStr += (dataStr ? '\n' : '') + line.slice(5).trim();
      }
      if (!dataStr) continue;
      let data = null;
      try { data = JSON.parse(dataStr); } catch { /* ignore */ }
      onEvent?.({ event, data });
      if (event === 'done') final = data;
      if (event === 'fatal') fatal = data;
    }
  }
  if (fatal) throw new Error(fatal.message || '执行失败');
  if (!final) throw new Error('未收到完成事件');
  return final;
}
