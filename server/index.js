import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { db, q, seed, uid, now, ROOT, DATA_DIR, OUTPUT_DIR, ensureDoubaoProvider, findDoubaoProvider, DOUBAO_PROVIDER_NAME } from './db.js';
import { runWorkflow, ProgressEmitter } from './engine.js';
import * as pipeline from './pipeline.js';
import * as videoMod from './video.js';
import * as exporter from './export.js';
import * as ai from './ai.js';
const { callLLM } = ai;
import * as endpointMod from './endpoint.js';
import * as agentsMod from './agents.js';
import * as skillsMod from './skills.js';
import * as doubaoBridge from './doubaoBridge.js';
import { formatVideoModelPrice, readVideoDurationCapability } from '../shared/videoCapabilities.js';
import { normalizeConfigImport } from './configTransfer.js';

const PORT = Number(process.env.PORT || 8787);
const app = express();
app.use(express.json({ limit: '40mb' }));

seed();
// 豆包号池桥接：注册/修复预置供应商（幂等，每次启动都跑，老库也能补上）
// 模型清单以桥接的 config.json 为准，避免两边各硬编码一份
try {
  const dir = doubaoBridge.resolveBridgeDir();
  ensureDoubaoProvider(`${doubaoBridge.bridgeBaseUrl(dir)}/v1`, doubaoBridge.bridgeModels(dir));
} catch (e) {
  console.warn('[doubao] 预置供应商注册失败：', e.message);
}

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, msg, code = 400) => res.status(code).json({ success: false, error: msg });
/* 统一错误出口。注意：必须同时兜住「同步抛出」——fn(req,res) 若在返回 Promise 之前就
   抛异常，Promise.resolve 拿不到它，异常会逃逸到 Express 默认错误页（返回 HTML），
   前端 JSON.parse 失败后只会看到一句「请求失败」，拿不到真正的原因。 */
const wrap = (fn) => (req, res) => {
  const onError = (e) => {
    console.error('[api]', req.method, req.url, e);
    fail(res, e?.message || String(e), e?.status || 500);
  };
    try { return Promise.resolve(fn(req, res)).catch(onError); }
  catch (e) { onError(e); }
};

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

function recoverCanvasVideoTasks(canvasId, canvas, { includeCompleted = false } = {}) {
  const latestStepByNode = new Map();
  for (const row of q.all('SELECT steps_json FROM run_log WHERE canvas_id = ? ORDER BY create_time DESC LIMIT 30', canvasId)) {
    let steps;
    try { steps = JSON.parse(row.steps_json || '[]'); } catch { continue; }
    for (const step of steps) {
      // A newer attempt without a receipt also supersedes old completed results.
      if (step.nodeId && !latestStepByNode.has(step.nodeId)) latestStepByNode.set(step.nodeId, step);
    }
  }
  for (const node of canvas.nodes || []) {
    const step = latestStepByNode.get(node.id);
    const task = step?.upstreamTask;
    if (node.type !== 'videoNode' || !task || (node.data?.status === 'done' && node.data?.videoUrl)) continue;
    if (node.data?.upstreamTask && node.data.upstreamTask.id !== task.id) continue;
    if (task.status === 'accepted') {
      node.data = { ...node.data, upstreamTask: task, generationPhase: task.phase };
    } else if (includeCompleted && task.status === 'completed' && task.localUrl && node.data?.status !== 'draft') {
      const asset = q.one('SELECT prompt FROM asset WHERE canvas_id = ? AND node_id = ? AND file_path = ? ORDER BY create_time DESC LIMIT 1',
        canvasId, node.id, task.localUrl);
      const sameModel = !node.data?.modelId || node.data.modelId === task.model;
      const sameProvider = !node.data?.providerId || node.data.providerId === task.providerId;
      if (asset && asset.prompt === (node.data?.prompt || '') && sameModel && sameProvider) {
        node.data = { ...node.data, upstreamTask: task, generationPhase: 'done', status: 'done', error: null,
          videoUrl: task.localUrl, modelUsed: task.model, lastMs: step.ms };
      }
    }
  }
  return canvas;
}

app.get('/api/canvases', wrap((req, res) => ok(res,
  q.all('SELECT id, project_id, title, node_count, cover_image_url, create_time, update_time FROM canvas ORDER BY update_time DESC'))));

