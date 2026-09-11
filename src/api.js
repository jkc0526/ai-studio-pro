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
  /* 工作流运行：默认走 SSE 实时进度，事件回调 onEvent({event, data})
     - event 可能是 'node' / 'progress' / 'done' / 'fatal'
     - 返回 Promise，resolve 时拿到 done 事件的完整结果
     - 不需要 SSE 时传 stream:false，会走 JSON 接口 */
  run: (body, { stream = true, onEvent } = {}) => {
    if (!stream) return json('/api/run', { method: 'POST', body: { ...body, stream: false } });
    return runSSE('/api/run', { ...body, stream: true }, onEvent);
  },
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
