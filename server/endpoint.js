import fs from 'node:fs';
import path from 'node:path';
import { OUTPUT_DIR, uid } from './db.js';

/* ============================================================
   统一接口适配层
   - 内置协议（openai / anthropic / gemini / openai-video / agnes-video）编译成 spec
   - 用户自定义接口（custom_api 表）直接就是 spec
   - 统一执行：模板渲染 → 发请求 → 按 response_path 取结果 → 可选轮询 → 落盘
   ============================================================ */

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');
const LOCAL_OUTPUT_REF_RE = /^\/outputs\/([A-Za-z0-9][A-Za-z0-9._-]{0,240})$/;
const IMAGE_REFERENCE_FIELDS = new Set(['image', 'images', 'first_frame', 'last_frame', 'image_url', 'firstFrame', 'lastFrame', 'imageUrl']);
const MAX_REFERENCE_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REFERENCE_PAYLOAD_BYTES = 24 * 1024 * 1024;

function localOutputPath(value) {
  if (typeof value !== 'string') return null;
  if (value.startsWith('/outputs/')) return value;
  try {
    const url = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
    if (loopback && url.pathname.startsWith('/outputs/')) return url.pathname;
  } catch { /* not an absolute URL */ }
  return null;
}

function imageMimeFromBytes(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}

async function encodeLocalImageReference(value, encoding, budget) {
  const localPath = localOutputPath(value);
  if (!localPath) return value;
  const match = localPath.match(LOCAL_OUTPUT_REF_RE);
  if (!match) throw new Error('参考图本地地址无效');
  const outputRoot = await fs.promises.realpath(OUTPUT_DIR);
  const candidate = path.resolve(outputRoot, match[1]);
  if (path.dirname(candidate) !== outputRoot) throw new Error('参考图路径无效');
  let resolved; let stat;
  try {
    resolved = await fs.promises.realpath(candidate);
    stat = await fs.promises.stat(resolved);
  } catch { throw new Error('找不到本地参考图，请重新上传或连接图片节点'); }
  const relative = path.relative(outputRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !stat.isFile()) throw new Error('参考图路径无效');
  if (stat.size > MAX_REFERENCE_IMAGE_BYTES) throw new Error('单张参考图不能超过 12 MB');
  const bytes = await fs.promises.readFile(resolved);
  if (bytes.length > MAX_REFERENCE_IMAGE_BYTES) throw new Error('单张参考图不能超过 12 MB');
  const mime = imageMimeFromBytes(bytes);
  if (!mime) throw new Error('参考图格式无法识别，请使用 PNG、JPEG、WebP 或 GIF');
  budget.bytes += bytes.length;
  if (budget.bytes > MAX_REFERENCE_PAYLOAD_BYTES) throw new Error('参考图总大小不能超过 24 MB');
  const base64 = bytes.toString('base64');
  return encoding === 'base64' ? base64 : `data:${mime};base64,${base64}`;
}

async function encodeLocalImageReferences(value, encoding, budget, field = '') {
  if (Array.isArray(value)) return Promise.all(value.map((item) => encodeLocalImageReferences(item, encoding, budget, field)));
  if (!value || typeof value !== 'object') {
    return IMAGE_REFERENCE_FIELDS.has(field) ? encodeLocalImageReference(value, encoding, budget) : value;
  }
  const entries = await Promise.all(Object.entries(value).map(async ([key, child]) =>
    [key, await encodeLocalImageReferences(child, encoding, budget, key)]));
  return Object.fromEntries(entries);
}

export const PROTOCOLS = [
  { key: 'openai', name: 'OpenAI 兼容（推荐）', hint: '文本 /chat/completions，图像 /images/generations，视频 /video/generations' },
  { key: 'openai-video', name: 'OpenAI 视频协议', hint: '提交 /video/generations，轮询 /videos/{id}' },
  { key: 'agnes-video', name: 'Agnes 视频', hint: '提交 /videos，轮询服务根路径 /agnesapi；支持文本、参考图与首尾帧模式' },
  { key: 'anthropic', name: 'Anthropic Messages', hint: '文本 /messages（Claude 系列）' },
  { key: 'gemini', name: 'Google Gemini', hint: '文本 /models/{model}:generateContent' },
];

