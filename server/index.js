import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { db, q, seed, uid, now, ROOT, DATA_DIR, OUTPUT_DIR } from './db.js';
import { runWorkflow } from './graph.js';
import * as pipeline from './pipeline.js';
import * as videoMod from './video.js';
import * as exporter from './export.js';
import * as ai from './ai.js';
import * as endpointMod from './endpoint.js';

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '40mb' }));

seed();

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[api]', req.method, req.url, e);
  fail(res, e?.message || String(e), 500);
});

/* ---------------- 项目 ---------------- */
app.get('/api/projects', wrap((req, res) => ok(res, q.all('SELECT * FROM project ORDER BY create_time'))));
app.post('/api/projects', wrap((req, res) => {
  const id = uid('prj');
  q.run('INSERT INTO project (id, title, is_default, create_time, update_time) VALUES (?,?,0,?,?)',
    id, req.body?.title || '新项目', now(), now());
  ok(res, q.one('SELECT * FROM project WHERE id = ?', id));
}));

/* ---------------- 画布 ---------------- */
const emptyCanvas = () => JSON.stringify({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });

app.get('/api/canvases', wrap((req, res) => ok(res,
  q.all('SELECT id, project_id, title, node_count, cover_image_url, create_time, update_time FROM canvas ORDER BY update_time DESC'))));

app.get('/api/canvases/:id', wrap((req, res) => {
  const row = q.one('SELECT * FROM canvas WHERE id = ?', req.params.id);
  if (!row) return fail(res, '画布不存在', 404);
  ok(res, { ...row, canvas: JSON.parse(row.canvas_json || emptyCanvas()) });
}));

app.post('/api/canvases', wrap((req, res) => {
  const id = uid('cv');
  const projectId = req.body?.projectId || q.one('SELECT id FROM project LIMIT 1')?.id;
  const title = req.body?.title || '未命名画布';
  q.run('INSERT INTO canvas (id, project_id, title, canvas_json, node_count, create_time, update_time) VALUES (?,?,?,?,0,?,?)',
    id, projectId, title, emptyCanvas(), now(), now());
  ok(res, q.one('SELECT * FROM canvas WHERE id = ?', id));
}));

app.put('/api/canvases/:id', wrap((req, res) => {
  const { title, canvas } = req.body || {};
  const row = q.one('SELECT * FROM canvas WHERE id = ?', req.params.id);
  if (!row) return fail(res, '画布不存在', 404);
  const json = canvas ? JSON.stringify(canvas) : row.canvas_json;
  const nodeCount = canvas?.nodes?.length ?? row.node_count;
  q.run('UPDATE canvas SET title = ?, canvas_json = ?, node_count = ?, update_time = ? WHERE id = ?',
    title ?? row.title, json, nodeCount, now(), req.params.id);
  ok(res, q.one('SELECT id, title, node_count, update_time FROM canvas WHERE id = ?', req.params.id));
}));