app.get('/api/canvases/:id', wrap((req, res) => {
  const row = q.one('SELECT * FROM canvas WHERE id = ?', req.params.id);
  if (!row) return fail(res, '画布不存在', 404);
  ok(res, { ...row, canvas: recoverCanvasVideoTasks(row.id, JSON.parse(row.canvas_json || emptyCanvas()), { includeCompleted: true }) });
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
// 设置页要能显示尚未填完的配置；真正生成和「测试连接」时才校验可用性。
const configuredSourceName = (cfg) => {
  if (cfg.custom_api_id) return q.one('SELECT name FROM custom_api WHERE id = ?', cfg.custom_api_id)?.name || cfg.purpose;
  if (cfg.provider_id) return q.one('SELECT name FROM provider WHERE id = ?', cfg.provider_id)?.name || cfg.purpose;
  return cfg.purpose;
};

app.get('/api/ai-config', wrap((req, res) => ok(res,
  q.all('SELECT * FROM ai_config').map((c) => ({
    purpose: c.purpose, provider: c.provider, base_url: c.base_url,
    model_id: c.model_id, has_key: !!c.api_key, key_hint: maskKey(c.api_key),
    provider_id: c.provider_id || null, custom_api_id: c.custom_api_id || null,
    provider_name: c.provider_id ? q.one('SELECT name FROM provider WHERE id = ?', c.provider_id)?.name || null : null,
    custom_api_name: c.custom_api_id ? q.one('SELECT name FROM custom_api WHERE id = ?', c.custom_api_id)?.name || null : null,
    effective: configuredSourceName(c),
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
    effective: configuredSourceName(saved),
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

/* ---------------- 配置导入 / 导出（凭据一律不离开本机） ---------------- */
const portableModels = (raw) => {
  let models = [];
  try { models = JSON.parse(raw || '[]'); } catch { return []; }
  if (!Array.isArray(models)) return [];
  return models.slice(0, 1000).map((entry) => {
    const row = typeof entry === 'string' ? { id: entry } : (entry || {});
    const id = String(row.id || row.name || row.model || '').trim().replace(/^default::/i, '');
    if (!id) return null;
    const durationRange = row.durationRange && typeof row.durationRange === 'object'
      ? Object.fromEntries(['min', 'max', 'default', 'minSeconds', 'maxSeconds', 'seconds', 'step']
        .filter((key) => Number.isFinite(Number(row.durationRange[key])))
        .map((key) => [key, Number(row.durationRange[key])]))
      : null;
    return {
      id, name: id,
      ...(row.capability || row.kind || row.type ? { capability: String(row.capability || row.kind || row.type).slice(0, 40) } : {}),
      ...(row.description || row.desc ? { description: String(row.description || row.desc).slice(0, 2000) } : {}),
      ...(durationRange && Object.keys(durationRange).length ? { durationRange } : {}),
      ...(row.price !== undefined && (typeof row.price === 'number' || typeof row.price === 'string') ? { price: row.price } : {}),
    };
  }).filter(Boolean);
};
const portableBaseUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
};

/* ---------------- 管理员（v0.7.9：密码登录后导出/导入可携带 API Key） ---------------- */
const ADMIN_KV = 'admin_password';
const ADMIN_TTL = 8 * 3600 * 1000;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const adminTokens = new Map();
const getAdminHash = () => q.one("SELECT value FROM kv WHERE key = 'admin_password'")?.value || '';

app.get('/api/admin/status', wrap((req, res) => ok(res, { configured: !!getAdminHash() })));

app.post('/api/admin/setup', wrap((req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 4) return fail(res, '管理密码至少 4 位');
  const existing = getAdminHash();
  if (existing && sha256(String(req.body?.oldPassword || '')) !== existing) {
    return fail(res, '已设置过管理密码，请先输入旧密码', 403);
  }
  q.run('INSERT INTO kv (key, value, update_time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, update_time = excluded.update_time',
    ADMIN_KV, sha256(password), now());
  ok(res, { configured: true });
}));

app.post('/api/admin/login', wrap((req, res) => {
  const stored = getAdminHash();
  if (!stored) return fail(res, '尚未设置管理密码', 400);
  if (sha256(String(req.body?.password || '')) !== stored) return fail(res, '管理密码错误', 403);
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_TTL);
  ok(res, { token });
}));

const requireAdmin = (req) => {
  const token = String(req.headers['x-admin-token'] || '');
  const expiry = adminTokens.get(token);
  if (!expiry || expiry < Date.now()) {
    throw Object.assign(new Error('管理员未登录或登录已过期，请重新输入管理密码'), { status: 401 });
  }
};

/* ---------------- 配置导入导出 ---------------- */
app.get('/api/config/export', wrap((req, res) => {
  const withKeys = req.query.withKeys === '1';
  if (withKeys) requireAdmin(req);
  const keyCol = withKeys ? ', api_key' : '';
  const providers = q.all(`SELECT id, name, protocol, base_url, models_json, notes, enabled${keyCol} FROM provider ORDER BY create_time`)
    .map((row) => ({
      id: row.id, name: row.name, protocol: row.protocol, base_url: portableBaseUrl(row.base_url),
      models: portableModels(row.models_json), enabled: row.enabled,
      ...(withKeys ? { api_key: row.api_key || '' } : {}),
    }));
  const aiConfigs = q.all(`SELECT purpose, provider, base_url, model_id, provider_id, custom_api_id, notes${keyCol} FROM ai_config`)
    .map(({ notes, ...row }) => ({
      ...row, base_url: portableBaseUrl(row.base_url),
      provider_name: row.provider_id ? q.one('SELECT name FROM provider WHERE id = ?', row.provider_id)?.name || null : null,
      ...(withKeys ? { api_key: row.api_key || '' } : {}),
    }));
  ok(res, { app: 'weave-canvas', schemaVersion: withKeys ? 2 : 1, exportedAt: now(), withKeys, providers, aiConfigs });
}));

app.post('/api/config/import', wrap((req, res) => {
  const normalized = normalizeConfigImport(req.body);
  const providerIdMap = new Map();
  const imported = [];
  let credentialsImported = 0;
  db.exec('BEGIN');
  try {
    for (const provider of normalized.providers) {
      const existing = q.one('SELECT id FROM provider WHERE name = ? AND base_url = ?', provider.name, provider.base_url);
      const id = existing?.id || uid('pv');
      const modelsJson = JSON.stringify(provider.models || []);
      const apiKey = safeKey(provider.api_key);
      if (existing) {
        // 管理员配置导入时携带 Key 则覆盖；普通导入不带 Key 字段，保留原值
        if (apiKey) {
          q.run('UPDATE provider SET protocol = ?, api_key = ?, models_json = ?, notes = ?, enabled = ?, update_time = ? WHERE id = ?',
            provider.protocol, apiKey, modelsJson, provider.notes || '', provider.enabled === 0 ? 0 : 1, now(), id);
        } else {
          q.run('UPDATE provider SET protocol = ?, models_json = ?, notes = ?, enabled = ?, update_time = ? WHERE id = ?',
            provider.protocol, modelsJson, provider.notes || '', provider.enabled === 0 ? 0 : 1, now(), id);
        }
      } else {
        q.run('INSERT INTO provider (id, name, protocol, base_url, api_key, models_json, notes, enabled, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
          id, provider.name, provider.protocol, provider.base_url, apiKey, modelsJson, provider.notes || '', provider.enabled === 0 ? 0 : 1, now(), now());
      }
      if (provider.source_id) providerIdMap.set(provider.source_id, id);
      imported.push({ id, name: provider.name, models: provider.models?.length || 0 });
    }

    const importedModelProvider = (modelId) => normalized.providers.find((provider) =>
      provider.models?.some((model) => model.id === modelId));
    const configurePurpose = (purpose, provider, modelId) => {
      if (!provider || !modelId) return;
      const id = providerIdMap.get(provider.source_id) || q.one('SELECT id FROM provider WHERE name = ? AND base_url = ?', provider.name, provider.base_url)?.id;
      if (!id) return;
      const cfgKey = safeKey(provider.api_key);
      if (cfgKey) {
        q.run('UPDATE ai_config SET provider = ?, base_url = ?, api_key = ?, model_id = ?, provider_id = ?, custom_api_id = NULL, update_time = ? WHERE purpose = ?',
          provider.name, provider.base_url, cfgKey, modelId, id, now(), purpose);
        credentialsImported++;
      } else {
        q.run('UPDATE ai_config SET provider = ?, base_url = ?, model_id = ?, provider_id = ?, custom_api_id = NULL, update_time = ? WHERE purpose = ?',
          provider.name, provider.base_url, modelId, id, now(), purpose);
      }
    };

    if (normalized.format === 'infinite-canvas') {
      configurePurpose('image_gen', importedModelProvider(normalized.defaults.image) || normalized.providers[0], normalized.defaults.image);
      configurePurpose('video', importedModelProvider(normalized.defaults.video) || normalized.providers[0], normalized.defaults.video);
    } else {
      for (const config of normalized.aiConfigs) {
        const provider = normalized.providers.find((item) => item.source_id === config.provider_id)
          || normalized.providers.find((item) => item.name === config.provider_name)
          || normalized.providers.find((item) => item.base_url === config.base_url);
        if (provider) configurePurpose(config.purpose, provider, config.model_id);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  ok(res, { imported, credentialsImported, customApisImported: false });
}));

/* Key 安全裁剪：仅保留常见 key 字符，长度上限 500 */
const safeKey = (value) => {
  const s = String(value || '').trim().replace(/[\u0000-\u001f\u007f]/g, '');
  return s.slice(0, 500);
};

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

/* ---------------- 工作流执行（SSE 实时进度） ---------------- */
function recordCanvasAssets({ canvasId, scriptId, nodes, patches }) {
  const nodeTypes = new Map(nodes.map((node) => [node.id, node.type]));
  const linkedScriptId = scriptId && q.one('SELECT id FROM script WHERE id = ?', scriptId)
    ? scriptId : null;
  for (const { nodeId, data } of patches) {
    if (data?.status !== 'done') continue;
    const type = nodeTypes.get(nodeId);
    const mediaType = ['videoNode', 'composeNode'].includes(type) ? 'video'
      : ['imageNode', 'gridNode'].includes(type) ? 'image' : null;
    const outputUrl = mediaType === 'video' ? data.videoUrl : data.imageUrl;
    if (!mediaType || !outputUrl) continue;
    q.run(`INSERT INTO asset (id, canvas_id, script_id, node_id, file_path, media_type, prompt, model, create_time)
      VALUES (?,?,?,?,?,?,?,?,?)`,
    uid('as'), canvasId || null, linkedScriptId, nodeId, outputUrl, mediaType,
    nodes.find((node) => node.id === nodeId)?.data?.prompt || '', data.modelUsed || '', now());
  }
}

app.post('/api/run', wrap(async (req, res) => {
  const { canvasId, scriptId, canvas, nodeIds = [], freshNodeIds = [], stream = true } = req.body || {};
  if (!canvas?.nodes) return fail(res, '缺少画布数据');

  // Recover accepted tasks even if the browser closed before its debounced save.
  if (canvasId) recoverCanvasVideoTasks(canvasId, canvas);

  const configs = {};
  for (const c of q.all('SELECT * FROM ai_config')) configs[c.purpose] = c;
  const runId = uid('run');
  q.run('INSERT INTO run_log (id, canvas_id, status, steps_json, error, create_time) VALUES (?,?,?,?,?,?)',
    runId, canvasId || null, 'running', '[]', null, now());
  const acceptedTasks = new Map();
  const onTask = ({ nodeId, upstreamTask }) => {
    acceptedTasks.set(nodeId, { nodeId, kind: 'videoNode', status: 'running', upstreamTask });
    q.run('UPDATE run_log SET steps_json = ? WHERE id = ?', JSON.stringify([...acceptedTasks.values()]), runId);
  };

  console.log('[api/run] stream=', stream, 'nodes=', canvas.nodes.length);

  // 旧 JSON 客户端（不带 stream:true）走兼容路径
  if (!stream) {
    const startedAt = Date.now();
    try {
      const result = await runWorkflow({ nodes: canvas.nodes, edges: canvas.edges || [], targetIds: nodeIds, configs, onTask, freshNodeIds });
      recordCanvasAssets({ canvasId, scriptId, nodes: canvas.nodes, patches: result.patches });
      q.run('UPDATE run_log SET status = ?, steps_json = ?, error = ? WHERE id = ?',
        result.status, JSON.stringify(result.steps), result.error || null, runId);
      ok(res, { ...result, runId, ms: Date.now() - startedAt });
    } catch (e) {
      q.run('UPDATE run_log SET status = ?, error = ? WHERE id = ?', 'failed', e.message, runId);
      return res.status(400).json({ success: false, error: e.message });
    }
    return;
  }

  // SSE 流式
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
  };
  // Generation can remain queued without node events for several minutes.
  // SSE comments keep idle connections alive without changing client progress.
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client gone */ }
  }, 15000);
  res.once('close', () => clearInterval(heartbeat));
  const emitter = new ProgressEmitter();
  emitter.on('node', (p) => send('node', p));
  emitter.on('progress', (p) => send('progress', p));
  emitter.on('error', (p) => send('fatal', p));

  const startedAt = Date.now();
  let result;
  try {
    result = await runWorkflow({
      nodes: canvas.nodes,
      edges: canvas.edges || [],
      targetIds: nodeIds,
      configs,
      emitter,
      onTask,
      freshNodeIds,
    });
    recordCanvasAssets({ canvasId, scriptId, nodes: canvas.nodes, patches: result.patches });
    q.run('UPDATE run_log SET status = ?, steps_json = ?, error = ? WHERE id = ?',
      result.status, JSON.stringify(result.steps), result.error || null, runId);
    send('done', { runId, ms: Date.now() - startedAt, status: result.status, error: result.error,
                   totalNodes: result.totalNodes, stages: result.stages, errors: result.errors });
  } catch (e) {
    q.run('UPDATE run_log SET status = ?, error = ? WHERE id = ?', 'failed', e.message, runId);
    send('fatal', { message: e.message });
  }
  clearInterval(heartbeat);
  try { res.end(); } catch { /* ignore */ }
}));

app.get('/api/runs', wrap((req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 30));
  ok(res, q.all(`SELECT r.id, r.canvas_id, c.title AS canvas_title, r.status, r.error, r.create_time
    FROM run_log r LEFT JOIN canvas c ON c.id = r.canvas_id
    ORDER BY r.create_time DESC LIMIT ?`, limit));
}));

/* ---------------- 生成产物 ---------------- */
app.get('/api/assets', wrap((req, res) => ok(res,
  req.query.canvasId
    ? q.all('SELECT * FROM asset WHERE canvas_id = ? ORDER BY create_time DESC', req.query.canvasId)
    : q.all('SELECT * FROM asset ORDER BY create_time DESC LIMIT 100'))));

/* ---------------- 剧本 ---------------- */
const projId = () => q.one('SELECT id FROM project ORDER BY create_time LIMIT 1')?.id || null;

app.get('/api/scripts', wrap((req, res) => {
  const rows = q.all('SELECT * FROM script ORDER BY update_time DESC');
  ok(res, rows.map((s) => {
    const st = q.one('SELECT COUNT(*) total, SUM(CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END) withImage, SUM(CASE WHEN video_url IS NOT NULL THEN 1 ELSE 0 END) withVideo FROM shot WHERE script_id = ?', s.id);
    const cover = q.one('SELECT image_url FROM shot WHERE script_id = ? AND image_url IS NOT NULL ORDER BY seq LIMIT 1', s.id);
    return { ...s, shot_count: st?.total || 0, image_count: st?.withImage || 0, video_count: st?.withVideo || 0, cover: cover?.image_url || null };
  }));
}));

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
  q.run('INSERT INTO shot (id, script_id, seq, scene, dialogue, camera, duration, character_ids, scene_id, style_id, status, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, req.params.id, b.seq || maxSeq + 1, b.scene || '', b.dialogue || '', b.camera || '',
    Number(b.duration) || 5, JSON.stringify(b.characterIds || []), b.sceneId || null, b.styleId || null, 'idle', now(), now());
  ok(res, q.one('SELECT * FROM shot WHERE id = ?', id));
}));