/* ---------------- 模板与取值 ---------------- */
export function render(tpl, vars) {
  if (tpl == null) return tpl;
  return String(tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    // 同时兼容 snake_case 与 camelCase 变量名
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    let v = vars[k];
    if (v === undefined) v = vars[camel];
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v);
  });
}

/** 支持 a.b.0.c 形式的路径取值；空串返回原对象 */
export function pick(obj, pathStr) {
  if (!pathStr) return obj;
  const segs = String(pathStr).split('.').filter(Boolean);
  let cur = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[Number(s)];
    else cur = cur[s];
  }
  return cur;
}

const URL_RE = /https?:\/\/[^\s"'<>)]+\.(?:mp4|webm|mov|m3u8|png|jpe?g|webp)(?:\?[^\s"'<>)]*)?/i;

function digAnyUrl(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') return URL_RE.test(obj) ? obj.match(URL_RE)[0] : null;
  if (typeof obj !== 'object') return null;
  for (const k of ['url', 'video_url', 'videoUrl', 'image_url', 'imageUrl', 'b64_json', 'output', 'result', 'data', 'content', 'file_url']) {
    if (k in obj) { const hit = digAnyUrl(obj[k], depth + 1); if (hit) return hit; }
  }
  for (const v of Object.values(obj)) { const hit = digAnyUrl(v, depth + 1); if (hit) return hit; }
  return null;
}

function digAnyB64(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const k of ['b64_json', 'video_base64', 'image_base64', 'base64', 'b64']) {
    if (typeof obj[k] === 'string' && obj[k].length > 200) return obj[k];
  }
  for (const v of Object.values(obj)) { const hit = digAnyB64(v, depth + 1); if (hit) return hit; }
  return null;
}

function digAnyId(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 4) return null;
  for (const k of ['task_id', 'id', 'request_id', 'generation_id', 'job_id', 'video_id', 'prompt_id']) {
    if (typeof obj[k] === 'string' && obj[k].length > 6) return obj[k];
  }
  for (const k of ['data', 'result', 'task', 'output']) { const hit = digAnyId(obj[k], depth + 1); if (hit) return hit; }
  return null;
}

function digText(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  const cands = [
    pick(obj, 'choices.0.message.content'),
    pick(obj, 'content.0.text'),
    pick(obj, 'candidates.0.content.parts.0.text'),
    pick(obj, 'output_text'),
    obj.text,
  ];
  for (const c of cands) if (typeof c === 'string' && c.trim()) return c;
  for (const v of Object.values(obj)) { const hit = digText(v, depth + 1); if (hit) return hit; }
  return null;
}