app.delete('/api/canvases/:id', wrap((req, res) => {
  q.run('DELETE FROM canvas WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

/* ---------------- AI 配置（三个用途：文本/图像/视频） ---------------- */
const maskKey = (k) => (k ? `${k.slice(0, 6)}••••${k.slice(-4)}` : '');

app.get('/api/ai-config', wrap((req, res) => ok(res,
  q.all('SELECT * FROM ai_config').map((c) => ({
    purpose: c.purpose, provider: c.provider, base_url: c.base_url,
    model_id: c.model_id, has_key: !!c.api_key, key_hint: maskKey(c.api_key),
    provider_id: c.provider_id || null, custom_api_id: c.custom_api_id || null,
    provider_name: c.provider_id ? q.one('SELECT name FROM provider WHERE id = ?', c.provider_id)?.name || null : null,
    custom_api_name: c.custom_api_id ? q.one('SELECT name FROM custom_api WHERE id = ?', c.custom_api_id)?.name || null : null,
    effective: ai.resolveTarget(c.purpose).label,
  })))));

app.put('/api/ai-config/:purpose', wrap((req, res) => {
  const { base_url, api_key, model_id, provider, clear_key, provider_id, custom_api_id, notes } = req.body || {};
  const cur = q.one('SELECT * FROM ai_config WHERE purpose = ?', req.params.purpose);
  if (!cur) return fail(res, '未知的配置类型', 404);
  let nextKey = cur.api_key;
  if (clear_key === true) nextKey = '';
  else if (typeof api_key === 'string' && api_key.trim()) nextKey = api_key.trim();
  q.run(`UPDATE ai_config SET provider = ?, base_url = ?, api_key = ?, model_id = ?,
         provider_id = ?, custom_api_id = ?, notes = ?, update_time = ? WHERE purpose = ?`,
    provider ?? cur.provider, String((base_url ?? cur.base_url) || '').trim(), nextKey,
    String((model_id ?? cur.model_id) || '').trim(),
    provider_id === undefined ? cur.provider_id : (provider_id || null),
    custom_api_id === undefined ? cur.custom_api_id : (custom_api_id || null),
    notes === undefined ? cur.notes : notes, now(), req.params.purpose);
  const saved = q.one('SELECT * FROM ai_config WHERE purpose = ?', req.params.purpose);
  ok(res, {
    purpose: req.params.purpose, saved: true, base_url: saved.base_url, model_id: saved.model_id,
    has_key: !!saved.api_key, key_hint: maskKey(saved.api_key),
    provider_id: saved.provider_id, custom_api_id: saved.custom_api_id,
    effective: ai.resolveTarget(req.params.purpose).label,
  });
}));

app.post('/api/ai-config/:purpose/test', wrap(async (req, res) => {
  const purpose = req.params.purpose;
  if (!q.one('SELECT id FROM ai_config WHERE purpose = ?', purpose)) return fail(res, '未知的配置类型', 404);
  const out = await ai.testTarget(purpose, req.body || {});
  return out.ok ? ok(res, out) : fail(res, out.detail);
}));

/* ---------------- 供应商（第三方 / 自建网关） ---------------- */
app.get('/api/protocols', wrap((req, res) => ok(res, endpointMod.PROTOCOLS)));

app.get('/api/providers', wrap((req, res) => ok(res,
  q.all('SELECT * FROM provider ORDER BY create_time').map((p) => ({
    id: p.id, name: p.name, protocol: p.protocol, base_url: p.base_url, notes: p.notes, enabled: p.enabled,
    has_key: !!p.api_key, key_hint: maskKey(p.api_key),
    models: (() => { try { return JSON.parse(p.models_json || '[]'); } catch { return []; } })(),
    update_time: p.update_time,
  })))));

app.post('/api/providers', wrap((req, res) => {
  const b = req.body || {};
  const id = uid('pv');
  q.run('INSERT INTO provider (id, name, protocol, base_url, api_key, models_json, notes, enabled, create_time, update_time) VALUES (?,?,?,?,?,?,?,1,?,?)',
    id, b.name || '新供应商', b.protocol || 'openai', b.base_url || '', b.api_key || '',
    JSON.stringify(b.models || []), b.notes || '', now(), now());
  ok(res, q.one('SELECT * FROM provider WHERE id = ?', id));
}));

app.put('/api/providers/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM provider WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '供应商不存在', 404);
  const b = req.body || {};
  let key = cur.api_key;
  if (b.clear_key === true) key = '';
  else if (typeof b.api_key === 'string' && b.api_key.trim()) key = b.api_key.trim();
  q.run('UPDATE provider SET name = ?, protocol = ?, base_url = ?, api_key = ?, models_json = ?, notes = ?, enabled = ?, update_time = ? WHERE id = ?',
    b.name ?? cur.name, b.protocol ?? cur.protocol, (b.base_url ?? cur.base_url) || '', key,
    b.models ? JSON.stringify(b.models) : cur.models_json, b.notes ?? cur.notes,
    b.enabled === undefined ? cur.enabled : (b.enabled ? 1 : 0), now(), req.params.id);
  const out = q.one('SELECT * FROM provider WHERE id = ?', req.params.id);
  ok(res, { id: out.id, name: out.name, has_key: !!out.api_key, key_hint: maskKey(out.api_key) });
}));

app.delete('/api/providers/:id', wrap((req, res) => {
  q.run('UPDATE ai_config SET provider_id = NULL WHERE provider_id = ?', req.params.id);
  q.run('DELETE FROM provider WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

/* ---------------- 自定义 API 接口 ---------------- */
app.get('/api/custom-apis', wrap((req, res) => ok(res, q.all('SELECT * FROM custom_api ORDER BY create_time'))));

app.post('/api/custom-apis', wrap((req, res) => {
  const b = req.body || {};
  const id = uid('ca');
  q.run(`INSERT INTO custom_api (id, name, kind, method, url_template, headers_json, body_template,
         response_path, result_type, text_path, poll_url_template, poll_interval, poll_max,
         poll_status_path, poll_done_values, poll_fail_values, poll_result_path, notes, create_time, update_time)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, b.name || '新接口', b.kind || 'image', b.method || 'POST', b.url_template || '',
    b.headers_json || '{}', b.body_template || '', b.response_path || '', b.result_type || 'auto',
    b.text_path || '', b.poll_url_template || '', Number(b.poll_interval) || 5000, Number(b.poll_max) || 120,
    b.poll_status_path || 'status', b.poll_done_values || 'completed,success', b.poll_fail_values || 'failed,error',
    b.poll_result_path || '', b.notes || '', now(), now());
  ok(res, q.one('SELECT * FROM custom_api WHERE id = ?', id));
}));

app.put('/api/custom-apis/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM custom_api WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '接口不存在', 404);
  const b = req.body || {};
  const cols = ['name', 'kind', 'method', 'url_template', 'headers_json', 'body_template', 'response_path',
    'result_type', 'text_path', 'poll_url_template', 'poll_interval', 'poll_max', 'poll_status_path',
    'poll_done_values', 'poll_fail_values', 'poll_result_path', 'notes'];
  const sets = cols.map((c) => c + ' = ?').join(', ');
  const vals = cols.map((c) => (b[c] === undefined ? cur[c] : b[c]));
  q.run('UPDATE custom_api SET ' + sets + ', update_time = ? WHERE id = ?', ...vals, now(), req.params.id);
  ok(res, q.one('SELECT * FROM custom_api WHERE id = ?', req.params.id));
}));

app.delete('/api/custom-apis/:id', wrap((req, res) => {
  q.run('UPDATE ai_config SET custom_api_id = NULL WHERE custom_api_id = ?', req.params.id);
  q.run('DELETE FROM custom_api WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

// 试跑自定义接口：真实发一次请求并回显取到的结果
app.post('/api/custom-apis/:id/try', wrap(async (req, res) => {
  const row = q.one('SELECT * FROM custom_api WHERE id = ?', req.params.id);
  if (!row) return fail(res, '接口不存在', 404);
  const b = req.body || {};
  const spec = endpointMod.customSpec(row, {
    prompt: b.prompt || '一只在雨夜街道行走的黑猫，电影感打光',
    image: b.image || '', model: b.model || '', size: b.size || '1024x1024',
    duration: b.duration || 5, system: b.system || '', user: b.user || '只回复 pong',
    maxTokens: Number(b.max_tokens) || 512, max_tokens: Number(b.max_tokens) || 512,
    base_url: b.base_url || '', api_key: b.api_key || '',
  });
  const t0 = Date.now();
  try {
    const out = await endpointMod.execute({ spec, apiKey: b.api_key || undefined, kind: row.kind || 'image', retry429: false });
    ok(res, {
      ok: true, ms: Date.now() - t0, polls: out.polls || 0,
      text: out.text || null, url: out.url || null,
      raw: JSON.stringify(out.raw || {}).slice(0, 800),
      request: { method: spec.method, url: spec.url, body: spec.body },
    });
  } catch (e) {
    fail(res, e.message + '（试跑耗时 ' + (Date.now() - t0) + ' ms）');
  }
}));

/* ---------------- 提示词片段 ---------------- */
app.get('/api/snippets', wrap((req, res) => ok(res, q.all('SELECT * FROM snippet ORDER BY create_time DESC'))));
app.post('/api/snippets', wrap((req, res) => {
  const id = uid('ps');
  q.run('INSERT INTO snippet (id, name, content, create_time, update_time) VALUES (?,?,?,?,?)',
    id, req.body?.name || '未命名片段', req.body?.content || '', now(), now());
  ok(res, q.one('SELECT * FROM snippet WHERE id = ?', id));
}));
app.delete('/api/snippets/:id', wrap((req, res) => {
  q.run('DELETE FROM snippet WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

/* ---------------- 工作流执行 ---------------- */
app.post('/api/run', wrap(async (req, res) => {
  const { canvasId, canvas, nodeIds = [] } = req.body || {};
  if (!canvas?.nodes) return fail(res, '缺少画布数据');
  const configs = {};
  for (const c of q.all('SELECT * FROM ai_config')) configs[c.purpose] = c;

  const startedAt = Date.now();
  const result = await runWorkflow({ nodes: canvas.nodes, edges: canvas.edges || [], targetIds: nodeIds, configs });
  const runId = uid('run');
  q.run('INSERT INTO run_log (id, canvas_id, status, steps_json, error, create_time) VALUES (?,?,?,?,?,?)',
    runId, canvasId || null, result.status, JSON.stringify(result.steps), result.error, now());

  if (canvasId) {
    const row = q.one('SELECT canvas_json FROM canvas WHERE id = ?', canvasId);
    if (row) {
      q.run('UPDATE canvas SET canvas_json = ?, node_count = ?, update_time = ? WHERE id = ?',
        JSON.stringify(canvas), canvas.nodes.length, now(), canvasId);
    }
  }
  for (const p of result.patches) {
    if (!p.data?.imageUrl) continue;
    q.run('INSERT INTO asset (id, canvas_id, node_id, file_path, media_type, prompt, model, create_time) VALUES (?,?,?,?,?,?,?,?)',
      uid('as'), canvasId || null, p.nodeId, p.data.imageUrl, 'image',
      p.data.promptUsed || '', p.data.modelUsed || '', now());
  }
  if (result.status === 'failed') {
    return res.status(200).json({ success: false, error: result.error, data: result });
  }
  ok(res, { ...result, runId, ms: Date.now() - startedAt });
}));

app.get('/api/runs', wrap((req, res) => ok(res,
  q.all('SELECT id, canvas_id, status, error, create_time FROM run_log ORDER BY create_time DESC LIMIT 30'))));

/* ---------------- 生成产物 ---------------- */
app.get('/api/assets', wrap((req, res) => ok(res,
  req.query.canvasId
    ? q.all('SELECT * FROM asset WHERE canvas_id = ? ORDER BY create_time DESC', req.query.canvasId)
    : q.all('SELECT * FROM asset ORDER BY create_time DESC LIMIT 100'))));

/* ---------------- 剧本 ---------------- */
const projId = () => q.one('SELECT id FROM project ORDER BY create_time LIMIT 1')?.id || null;

app.get('/api/scripts', wrap((req, res) => ok(res,
  q.all('SELECT * FROM script ORDER BY update_time DESC'))));

app.post('/api/scripts', wrap((req, res) => {
  const id = uid('sc');
  q.run('INSERT INTO script (id, project_id, title, outline, content, style_id, sort_order, create_time, update_time) VALUES (?,?,?,?,?,?,0,?,?)',
    id, projId(), req.body?.title || '新剧本', req.body?.outline || '', req.body?.content || '', req.body?.styleId || null, now(), now());
  ok(res, q.one('SELECT * FROM script WHERE id = ?', id));
}));

app.put('/api/scripts/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '剧本不存在', 404);
  const b = req.body || {};
  q.run('UPDATE script SET title = ?, outline = ?, content = ?, style_id = ?, update_time = ? WHERE id = ?',
    b.title ?? cur.title, b.outline ?? cur.outline, b.content ?? cur.content,
    b.styleId === undefined ? cur.style_id : b.styleId, now(), req.params.id);
  ok(res, q.one('SELECT * FROM script WHERE id = ?', req.params.id));
}));

app.delete('/api/scripts/:id', wrap((req, res) => {
  q.run('DELETE FROM shot WHERE script_id = ?', req.params.id);
  q.run('DELETE FROM script WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

/* ---------------- 分镜（镜头表） ---------------- */
const shotsOf = (scriptId) => q.all('SELECT * FROM shot WHERE script_id = ? ORDER BY seq', scriptId);

app.get('/api/scripts/:id/shots', wrap((req, res) => ok(res, shotsOf(req.params.id))));
app.get('/api/shots/:id', wrap((req, res) => {
  const row = q.one('SELECT * FROM shot WHERE id = ?', req.params.id);
  if (!row) return fail(res, '镜头不存在', 404);
  ok(res, row);
}));

app.post('/api/scripts/:id/shots', wrap((req, res) => {
  const b = req.body || {};
  const maxSeq = q.one('SELECT COALESCE(MAX(seq),0) m FROM shot WHERE script_id = ?', req.params.id)?.m || 0;
  const id = uid('sh');
  q.run('INSERT INTO shot (id, script_id, seq, scene, dialogue, camera, duration, character_ids, style_id, status, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    id, req.params.id, b.seq || maxSeq + 1, b.scene || '', b.dialogue || '', b.camera || '',
    Number(b.duration) || 5, JSON.stringify(b.characterIds || []), b.styleId || null, 'idle', now(), now());
  ok(res, q.one('SELECT * FROM shot WHERE id = ?', id));
}));

app.put('/api/shots/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM shot WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '镜头不存在', 404);
  const b = req.body || {};
  q.run(`UPDATE shot SET seq = ?, scene = ?, dialogue = ?, camera = ?, duration = ?,
         character_ids = ?, style_id = ?, image_url = ?, video_url = ?, status = ?, error = ?, update_time = ?
         WHERE id = ?`,
    b.seq ?? cur.seq, b.scene ?? cur.scene, b.dialogue ?? cur.dialogue, b.camera ?? cur.camera,
    b.duration ?? cur.duration,
    b.characterIds === undefined ? cur.character_ids : JSON.stringify(b.characterIds),
    b.styleId === undefined ? cur.style_id : b.styleId,
    b.imageUrl === undefined ? cur.image_url : b.imageUrl,
    b.videoUrl === undefined ? cur.video_url : b.videoUrl,
    b.status ?? cur.status, b.error === undefined ? cur.error : b.error, now(), req.params.id);
  ok(res, q.one('SELECT * FROM shot WHERE id = ?', req.params.id));
}));

app.delete('/api/shots/:id', wrap((req, res) => {
  q.run('DELETE FROM shot WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

const needCfg = (purpose) => {
  ai.resolveTarget(purpose); // 抛错即说明配置不完整（含供应商 / 自定义接口的情况）
  return q.one('SELECT * FROM ai_config WHERE purpose = ?', purpose);
};

// 一键拆分镜：剧本 → 镜头表
app.post('/api/scripts/:id/split', wrap(async (req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  if (!(script.content || '').trim()) return fail(res, '剧本正文为空，先写点内容再拆分镜');
  const cfg = needCfg('thinking');
  const b = req.body || {};
  const characters = q.all('SELECT * FROM character');
  const style = b.styleId ? q.one('SELECT * FROM style_preset WHERE id = ?', b.styleId) : null;

  const { shots, model, salvaged, truncated } = await pipeline.splitScript({
    script, characters, style, cfg, count: Number(b.count) || 6, model: b.modelId,
  });
  const mode = b.mode === 'append' ? 'append' : 'replace';
  let deleted = 0;
  if (mode === 'replace') {
    deleted = q.one('SELECT COUNT(*) c FROM shot WHERE script_id = ?', script.id)?.c || 0;
    q.run('DELETE FROM shot WHERE script_id = ?', script.id);
  } else if (b.replace === true) {
    // 兼容旧参数：只清掉没出图的占位镜头
    const rows = q.all('SELECT id FROM shot WHERE script_id = ? AND image_url IS NULL', script.id);
    deleted = rows.length;
    q.run('DELETE FROM shot WHERE script_id = ? AND image_url IS NULL', script.id);
  }
  const base = mode === 'append'
    ? (q.one('SELECT COALESCE(MAX(seq),0) m FROM shot WHERE script_id = ?', script.id)?.m || 0)
    : 0;
  for (const s of shots) {
    q.run('INSERT INTO shot (id, script_id, seq, scene, dialogue, camera, duration, character_ids, style_id, status, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      uid('sh'), script.id, base + s.seq, s.scene, s.dialogue, s.camera, s.duration, s.character_ids,
      b.styleId || script.style_id || null, 'idle', now(), now());
  }
  if (mode === 'append') {
    // 追加后按当前顺序重排，避免出现重复 seq
    const all = shotsOf(script.id);
    all.forEach((row, i) => q.run('UPDATE shot SET seq = ? WHERE id = ?', i + 1, row.id));
  }
  ok(res, {
    created: shots.length, deleted, mode, model, salvaged, truncated,
    warning: truncated ? `模型输出达到长度上限，已自动保留完整的 ${shots.length} 个镜头；如需更多镜头请分批生成` : null,
    shots: shotsOf(script.id),
  });
}));

// 从剧本 AI 提取角色档案
app.post('/api/scripts/:id/extract-characters', wrap(async (req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const cfg = needCfg('thinking');
  const { characters, model } = await pipeline.extractCharacters({ script, cfg, model: req.body?.modelId });
  const created = [];
  for (const c of characters) {
    if (q.one('SELECT id FROM character WHERE name = ?', c.name)) continue;
    const id = uid('ch');
    q.run('INSERT INTO character (id, project_id, name, role, appearance, outfit, personality, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?)',
      id, projId(), c.name, c.role, c.appearance, c.outfit, c.personality, now(), now());
    created.push(id);
  }
  ok(res, { model, created: created.length, skipped: characters.length - created.length, characters: q.all('SELECT * FROM character') });
}));

/* ---------------- 角色档案 ---------------- */
app.get('/api/characters', wrap((req, res) => ok(res, q.all('SELECT * FROM character ORDER BY create_time'))));

app.post('/api/characters', wrap((req, res) => {
  const b = req.body || {};
  const id = uid('ch');
  q.run('INSERT INTO character (id, project_id, name, role, appearance, outfit, personality, ref_image_url, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, projId(), b.name || '新角色', b.role || '', b.appearance || '', b.outfit || '', b.personality || '', b.refImageUrl || null, now(), now());
  ok(res, q.one('SELECT * FROM character WHERE id = ?', id));
}));

app.put('/api/characters/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM character WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '角色不存在', 404);
  const b = req.body || {};
  q.run('UPDATE character SET name = ?, role = ?, appearance = ?, outfit = ?, personality = ?, ref_image_url = ?, update_time = ? WHERE id = ?',
    b.name ?? cur.name, b.role ?? cur.role, b.appearance ?? cur.appearance, b.outfit ?? cur.outfit,
    b.personality ?? cur.personality, b.refImageUrl === undefined ? cur.ref_image_url : b.refImageUrl,
    now(), req.params.id);
  ok(res, q.one('SELECT * FROM character WHERE id = ?', req.params.id));
}));

app.delete('/api/characters/:id', wrap((req, res) => {
  q.run('DELETE FROM character WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

// 角色三视图（锁定形象）
app.post('/api/characters/:id/sheet', wrap(async (req, res) => {
  const character = q.one('SELECT * FROM character WHERE id = ?', req.params.id);
  if (!character) return fail(res, '角色不存在', 404);
  const cfg = needCfg('image_gen');
  const out = await pipeline.generateCharacterSheet({
    character, styleId: req.body?.styleId || null, imageCfg: cfg,
    model: req.body?.modelId, size: req.body?.size,
  });
  ok(res, out);
}));

/* ---------------- 风格库 ---------------- */
app.get('/api/styles', wrap((req, res) => ok(res, q.all('SELECT * FROM style_preset ORDER BY builtin DESC, create_time'))));
app.post('/api/styles', wrap((req, res) => {
  const b = req.body || {};
  const id = uid('sty');
  q.run('INSERT INTO style_preset (id, name, prompt_prefix, negative_prompt, builtin, create_time, update_time) VALUES (?,?,?,?,0,?,?)',
    id, b.name || '自定义风格', b.promptPrefix || '', b.negativePrompt || '', now(), now());
  ok(res, q.one('SELECT * FROM style_preset WHERE id = ?', id));
}));
app.delete('/api/styles/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM style_preset WHERE id = ?', req.params.id);
  if (cur?.builtin) return fail(res, '内置风格不可删除，可复制后修改');
  q.run('DELETE FROM style_preset WHERE id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

/* ---------------- 生图：单镜 / 批量 ---------------- */
app.post('/api/shots/:id/image', wrap(async (req, res) => {
  const shot = q.one('SELECT * FROM shot WHERE id = ?', req.params.id);
  if (!shot) return fail(res, '镜头不存在', 404);
  const cfg = needCfg('image_gen');
  const variants = Math.min(4, Math.max(1, Number(req.body?.variants) || 1));
  q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'running', now(), shot.id);
  try {
    const produced = [];
    for (let i = 0; i < variants; i++) {
      const out = await pipeline.generateShotImage({
        shot, styleId: req.body?.styleId || shot.style_id, imageCfg: cfg,
        extra: req.body?.extra || '', size: req.body?.size || '1024x1536', model: req.body?.modelId,
      });
      produced.push(out);
      if (i > 0) {
        q.run('UPDATE shot_variant SET selected = 0 WHERE shot_id = ?', shot.id);
        q.run('UPDATE shot SET image_url = ?, status = ?, error = NULL, update_time = ? WHERE id = ?', out.image_url, 'done', now(), shot.id);
      }
    }
    for (const p of produced) {
      q.run('INSERT INTO shot_variant (id, shot_id, image_url, prompt, model, selected, create_time) VALUES (?,?,?,?,?,?,?)',
        uid('vr'), shot.id, p.image_url, p.prompt, p.model, produced.indexOf(p) === produced.length - 1 ? 1 : 0, now());
    }
    ok(res, { image_url: produced[produced.length - 1].image_url, prompt: produced[produced.length - 1].prompt, model: produced[produced.length - 1].model, variants: produced.map((p) => p.image_url) });
  } catch (e) {
    q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
    throw e;
  }
}));

app.post('/api/scripts/:id/images', wrap((req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const cfg = needCfg('image_gen');
  const b = req.body || {};
  let shots = shotsOf(script.id);
  if (Array.isArray(b.shotIds) && b.shotIds.length) shots = shots.filter((s) => b.shotIds.includes(s.id));
  if (b.onlyMissing) shots = shots.filter((s) => !s.image_url);
  if (!shots.length) return fail(res, '没有需要生成的镜头');

  const job = pipeline.startBatch({
    kind: 'shot.image', scopeId: script.id, items: shots.map((s) => ({ id: s.id, label: `镜头 ${s.seq}` })),
    worker: async (item) => {
      const shot = q.one('SELECT * FROM shot WHERE id = ?', item.id);
      q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'running', now(), shot.id);
      try {
        return await pipeline.generateShotImage({
          shot, styleId: b.styleId || shot.style_id, imageCfg: cfg,
          extra: b.extra || '', size: b.size || '1024x1536', model: b.modelId,
        });
      } catch (e) {
        q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
        throw e;
      }
    },
  });
  ok(res, { jobId: job.id, total: job.total });
}));

/* ---------------- 任务进度 ---------------- */
app.get('/api/jobs/:id', wrap((req, res) => {
  const job = pipeline.getJob(req.params.id);
  if (!job) return fail(res, '任务不存在', 404);
  ok(res, job);
}));
app.get('/api/jobs', wrap((req, res) => ok(res, pipeline.listJobs())));

/* ---------------- 模型清单（供下拉选择） ----------------
   支持 ?purpose=thinking|image_gen|video 或 ?providerId= / ?customApiId= 指定来源 */
let modelCache = new Map();
app.get('/api/models', wrap(async (req, res) => {
  const purpose = req.query.purpose || 'thinking';
  const override = {};
  if (req.query.providerId) override.providerId = req.query.providerId;
  if (req.query.customApiId) override.customApiId = req.query.customApiId;
  if (req.query.base_url) override.baseURL = req.query.base_url;
  if (req.query.api_key) override.apiKey = req.query.api_key;

  let target;
  try { target = ai.resolveTarget(purpose, {}, override); }
  catch (e) { return ok(res, { list: [], error: e.message }); }

  if (target.custom) {
    const models = q.all('SELECT models_json FROM provider WHERE 1=0');
    return ok(res, { list: [], custom: true, error: null, hint: '当前用途走自定义接口，不需要模型列表', groups: { text: [], image: [], video: [] }, defaults: {}, blocked: [] });
  }

  const decorate = (list) => {
    const acl = videoMod.getAcl();
    const usingOwnProvider = !!override.providerId || !!req.query.base_url;
    const allowed = (acl && !usingOwnProvider) ? list.filter((m) => acl.includes(m)) : list;
    const blocked = (acl && !usingOwnProvider) ? list.filter((m) => !acl.includes(m)) : [];
    return {
      list: allowed, blocked,
      groups: {
        text: allowed.filter((m) => videoMod.modelKind(m) === 'text'),
        image: allowed.filter((m) => videoMod.modelKind(m) === 'image'),
        video: allowed.filter((m) => videoMod.modelKind(m) === 'video'),
      },
      defaults: {
        text: purpose === 'thinking' ? target.model : videoMod.pickModel('text'),
        image: purpose === 'image_gen' ? target.model : videoMod.pickModel('image'),
        video: purpose === 'video' ? target.model : videoMod.pickModel('video'),
      },
      source: target.label,
    };
  };

  const cacheKey = `${target.baseURL}|${target.apiKey.slice(-6)}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60000 && cached.list.length) return ok(res, decorate(cached.list));

  try {
    const r = await fetch(`${String(target.baseURL).replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${target.apiKey}` } });
    const text = await r.text();
    if (!r.ok) return ok(res, { list: [], error: `获取模型列表失败（HTTP ${r.status}）：${text.slice(0, 160)}` });
    const j = JSON.parse(text);
    const list = (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
    modelCache.set(cacheKey, { at: Date.now(), list });
    ok(res, decorate(list));
  } catch (e) {
    ok(res, { list: [], error: `获取模型列表失败：${e.message}` });
  }
}));

/* ---------------- 多版本择优 ---------------- */
const variantsOf = (shotId) => q.all('SELECT * FROM shot_variant WHERE shot_id = ? ORDER BY create_time DESC', shotId);

app.get('/api/shots/:id/variants', wrap((req, res) => ok(res, variantsOf(req.params.id))));

app.post('/api/shots/:id/select-variant', wrap((req, res) => {
  const shot = q.one('SELECT * FROM shot WHERE id = ?', req.params.id);
  if (!shot) return fail(res, '镜头不存在', 404);
  const v = q.one('SELECT * FROM shot_variant WHERE id = ?', req.body?.variantId);
  if (!v) return fail(res, '版本不存在', 404);
  q.run('UPDATE shot_variant SET selected = 0 WHERE shot_id = ?', shot.id);
  q.run('UPDATE shot_variant SET selected = 1 WHERE id = ?', v.id);
  q.run('UPDATE shot SET image_url = ?, prompt_used = ?, status = ?, error = NULL, update_time = ? WHERE id = ?',
    v.image_url, v.prompt, 'done', now(), shot.id);
  ok(res, q.one('SELECT * FROM shot WHERE id = ?', shot.id));
}));

/* ---------------- 视频（图生视频） ---------------- */
const shotPromptFor = (shot, extra) => {
  const base = extra?.trim() || [shot.camera, shot.scene].filter(Boolean).join('，');
  return base.slice(0, 400) || '镜头平稳运动，氛围自然';
};

app.post('/api/shots/:id/video', wrap(async (req, res) => {
  const shot = q.one('SELECT * FROM shot WHERE id = ?', req.params.id);
  if (!shot) return fail(res, '镜头不存在', 404);
  if (!shot.image_url) return fail(res, '该镜头还没有分镜图，先生成图片再图生视频');
  const cfg = 'video';
  const b = req.body || {};
  const model = b.modelId || videoMod.pickModel('video');
  if (!model) return fail(res, '未找到可用的视频模型，请在设置里填写或确认账号权限');

  q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'video', now(), shot.id);
  try {
    const imgPath = path.join(OUTPUT_DIR, path.basename(shot.image_url));
    const dataUrl = `data:image/png;base64,${fs.readFileSync(imgPath).toString('base64')}`;
    const out = await videoMod.callVideo(cfg, {
      model,
      prompt: shotPromptFor(shot, b.prompt),
      image: dataUrl,
      duration: Number(b.duration) || Math.min(10, Math.max(5, Math.round(Number(shot.duration) || 5))),
      ratio: b.ratio,
    });
    q.run('UPDATE shot SET video_url = ?, status = ?, error = NULL, update_time = ? WHERE id = ?', out.url, 'done', now(), shot.id);
    videoMod.recordMedia({
      scriptId: shot.script_id, shotId: shot.id, kind: 'video', filePath: out.url,
      duration: Number(b.duration) || null, prompt: shotPromptFor(shot, b.prompt), model: out.model, meta: { source: out.sourceUrl },
    });
    ok(res, { video_url: out.url, model: out.model, polled: out.polled });
  } catch (e) {
    q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
    throw e;
  }
}));

app.post('/api/scripts/:id/videos', wrap((req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const cfg = 'video';
  const b = req.body || {};
  const model = b.modelId || videoMod.pickModel('video');
  if (!model) return fail(res, '未找到可用的视频模型');
  let shots = shotsOf(script.id).filter((s) => s.image_url);
  if (b.onlyMissing) shots = shots.filter((s) => !s.video_url);
  if (!shots.length) return fail(res, '没有可用于图生视频的镜头（需要先出分镜图）');

  const job = pipeline.startBatch({
    kind: 'shot.video', scopeId: script.id, items: shots.map((s) => ({ id: s.id, label: `镜头 ${s.seq}` })),
    worker: async (item) => {
      const shot = q.one('SELECT * FROM shot WHERE id = ?', item.id);
      q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'video', now(), shot.id);
      try {
        const imgPath = path.join(OUTPUT_DIR, path.basename(shot.image_url));
        const dataUrl = `data:image/png;base64,${fs.readFileSync(imgPath).toString('base64')}`;
        const out = await videoMod.callVideo(cfg, {
          model, prompt: shotPromptFor(shot),
          image: dataUrl,
          duration: Math.min(10, Math.max(5, Math.round(Number(shot.duration) || 5))),
        });
        q.run('UPDATE shot SET video_url = ?, status = ?, error = NULL, update_time = ? WHERE id = ?', out.url, 'done', now(), shot.id);
        videoMod.recordMedia({ scriptId: shot.script_id, shotId: shot.id, kind: 'video', filePath: out.url, prompt: shotPromptFor(shot), model: out.model });
        return { url: out.url };
      } catch (e) {
        q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
        throw e;
      }
    },
  });
  ok(res, { jobId: job.id, total: job.total, model });
}));

/* ---------------- 成片导出 ---------------- */
app.post('/api/scripts/:id/export', wrap((req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const b = req.body || {};
  const usable = shotsOf(script.id).filter((s) => s.video_url || s.image_url);
  if (!usable.length) return fail(res, '没有可用于导出的镜头：至少需要一张分镜图或一个分镜视频');
  const job = pipeline.startBatch({
    kind: 'movie.export', scopeId: script.id, items: [{ id: script.id, label: '成片导出' }],
    worker: async () => exporter.exportMovie({
      scriptId: script.id,
      width: Number(b.width) || 1080, height: Number(b.height) || 1920, fps: Number(b.fps) || 30,
    }),
  });
  ok(res, { jobId: job.id, total: 1, usableShots: usable.length, skipped: shotsOf(script.id).length - usable.length });
}));

app.get('/api/ffmpeg', wrap((req, res) => ok(res, { path: exporter.findFfmpeg() })));

/* ---------------- 媒体库 ---------------- */
app.get('/api/media', wrap((req, res) => ok(res,
  req.query.scriptId
    ? q.all('SELECT * FROM media_asset WHERE script_id = ? ORDER BY create_time DESC', req.query.scriptId)
    : q.all('SELECT * FROM media_asset ORDER BY create_time DESC LIMIT 100'))));

/* ---------------- 错误文件上传（本地图片先落盘，供节点引用） ---------------- */
app.post('/api/upload', wrap((req, res) => {
  const { name, dataUrl } = req.body || {};
  if (!dataUrl?.startsWith('data:')) return fail(res, '无效的图片数据');
  const [meta, b64] = dataUrl.split(',');
  const ext = /jpeg|jpg/.test(meta) ? 'jpg' : /webp/.test(meta) ? 'webp' : 'png';
  const file = `${uid('up')}.${ext}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, file), Buffer.from(b64, 'base64'));
  ok(res, { url: `/outputs/${file}`, name });
}));

/* ---------------- 静态资源 ---------------- */
app.use('/outputs', express.static(OUTPUT_DIR));
const distDir = process.env.WEAVE_DIST_DIR ? path.resolve(process.env.WEAVE_DIST_DIR) : path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

app.get('/api/health', (req, res) => res.json({ success: true, data: { status: 'ok', dataDir: DATA_DIR } }));

export function startServer({ port = PORT, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const actual = server.address().port;
      console.log(`WeaveCanvas server → http://${host}:${actual}`);
      console.log(`数据目录: ${DATA_DIR}`);
      resolve({ server, port: actual, url: `http://${host}:${actual}` });
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && port !== 0) {
        // 端口被占用时自动换一个随机端口
        startServer({ port: 0, host }).then(resolve, reject);
      } else reject(err);
    });
  });
}

export { app, DATA_DIR };

// 直接用 node 运行时自动启动（被 Electron 引入时不自动启动）
const isDirect = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('server', 'index.js'));
if (isDirect) startServer().catch((e) => { console.error('启动失败:', e.message); process.exit(1); });