app.put('/api/shots/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM shot WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '镜头不存在', 404);
  const b = req.body || {};
  q.run(`UPDATE shot SET seq = ?, scene = ?, dialogue = ?, camera = ?, duration = ?, ratio = ?,
         character_ids = ?, scene_id = ?, style_id = ?, image_url = ?, video_url = ?, status = ?, error = ?, update_time = ?
         WHERE id = ?`,
    b.seq ?? cur.seq, b.scene ?? cur.scene, b.dialogue ?? cur.dialogue, b.camera ?? cur.camera,
    b.duration ?? cur.duration,
    b.ratio === undefined ? cur.ratio : b.ratio,
    b.characterIds === undefined ? cur.character_ids : JSON.stringify(b.characterIds),
    b.sceneId === undefined ? cur.scene_id : b.sceneId,
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
  // 场景档案：优先取本剧本场景，兼容旧数据（全局场景）
  const scenes = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL', script.id);
  const style = b.styleId ? q.one('SELECT * FROM style_preset WHERE id = ?', b.styleId) : null;

  const { shots, model, salvaged, truncated } = await pipeline.splitScript({
    script, characters, scenes, style, cfg, count: Number(b.count) || 6, model: b.modelId,
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
    q.run('INSERT INTO shot (id, script_id, seq, scene, dialogue, camera, duration, character_ids, scene_id, style_id, status, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      uid('sh'), script.id, base + s.seq, s.scene, s.dialogue, s.camera, s.duration, s.character_ids,
      s.scene_id || null, b.styleId || script.style_id || null, 'idle', now(), now());
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

// 生产线：从剧本生成完整脚本（调 LLM，返回生成的正文，由前端写回 script.content）
app.post('/api/scripts/:id/generate', wrap(async (req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const b = req.body || {};
  const prompt = (b.prompt || '').trim();
  if (!prompt) return fail(res, '请提供生成提示词');
  const configs = {};
  for (const c of q.all('SELECT * FROM ai_config')) configs[c.purpose] = c;
  const r = await callLLM(configs.thinking, {
    model: b.modelId,
    user: prompt,
    system: pipeline.SCRIPT_SYSTEM,
  });
  ok(res, { text: r.text, model: r.model, usage: r.usage || null });
}));

// 生产线：智能合成最终提示词（对勾选的镜头调 LLM，把剧本+分镜信息重组为完整绘图提示词，写回 shot.prompt_used）
app.post('/api/scripts/:id/compose', wrap(async (req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const b = req.body || {};
  const shotIds = Array.isArray(b.shotIds) ? b.shotIds : [];
  if (!shotIds.length) return fail(res, '请先勾选至少一个镜头');
  const shots = shotIds
    .map((id) => q.one('SELECT * FROM shot WHERE id = ? AND script_id = ?', id, script.id))
    .filter(Boolean);
  if (!shots.length) return fail(res, '所选镜头不存在或不属于该剧本');
  const cfg = needCfg('thinking');
  const style = q.one('SELECT * FROM style_preset WHERE id = ?', script.style_id) || null;
  const characters = q.all('SELECT * FROM character');
  const castByName = Object.fromEntries(characters.map((c) => [c.name, c]));
  const allScenes = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL', script.id);
  const sceneById = Object.fromEntries(allScenes.map((s) => [s.id, s]));

  const system = pipeline.COMPOSE_SYSTEM;

  const composed = [];
  for (const s of shots) {
    const castText = (s.character_ids ? JSON.parse(s.character_ids || '[]') : [])
      .map((n) => castByName[n])
      .filter(Boolean)
      .map((c) => pipeline.charText(c))
      .join('；');
    const sc = s.scene_id ? sceneById[s.scene_id] : null;
    const sceneText = sc
      ? [sc.name, sc.env, sc.lighting && `光影：${sc.lighting}`, sc.atmosphere && `氛围：${sc.atmosphere}`].filter(Boolean).join('，')
      : '';
    const user = pipeline.composeUserMessage({ script, style, shot: s, castText, sceneText });
    const r = await callLLM(cfg, { model: b.modelId, system, user });
    q.run('UPDATE shot SET prompt_used = ?, update_time = ? WHERE id = ?', r.text, now(), s.id);
    composed.push({ id: s.id, prompt: r.text, model: r.model });
  }
  ok(res, { composed: composed.length, model: composed[0]?.model, shots: composed });
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

/* ---------------- 场景档案（资产链第二环） ---------------- */
app.get('/api/scenes', wrap((req, res) => ok(res,
  req.query.scriptId
    ? q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL ORDER BY create_time', req.query.scriptId)
    : q.all('SELECT * FROM scene ORDER BY create_time'))));

app.post('/api/scenes', wrap((req, res) => {
  const b = req.body || {};
  const id = uid('sc');
  q.run('INSERT INTO scene (id, project_id, script_id, name, env, lighting, atmosphere, ref_image_url, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
    id, projId(), b.scriptId || null, b.name || '新场景', b.env || '', b.lighting || '', b.atmosphere || '', b.refImageUrl || null, now(), now());
  ok(res, q.one('SELECT * FROM scene WHERE id = ?', id));
}));

app.put('/api/scenes/:id', wrap((req, res) => {
  const cur = q.one('SELECT * FROM scene WHERE id = ?', req.params.id);
  if (!cur) return fail(res, '场景不存在', 404);
  const b = req.body || {};
  q.run('UPDATE scene SET name = ?, env = ?, lighting = ?, atmosphere = ?, ref_image_url = ?, update_time = ? WHERE id = ?',
    b.name ?? cur.name, b.env ?? cur.env, b.lighting ?? cur.lighting, b.atmosphere ?? cur.atmosphere,
    b.refImageUrl === undefined ? cur.ref_image_url : b.refImageUrl, now(), req.params.id);
  ok(res, q.one('SELECT * FROM scene WHERE id = ?', req.params.id));
}));

app.delete('/api/scenes/:id', wrap((req, res) => {
  q.run('DELETE FROM scene WHERE id = ?', req.params.id);
  // 清理分镜上失效的场景引用
  q.run('UPDATE shot SET scene_id = NULL WHERE scene_id = ?', req.params.id);
  ok(res, { deleted: req.params.id });
}));

// 从剧本 AI 提取场景档案
app.post('/api/scripts/:id/extract-scenes', wrap(async (req, res) => {
  const script = q.one('SELECT * FROM script WHERE id = ?', req.params.id);
  if (!script) return fail(res, '剧本不存在', 404);
  const cfg = needCfg('thinking');
  const { scenes, model } = await pipeline.extractScenes({ script, cfg, model: req.body?.modelId });
  const created = [];
  for (const s of scenes) {
    if (q.one('SELECT id FROM scene WHERE name = ? AND (script_id = ? OR script_id IS NULL)', s.name, script.id)) continue;
    const id = uid('sc');
    q.run('INSERT INTO scene (id, project_id, script_id, name, env, lighting, atmosphere, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?)',
      id, projId(), script.id, s.name, s.env, s.lighting, s.atmosphere, now(), now());
    created.push(id);
  }
  const list = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL ORDER BY create_time', script.id);
  ok(res, { model, created: created.length, skipped: scenes.length - created.length, scenes: list });
}));

// 场景概念图（锁定空间外观）
app.post('/api/scenes/:id/image', wrap(async (req, res) => {
  const scene = q.one('SELECT * FROM scene WHERE id = ?', req.params.id);
  if (!scene) return fail(res, '场景不存在', 404);
  const cfg = needCfg('image_gen');
  const out = await pipeline.generateSceneImage({
    scene, styleId: req.body?.styleId || null, imageCfg: cfg,
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
app.get('/api/jobs', wrap((req, res) => ok(res, pipeline.listJobs({ limit: req.query.limit }))));

/* ---------------- 模型清单（供下拉选择） ----------------
   支持 ?purpose=thinking|image_gen|video 或 ?providerId= / ?customApiId= 指定来源 */
let modelCache = new Map();
app.get('/api/models', wrap(async (req, res) => {
  const purpose = req.query.purpose || 'thinking';
  const selectedProvider = req.query.providerId
    ? q.one('SELECT id, name, protocol, models_json FROM provider WHERE id = ?', req.query.providerId)
    : q.one('SELECT p.id, p.name, p.protocol, p.models_json FROM provider p JOIN ai_config c ON c.provider_id = p.id WHERE c.purpose = ?', purpose);

  let target;
  let resolveError;
  try { target = ai.resolveTarget(purpose, {}, (() => { const o = {}; if (req.query.providerId) o.providerId = req.query.providerId; if (req.query.customApiId) o.customApiId = req.query.customApiId; if (req.query.base_url) o.baseURL = req.query.base_url; if (req.query.api_key) o.apiKey = req.query.api_key; return o; })()); }
  catch (e) { if (!selectedProvider) return ok(res, { list: [], error: e.message }); resolveError = e; }

  const fallbackProvider = selectedProvider || target?.provider || null;
  const localModelsResponse = (error = null) => {
    const records = portableModels(fallbackProvider?.models_json || '[]');
    // 始终把当前配置的模型放进列表，保证节点有可选项
    if (target?.model && !records.some((r) => r.id === target.model)) records.push({ id: target.model, name: target.model });
    const list = records.map((model) => model.id);
    return {
      list,
      groups: {
        text: list.filter((model) => videoMod.modelKind(model) === 'text'),
        image: list.filter((model) => videoMod.modelKind(model) === 'image'),
        video: list.filter((model) => videoMod.modelKind(model) === 'video'),
      },
      defaults: {
        text: purpose === 'thinking' ? list[0] || '' : videoMod.pickModel('text'),
        image: purpose === 'image_gen' ? list.find((model) => videoMod.modelKind(model) === 'image') || list[0] || '' : videoMod.pickModel('image'),
        video: purpose === 'video' ? list.find((model) => videoMod.modelKind(model) === 'video') || list[0] || '' : videoMod.pickModel('video'),
      },
      modelCapabilities: Object.fromEntries(records.map((record) => [record.id, readVideoDurationCapability(record)]).filter(([, capability]) => capability)),
      modelPrices: Object.fromEntries(records.map((record) => [record.id, formatVideoModelPrice(record)]).filter(([, price]) => price)),
      blocked: [], source: fallbackProvider?.name || '', providerId: fallbackProvider?.id || null,
      providerName: fallbackProvider?.name || '', providerProtocol: fallbackProvider?.protocol || null,
      ...(error ? { error } : {}),
    };
  };

  if (!target) return ok(res, localModelsResponse(resolveError.message));

  if (target.custom) {
    const models = q.all('SELECT models_json FROM provider WHERE 1=0');
    return ok(res, { list: [], custom: true, error: null, hint: '当前用途走自定义接口，不需要模型列表', groups: { text: [], image: [], video: [] }, defaults: {}, blocked: [], providerId: null, providerName: target.label, providerProtocol: null });
  }

  const decorate = (list, modelRecords = []) => {
    // 注意：不要用网关 403 里的 models=[...] 做硬过滤——那个列表是按端点/权限组给出的，
    // 与 /video、/images/generations 的实际权限并不一致（实测 agnes-video-2.5 / image-2.5-flash 均可用）。
    const acl = videoMod.getAcl();
    const allowed = list;
    const blocked = acl ? list.filter((m) => !acl.includes(m)) : [];
    const providerVideoDefault = allowed.includes(target.model)
      ? target.model : allowed.find((m) => videoMod.modelKind(m) === 'video');
    const modelCapabilities = Object.fromEntries(modelRecords
      .map((record) => [typeof record === 'string' ? record : (record?.id || record?.name), readVideoDurationCapability(record)])
      .filter(([id, capability]) => id && capability));
    const modelPrices = Object.fromEntries(modelRecords
      .map((record) => [typeof record === 'string' ? record : (record?.id || record?.name), formatVideoModelPrice(record)])
      .filter(([id, price]) => id && price));
    return {
      list: allowed, blocked,
      modelCapabilities,
      modelPrices,
      groups: {
        text: allowed.filter((m) => videoMod.modelKind(m) === 'text'),
        image: allowed.filter((m) => videoMod.modelKind(m) === 'image'),
        video: allowed.filter((m) => videoMod.modelKind(m) === 'video'),
      },
      defaults: {
        text: purpose === 'thinking' ? target.model : videoMod.pickModel('text'),
        image: purpose === 'image_gen' ? target.model : videoMod.pickModel('image'),
        video: purpose === 'video' ? (req.query.providerId ? providerVideoDefault || '' : target.model) : videoMod.pickModel('video'),
      },
      source: target.label,
      providerId: target.provider?.id || null,
      providerName: target.provider?.name || target.label,
      providerProtocol: target.provider?.protocol || target.protocol,
    };
  };

  const cacheKey = JSON.stringify([
    purpose, target.provider?.id || null, target.baseURL, sha256(target.apiKey),
    target.model, target.provider?.models_json || '',
  ]);
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 60000 && cached.list.length) return ok(res, decorate(cached.list, cached.models));

  try {
    const r = await fetch(`${String(target.baseURL).replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${target.apiKey}` } });
    const text = await r.text();
    if (!r.ok) return ok(res, localModelsResponse(`获取模型列表失败（HTTP ${r.status}）`));
    // 网关偶发返回 HTML（WAF/限流页），无法按 JSON 解析时回退本地模型列表
    let j;
    try { j = JSON.parse(text); } catch { return ok(res, localModelsResponse('网关返回了非 JSON 响应（可能被 WAF/限流页拦截），已回退本地模型列表')); }
    const remoteRecords = (j.data || j.models || []).filter((m) => typeof m === 'string' || m?.id || m?.name);
    const localRecords = portableModels(target.provider?.models_json || '');
    const remoteIds = new Set(remoteRecords.map((m) => typeof m === 'string' ? m : (m.id || m.name)));
    const records = [...remoteRecords, ...localRecords.filter((model) => !remoteIds.has(model.id))];
    const list = records.map((m) => typeof m === 'string' ? m : (m.id || m.name));
    modelCache.set(cacheKey, { at: Date.now(), list, models: records });
    ok(res, decorate(list, records));
  } catch (e) {
    ok(res, localModelsResponse(`获取模型列表失败：${e.message}`));
  }
}));

/* ---------------- 模型可用性探测（不消耗生成额度） ---------------- */
const probeCache = new Map();
app.post('/api/models/probe', wrap(async (req, res) => {
  const { models = [], kind = 'text', purpose } = req.body || {};
  let target;
  try {
    target = ai.resolveTarget(purpose || (kind === 'image' ? 'image_gen' : kind === 'video' ? 'video' : 'thinking'), {}, {
      providerId: req.body?.providerId, baseURL: req.body?.base_url, apiKey: req.body?.api_key,
    });
  } catch (e) { return fail(res, e.message); }
  if (target.custom) return ok(res, { results: {}, custom: true });

  const results = {};
  for (const m of models) {
    const key = `${kind}:${target.protocol}:${target.baseURL}:${m}`;
    const hit = probeCache.get(key);
    const ttl = hit?.value?.state === 'limited' ? 30_000 : 10 * 60 * 1000;
    if (hit && Date.now() - hit.at < ttl) { results[m] = hit.value; continue; }
    const value = await endpointMod.probeModel({ kind, baseURL: target.baseURL, apiKey: target.apiKey, model: m, protocol: target.protocol });
    probeCache.set(key, { at: Date.now(), value });
    results[m] = value;
    if (/429/.test(value.detail || '')) await new Promise((r) => setTimeout(r, 1500));
  }
  ok(res, { results });
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
      ratio: b.ratio || shot.ratio || undefined,
      resolution: b.resolution || '1080p',
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
          ratio: shot.ratio || undefined,
          resolution: b.resolution || '1080p',
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

// 画布「视频合成」节点：把多个片段按顺序拼成一条成片
app.post('/api/compose/clips', wrap(async (req, res) => {
  const b = req.body || {};
  const urls = Array.isArray(b.urls) ? b.urls.filter(Boolean) : [];
  if (!urls.length) return fail(res, '没有可合成的片段');
  const out = await exporter.concatClips({
    urls,
    width: Number(b.width) || 1920,
    height: Number(b.height) || 1080,
    fps: Number(b.fps) || 30,
    perImageSeconds: Number(b.perImageSeconds) || 3,
  });
  ok(res, out);
}));

// 画布「批量上传」节点：一次落盘多个文件
app.post('/api/upload/batch', wrap((req, res) => {
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) return fail(res, '没有文件');
  const saved = [];
  const skipped = [];
  for (const f of files) {
    try {
      if (!f?.dataUrl?.startsWith('data:')) { skipped.push(f?.name || '?'); continue; }
      const [meta, b64] = f.dataUrl.split(',');
      const ext = /jpeg|jpg/.test(meta) ? 'jpg' : /webp/.test(meta) ? 'webp'
        : /video|mp4/.test(meta) ? 'mp4' : /quicktime|mov/.test(meta) ? 'mov'
        : /webm/.test(meta) ? 'webm' : 'png';
      const name = `${uid('med')}.${ext}`;
      fs.writeFileSync(path.join(OUTPUT_DIR, name), Buffer.from(b64, 'base64'));
      const kind = /video|mp4|mov|webm/.test(String(f.type || '') + ext) ? 'video' : 'image';
      saved.push({ url: `/outputs/${name}`, name: f.name, kind });
    } catch { skipped.push(f?.name || '?'); }
  }
  ok(res, { saved, skipped });
}));

/* ---------------- 媒体库 ---------------- */
app.get('/api/media', wrap((req, res) => {
  const scriptId = req.query.scriptId || null;
  const projectMedia = scriptId
    ? q.all('SELECT * FROM media_asset WHERE script_id = ? ORDER BY create_time DESC', scriptId)
    : q.all('SELECT * FROM media_asset ORDER BY create_time DESC LIMIT 100');
  const canvasVideos = scriptId
    ? q.all(`SELECT id, script_id, NULL AS shot_id, media_type AS kind, file_path,
        NULL AS duration, prompt, model, NULL AS meta_json, create_time
        FROM asset WHERE media_type = 'video' AND script_id = ? ORDER BY create_time DESC`, scriptId)
    : q.all(`SELECT id, script_id, NULL AS shot_id, media_type AS kind, file_path,
        NULL AS duration, prompt, model, NULL AS meta_json, create_time
        FROM asset WHERE media_type = 'video' ORDER BY create_time DESC LIMIT 100`);
  const combined = [...projectMedia, ...canvasVideos]
    .sort((a, b) => String(b.create_time).localeCompare(String(a.create_time)));
  ok(res, scriptId ? combined : combined.slice(0, 100));
}));

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

/* ---------------- Agent 应用（v0.6） ----------------
   名册（agent）+ 运行（agent_run / agent_step / SSE 事件流） */
app.get('/api/agents', wrap((req, res) => ok(res, agentsMod.listAgents())));

// 工具清单（供前端渲染权限勾选）—— 必须放在 /:id 之前
app.get('/api/agents/tools', wrap((req, res) => ok(res, agentsMod.toolList())));

app.post('/api/agents', wrap((req, res) => ok(res, agentsMod.upsertAgent(req.body || {}))));
app.put('/api/agents/:id', wrap((req, res) => ok(res, agentsMod.upsertAgent(req.body || {}, req.params.id))));
app.delete('/api/agents/:id', wrap((req, res) => ok(res, agentsMod.deleteAgent(req.params.id))));

app.get('/api/agent-runs', wrap((req, res) => ok(res, agentsMod.listRuns({ scriptId: req.query.scriptId, limit: req.query.limit }))));

app.post('/api/agent-runs', wrap((req, res) => {
  const b = req.body || {};
  ok(res, agentsMod.startRun({ agentId: b.agentId, scriptId: b.scriptId, goal: b.goal, skillId: b.skillId }));
}));

/* ---------------- Skill 应用（v0.7） ----------------
   一套可复用的创作套路：风格 + 参数 + 步骤 recipe + 提示词增强 */
app.get('/api/skills', wrap((req, res) => ok(res, skillsMod.listSkills({
  category: req.query.category, kind: req.query.kind, q: req.query.q,
}))));
app.get('/api/skills/meta', wrap((req, res) => ok(res, skillsMod.skillCategories())));
app.get('/api/skills/:id', wrap((req, res) => {
  const s = skillsMod.getSkill(req.params.id) || skillsMod.getSkillByCommand(req.params.id);
  if (!s) return fail(res, 'Skill 不存在', 404);
  ok(res, s);
}));
app.post('/api/skills', wrap((req, res) => ok(res, skillsMod.upsertSkill(req.body || {}))));
app.put('/api/skills/:id', wrap((req, res) => ok(res, skillsMod.upsertSkill(req.body || {}, req.params.id))));
app.delete('/api/skills/:id', wrap((req, res) => ok(res, skillsMod.deleteSkill(req.params.id))));
/** 套用预览：按当前剧本渲染出目标文案与参数，不产生任何花费 */
app.post('/api/skills/:id/apply', wrap((req, res) => {
  const skill = skillsMod.getSkill(req.params.id) || skillsMod.getSkillByCommand(req.params.id);
  if (!skill) return fail(res, 'Skill 不存在', 404);
  const script = req.body?.scriptId ? q.one('SELECT * FROM script WHERE id = ?', req.body.scriptId) : null;
  ok(res, skillsMod.renderSkill(skill, { script, shots: req.body?.shots }));
}));

app.get('/api/agent-runs/:id', wrap((req, res) => {
  const detail = agentsMod.runDetail(req.params.id);
  if (!detail) return fail(res, '运行记录不存在', 404);
  ok(res, detail);
}));

// 实时事件流：先补发一次快照，再接收增量事件
app.get('/api/agent-runs/:id/stream', (req, res) => {
  const detail = agentsMod.runDetail(req.params.id);
  if (!detail) return res.status(404).json({ success: false, error: '运行记录不存在' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify(detail)}\n\n`);
  const unsubscribe = agentsMod.subscribe(req.params.id, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 25000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
});

app.post('/api/agent-runs/:id/resume', wrap((req, res) => {
  const b = req.body || {};
  ok(res, agentsMod.resumeRun(req.params.id, { approved: !!b.approved, note: b.note || '' }));
}));
app.post('/api/agent-runs/:id/stop', wrap((req, res) => ok(res, agentsMod.stopRun(req.params.id))));
app.post('/api/agent-runs/:id/retry', wrap((req, res) => {
  const b = req.body || {};
  ok(res, agentsMod.retryFrom(req.params.id, b.fromSeq));
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

/* ---------------- 豆包号池桥接（doubao-bridge） ----------------
   桥接是独立进程，这里只做生命周期管理 + HTTP 代理，不侵入主逻辑。 */
app.get('/api/doubao/status', wrap(async (req, res) => {
  const st = await doubaoBridge.status();
  const pv = findDoubaoProvider();
  ok(res, {
    ...st,
    models: doubaoBridge.bridgeModelDetails(st.dir),
    provider: pv ? {
      id: pv.id, name: pv.name, protocol: pv.protocol,
      baseUrl: pv.base_url, hasKey: !!String(pv.api_key || '').trim(), enabled: !!pv.enabled,
    } : null,
    providerName: DOUBAO_PROVIDER_NAME,
    expectedBaseUrl: `${doubaoBridge.bridgeBaseUrl(st.dir)}/v1`,
  });
}));

const bridgeActionResult = (res, result) => result.ok
  ? ok(res, result)
  : fail(res, result.error || '桥接操作失败', 409);
app.post('/api/doubao/start', wrap(async (req, res) => bridgeActionResult(res, await doubaoBridge.start())));
app.post('/api/doubao/stop', wrap(async (req, res) => bridgeActionResult(res, await doubaoBridge.stop())));
app.post('/api/doubao/restart', wrap(async (req, res) => bridgeActionResult(res, await doubaoBridge.restart())));
app.get('/api/doubao/logs', wrap((req, res) => ok(res, doubaoBridge.recentLogs())));

app.put('/api/doubao/settings', wrap((req, res) => {
  const b = req.body || {};
  if (b.dir !== undefined) doubaoBridge.setBridgeDir(b.dir);
  if (b.auto !== undefined) doubaoBridge.setAutoStart(b.auto);
  const dir = doubaoBridge.resolveBridgeDir();
  // 桥接地址/模型清单可能变了 → 同步修回预置供应商
  ensureDoubaoProvider(`${doubaoBridge.bridgeBaseUrl(dir)}/v1`, doubaoBridge.bridgeModels(dir));
  ok(res, { dir, auto: doubaoBridge.getAutoStart(), baseUrl: `${doubaoBridge.bridgeBaseUrl(dir)}/v1` });
}));

/* 账号池：纯代理，前端不直连桥接端口（避免 CORS 与端口暴露） */
app.get('/api/doubao/accounts', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch('/v1/accounts', {}, 15000))));

app.post('/api/doubao/accounts', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch('/v1/accounts', { method: 'POST', body: JSON.stringify(req.body || {}) }, 25000))));

app.put('/api/doubao/accounts/:id', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch(`/v1/accounts/${req.params.id}`, { method: 'PUT', body: JSON.stringify(req.body || {}) }, 25000))));

app.delete('/api/doubao/accounts/:id', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch(`/v1/accounts/${req.params.id}`, { method: 'DELETE' }, 25000))));

// probe 会真的启动该账号的浏览器，给足超时
for (const action of ['probe', 'cooldown', 'recover']) {
  app.post(`/api/doubao/accounts/:id/${action}`, wrap(async (req, res) =>
    ok(res, await doubaoBridge.bridgeFetch(
      `/v1/accounts/${req.params.id}/${action}`,
      { method: 'POST', body: JSON.stringify(req.body || {}) },
      action === 'probe' ? 300000 : 25000,
    ))));
}

app.get('/api/doubao/tasks', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch('/v1/tasks', {}, 15000))));

app.post('/api/doubao/pool/reset', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch('/v1/pool/reset', { method: 'POST' }, 25000))));

/* 手动切换账号：锁定到某个账号（不再自动轮询）/ 解除锁定 */
app.post('/api/doubao/accounts/:id/pin', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch('/v1/pool/pin',
    { method: 'POST', body: JSON.stringify({ accountId: req.params.id }) }, 25000))));

app.delete('/api/doubao/pool/pin', wrap(async (req, res) =>
  ok(res, await doubaoBridge.bridgeFetch('/v1/pool/pin', { method: 'POST', body: '{}' }, 25000))));

/* 让「豆包（网页版号池）」直接作为视频用途的来源（一键把 video 用途切到它） */
app.post('/api/doubao/use-for-video', wrap((req, res) => {
  const pv = findDoubaoProvider();
  if (!pv) return fail(res, '预置供应商尚未注册，请先启动一次桥接');
  // 默认用桥接声明的便宜模型；Seedance 2.5 是 5 倍消耗，不做默认
  const model = String(req.body?.model || doubaoBridge.bridgeDefaultModel() || 'doubao-seedance-2-0-fast');
  q.run(`UPDATE ai_config SET provider_id = ?, custom_api_id = NULL, base_url = ?, api_key = ?, model_id = ?, update_time = ? WHERE purpose = 'video'`,
    pv.id, pv.base_url, 'local', model, now());
  ok(res, { providerId: pv.id, providerName: pv.name, model, protocol: pv.protocol });
}));

export function startServer({ port = PORT, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const actual = server.address().port;
      console.log(`WeaveCanvas server → http://${host}:${actual}`);
      console.log(`数据目录: ${DATA_DIR}`);
      // 豆包号池桥接：开机自启（异步，不阻塞主流程；失败只记日志不影响软件可用）
      doubaoBridge.autoStart()
        .then((r) => {
          if (r?.ok && !r.already) console.log(`豆包号池桥接已启动 → ${r.baseUrl}`);
          else if (r?.skipped) console.log(`豆包号池桥接未自启：${r.skipped}`);
          else if (r?.error) console.warn(`豆包号池桥接自启失败：${r.error}`);
        })
        .catch((e) => console.warn('[doubao] 桥接自启异常：', e.message));
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

export { app, DATA_DIR, doubaoBridge };

// 直接用 node 运行时自动启动（被 Electron 引入时不自动启动）
const isDirect = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('server', 'index.js'));
if (isDirect) {
  startServer().catch((e) => { console.error('启动失败:', e.message); process.exit(1); });
  // 退出时收掉桥接进程（账号浏览器实例不受影响，下次直接复用）
  const bye = () => {
    try { doubaoBridge.stop(); } catch { /* ignore */ }
    // 给「请求孤儿桥接自我关闭」留一点时间再退出
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}