/* ---------------- 内置协议 → spec ---------------- */
export function builtinSpec({ kind, protocol = 'openai', baseURL, model, vars }) {
  const base = trimSlash(baseURL);
  if (kind === 'video' && protocol === 'agnes-video') {
    // Agnes 的视频结果查询接口位于 host 根路径，不在兼容 API 的 /v1 前缀下。
    const pollOrigin = new URL(base).origin;
    const validModes = ['text', 'reference', 'keyframe'];
    if (!validModes.includes(vars.mode)) {
      throw new Error(`Agnes 视频缺少有效的 mode（支持：${validModes.join(' / ')}）`);
    }
    const hasSeconds = vars.seconds !== undefined && vars.seconds !== null && vars.seconds !== '';
    const secondsValue = Number(vars.seconds);
    const seconds = hasSeconds
      ? String(Number.isFinite(secondsValue) ? Math.min(30, Math.max(4, Math.round(secondsValue))) : 5)
      : undefined;
    const body = { model, prompt: vars.prompt, mode: vars.mode };
    if (seconds !== undefined) body.seconds = seconds;
    if (vars.ratio) body.aspect_ratio = vars.ratio;
    if (vars.mode === 'reference') {
      if (Array.isArray(vars.images) && vars.images.length) body.images = vars.images;
      if (Array.isArray(vars.audios) && vars.audios.length) body.audios = vars.audios;
    } else if (vars.mode === 'keyframe') {
      if (vars.firstFrame) body.first_frame = vars.firstFrame;
      if (vars.lastFrame) body.last_frame = vars.lastFrame;
    }
    return {
      method: 'POST',
      url: `${base}/videos`,
      body,
      referenceImageEncoding: 'base64',
      resultType: 'url',
      idKeys: ['video_id', 'id', 'task_id'],
      poll: {
        url: `${pollOrigin}/agnesapi?video_id={{id}}&model_name=${encodeURIComponent(model || '')}`,
        interval: 1500, max: 240,
        statusPath: 'status',
        doneValues: ['completed', 'succeeded', 'success', 'done'],
        failValues: ['failed', 'error', 'canceled', 'cancelled'],
        resultPath: 'url',
        resultPaths: [
          'url', 'metadata.url', 'metadata.video_url', 'metadata.videoUrl',
          'video_url', 'videoUrl', 'remixed_from_video_id', 'output_url',
          'output.url', 'output.video_url', 'result.url', 'result.video_url',
          'data.url', 'data.video_url', 'data.output.url',
        ],
        resultGracePolls: 5,
      },
    };
  }
  if (kind === 'video' || protocol === 'openai-video') {
    const supportedMode = protocol !== 'openai-video'
      && ['text', 'reference', 'keyframe'].includes(vars.mode);
    const seedanceDuration = /seedance[\s._-]*2[\s._-]*[05]/i.test(String(model || ''))
      ? Number(vars.seconds ?? vars.duration) : null;
    return {
      method: 'POST',
      url: `${base}/video/generations`,
      body: {
        model, prompt: vars.prompt,
        ...(!supportedMode && vars.image ? { image: vars.image } : {}),
        ...(supportedMode ? { mode: vars.mode } : {}),
        ...(supportedMode && seedanceDuration === null && vars.seconds !== undefined && vars.seconds !== null && vars.seconds !== ''
          ? { seconds: String(vars.seconds) } : {}),
        ...(supportedMode && vars.mode === 'reference' && Array.isArray(vars.images) && vars.images.length
          ? { images: vars.images } : {}),
        ...(supportedMode && vars.mode === 'reference' && Array.isArray(vars.audios) && vars.audios.length
          ? { audios: vars.audios } : {}),
        ...(supportedMode && vars.mode === 'keyframe' && vars.firstFrame ? { first_frame: vars.firstFrame } : {}),
        ...(supportedMode && vars.mode === 'keyframe' && vars.lastFrame ? { last_frame: vars.lastFrame } : {}),
        ...(vars.ratio ? { aspect_ratio: vars.ratio } : {}),
        ...(Number.isFinite(seedanceDuration) && seedanceDuration > 0 ? { duration: seedanceDuration } : {}),
        // 本地桥接（comfy-bridge）需要这两个字段翻译成 ComfyUI 宽高/帧数
        ...(vars.duration ? { duration: vars.duration } : {}),
        ...(vars.resolution ? { resolution: vars.resolution } : {}),
      },
      resultType: 'url',
      poll: {
        url: `${base}/videos/{{id}}`,
        // H3 视频在 4090 上要跑 15-20 分钟，10 分钟轮询会超时拿不到结果
        interval: 10000, max: 300,
        statusPath: 'status',
        doneValues: ['completed', 'succeeded', 'success', 'done'],
        failValues: ['failed', 'error', 'canceled', 'cancelled'],
        resultPath: 'url',
        extraUrls: [`${base}/video/generations/{{id}}`],
      },
    };
  }
  if (kind === 'image') {
    const isAgnesImage = protocol === 'agnes-video' || /^agnes-image-/i.test(model || '');
    return {
      method: 'POST',
      url: `${base}/images/generations`,
      body: isAgnesImage
        ? {
            model, prompt: vars.prompt, n: 1,
            ...(vars.size ? { size: vars.size } : {}),
            // Agnes 图片编辑协议将参考图放入 extra_body.image 数组；本地引用在 execute 前编码成 Data URI。
            ...(vars.image ? { extra_body: { image: [vars.image], response_format: 'url' } } : {}),
          }
        : {
            model, prompt: vars.prompt, n: 1,
            // 参考图（@图片N 引用 / 上游连线）：只发标准 image 字段，部分网关会拒绝 image_url
            ...(vars.image ? { image: vars.image } : {}),
            ...(vars.size ? { size: vars.size } : {}),
            response_format: 'b64_json',
          },
      resultType: 'auto',
    };
  }
  // text
  if (protocol === 'anthropic') {
    const messages = [{ role: 'user', content: vars.user }];
    return {
      method: 'POST',
      url: `${base}/messages`,
      headers: { 'anthropic-version': '2023-06-01' },
      body: { model, max_tokens: vars.maxTokens || 4096, messages, ...(vars.system ? { system: vars.system } : {}) },
      resultType: 'text',
      textPath: 'content.0.text',
    };
  }
  if (protocol === 'gemini') {
    return {
      method: 'POST',
      url: `${base}/models/${model}:generateContent`,
      body: {
        contents: [{ parts: [{ text: [vars.system, vars.user].filter(Boolean).join('\n\n') }] }],
        generationConfig: vars.maxTokens ? { maxOutputTokens: vars.maxTokens } : undefined,
      },
      resultType: 'text',
      textPath: 'candidates.0.content.parts.0.text',
    };
  }
  const messages = [];
  if (vars.system) messages.push({ role: 'system', content: vars.system });
  messages.push({ role: 'user', content: vars.user });
  return {
    method: 'POST',
    url: `${base}/chat/completions`,
    body: { model, messages, stream: false, ...(vars.maxTokens ? { max_tokens: vars.maxTokens } : {}) },
    resultType: 'text',
    textPath: 'choices.0.message.content',
  };
}

/** 自定义接口（custom_api 行）→ spec */
export function customSpec(row, vars) {
  const bodyRaw = render(row.body_template || '', vars);
  let body;
  try { body = bodyRaw.trim() ? JSON.parse(bodyRaw) : undefined; } catch { body = bodyRaw || undefined; }
  const poll = row.poll_url_template
    ? {
      url: render(row.poll_url_template, vars),
      interval: Math.max(1000, Number(row.poll_interval) || 5000),
      max: Math.max(1, Number(row.poll_max) || 120),
    }
    : null;
  if (poll) {
    poll.statusPath = row.poll_status_path || 'status';
    poll.doneValues = (row.poll_done_values || 'completed,succeeded,success,done').split(',').map((s) => s.trim()).filter(Boolean);
    poll.failValues = (row.poll_fail_values || 'failed,error,canceled').split(',').map((s) => s.trim()).filter(Boolean);
    poll.resultPath = row.poll_result_path || row.response_path || 'url';
  }
  let headers = {};
  try { headers = JSON.parse(row.headers_json || '{}'); } catch { /* ignore */ }
  return {
    method: row.method || 'POST',
    url: render(row.url_template, vars),
    headers,
    body,
    resultType: row.result_type || 'auto',
    responsePath: row.response_path,
    textPath: row.text_path,
    poll,
    custom: true,
    name: row.name,
  };
}

/* ---------------- 执行 ---------------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, { method = 'POST', headers = {}, body, apiKey, timeout = 600000 }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, json, text };
  } finally { clearTimeout(timer); }
}

export function describeHttpError({ status, json, text }) {
  if (status === 0) return '无法连接到服务器（请检查 Base URL 是否可访问、是否需要代理）';
  let msg = json?.error?.message || json?.message || json?.code || (text || '').slice(0, 300);
  try { if (typeof msg !== 'string') msg = JSON.stringify(msg); } catch { msg = String(msg); }
  if (status === 429) return `上游限流（免费额度用尽或请求过快）：${msg}`;
  if (status === 401 || status === 403) return `鉴权失败（${status}）：${msg}`;
  return `上游返回 ${status}：${msg}`;
}

async function saveBinary(buf, ext) {
  const name = `${uid('med')}.${ext}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, name), buf);
  return `/outputs/${name}`;
}

async function materialize(value, kind) {
  if (!value) return null;
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const [meta, b64] = value.split(',');
      const ext = /png/.test(meta) ? 'png' : /jpe?g/.test(meta) ? 'jpg' : kind === 'video' ? 'mp4' : 'png';
      return saveBinary(Buffer.from(b64, 'base64'), ext);
    }
    // 裸 base64（无 data: 前缀）——常见于 b64_json 直接透传；判断依据：长度大 + 无 URL 特征
    if (/^[A-Za-z0-9+/=]{200,}$/.test(value) && !/^https?:\/\//i.test(value)) {
      const ext = kind === 'video' ? 'mp4' : 'png';
      return saveBinary(Buffer.from(value, 'base64'), ext);
    }
    if (/^https?:\/\//i.test(value)) {
      const res = await fetch(value);
      if (!res.ok) throw new Error(`下载产物失败 HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ct = res.headers.get('content-type') || '';
      const ext = ct.includes('video') || /\.mp4/i.test(value) ? 'mp4'
        : ct.includes('png') ? 'png' : ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'bin';
      return saveBinary(buf, ext);
    }
    return value;
  }
  return null;
}

/**
 * 统一执行一次调用
 * @returns {{kind:'text'|'media', text?:string, url?:string|null, raw:object, polls:number}}
 */
export async function execute({ spec, apiKey, kind, retry429 = true }) {
  const body = kind === 'image' || kind === 'video'
    ? await encodeLocalImageReferences(spec.body, spec.referenceImageEncoding || 'data-uri', { bytes: 0 })
    : spec.body;
  let attempt = 0;
  let res;
  while (true) {
    res = await fetchJson(spec.url, { method: spec.method, headers: spec.headers, body, apiKey });
    if (res.ok) break;
    if (res.status === 429 && retry429 && attempt < 3) {
      await sleep([8000, 20000, 40000][attempt]);
      attempt++;
      continue;
    }
    throw new Error(describeHttpError(res));
  }

  const json = res.json || {};

  if (kind === 'text') {
    const text = (spec.textPath ? pick(json, spec.textPath) : null) || digText(json);
    if (!text) {
      const choice = json?.choices?.[0];
      const reasoning = choice?.message?.reasoning_content;
      const truncated = choice?.finish_reason === 'length';
      if (truncated && !String(choice?.message?.content || '').trim()) {
        throw new Error('模型把 max_tokens 全部用在了推理过程上，正文为空（推理类模型常见）。请把 max_tokens 调到 512 以上后重试');
      }
      if (reasoning && !String(choice?.message?.content || '').trim()) {
        throw new Error('模型只返回了 reasoning_content，没有正文；请提高 max_tokens 或换用非推理模型');
      }
      throw new Error(`未能从响应中取到文本（响应字段：${Object.keys(json).join(',')}）`);
    }
    return { kind: 'text', text, raw: json, polls: 0 };
  }

  // 图像 / 视频
  let value = spec.responsePath ? pick(json, spec.responsePath) : null;
  if (!value) value = digAnyUrl(json) || digAnyB64(json);
  if (!value && spec.resultType === 'b64') value = digAnyB64(json);
  if (value) {
    const url = await materialize(value, kind);
    if (url && !url.startsWith('/outputs/')) return { kind: 'media', url, raw: json, polls: 0, passthrough: url };
    return { kind: 'media', url, raw: json, polls: 0 };
  }

  // 异步任务：轮询
  const id = spec.idKeys ? digFirstKey(json, spec.idKeys) : digAnyId(json);
  if (!spec.poll || !id) {
    throw new Error(`接口未返回可识别的结果（响应字段：${Object.keys(json).join(',')}）`);
  }
  const urls = [spec.poll.url.replace('{{id}}', id), ...(spec.poll.extraUrls || []).map((u) => u.replace('{{id}}', id))];
  const deadline = Date.now() + spec.poll.interval * spec.poll.max;
  let polls = 0;
  let completedWithoutResultPolls = 0;
  while (Date.now() < deadline) {
    await sleep(spec.poll.interval);
    polls++;
    let completedWithoutResult = null;
    for (const u of urls) {
      const st = await fetchJson(u, { method: 'GET', apiKey });
      if (!st.ok || !st.json) continue;
      const status = String(spec.poll.statusPath ? pick(st.json, spec.poll.statusPath) : '').toLowerCase();
      if (spec.poll.failValues.includes(status)) {
        throw new Error(`任务失败：${pick(st.json, 'error.message') || pick(st.json, 'fail_reason') || status || '未知原因'}`);
      }
      const resultPaths = spec.poll.resultPaths?.length
        ? spec.poll.resultPaths
        : (spec.poll.resultPath ? [spec.poll.resultPath] : []);
      const hit = resultPaths.map((resultPath) => pick(st.json, resultPath))
        .find((value) => typeof value === 'string' && value.trim());
      const any = hit || digAnyUrl(st.json) || digAnyB64(st.json);
      if (any) {
        const url = await materialize(any, kind);
        return { kind: 'media', url, raw: st.json, polls, sourceUrl: typeof any === 'string' ? any : undefined };
      }
      if (spec.poll.doneValues.includes(status)) {
        completedWithoutResult = Object.keys(st.json);
      }
    }
    if (completedWithoutResult) {
      completedWithoutResultPolls++;
      const gracePolls = Math.max(1, Number(spec.poll.resultGracePolls) || 1);
      if (completedWithoutResultPolls >= gracePolls) {
        throw new Error(`任务标记为完成，但连续 ${completedWithoutResultPolls} 次查询没有结果地址（响应字段：${completedWithoutResult.join(',')}）`);
      }
    } else {
      completedWithoutResultPolls = 0;
    }
  }
  throw new Error(`任务轮询超时（${polls} 次，任务号 ${id}）`);
}

/* ---------------- 可用性探测 ----------------
   用「故意缺少必填参数」的请求判断模型是否有权限：
   能访问 → 返回 400 prompt is required；无权限 → 403 / 503 model_not_found。不消耗生成额度。 */
export async function probeModel({ kind, baseURL, apiKey, model, protocol = 'openai' }) {
  const base = trimSlash(baseURL);
  const isAgnesVideo = kind === 'video' && protocol === 'agnes-video';
  const url = isAgnesVideo ? `${base}/videos` : kind === 'video' ? `${base}/video/generations`
    : kind === 'image' ? `${base}/images/generations`
      : `${base}/chat/completions`;
  const body = kind === 'text'
    ? { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }
    : isAgnesVideo ? { model, mode: 'text' } : { model };
  try {
    const res = await fetchJson(url, { method: 'POST', body, apiKey });
    const text = (res.text || '').replace(/\s+/g, ' ');
    if (res.status === 429) return { state: 'limited', detail: '限流，稍后再试' };
    if (res.status === 200) return { state: 'ok', detail: '可用' };
    if (res.status === 400 && /prompt is required|messages|required/i.test(text)) return { state: 'ok', detail: '可用' };
    if (/can only access models/i.test(text)) return { state: 'blocked', detail: '账号无此模型权限' };
    if (/model_not_found|No available channel/i.test(text)) return { state: 'blocked', detail: '该模型无可用通道' };
    if (res.status === 401 || res.status === 403) return { state: 'blocked', detail: `鉴权失败（${res.status}）` };
    return { state: 'error', detail: `HTTP ${res.status}：${text.slice(0, 120)}` };
  } catch (e) {
    return { state: 'error', detail: e.message };
  }
}

export function digFirstKey(obj, keys) {
  for (const key of keys || []) {
    const value = pick(obj, key);
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

export { digText, digAnyId };
