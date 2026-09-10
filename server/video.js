import { q, uid, now } from './db.js';

export { callVideo } from './ai.js';

/* ---------------- 模型访问权限缓存 ----------------
   网关在 403 时会返回 "This team can only access models=[...]"，解析后缓存，
   用于过滤模型下拉，避免用户选到无权限的模型。 */
export function rememberAcl(errText) {
  if (!errText || !/can only access models/i.test(errText)) return null;
  const m = errText.match(/models=\[([^\]]+)\]/);
  if (!m) return null;
  const list = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  if (!list.length) return null;
  q.run('INSERT INTO kv (key, value, update_time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, update_time = excluded.update_time',
    'model_acl', JSON.stringify(list), now());
  return list;
}

export function getAcl() {
  const row = q.one("SELECT value FROM kv WHERE key = 'model_acl'");
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function setAcl(list) {
  if (!Array.isArray(list) || !list.length) return null;
  q.run('INSERT INTO kv (key, value, update_time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, update_time = excluded.update_time',
    'model_acl', JSON.stringify(list), now());
  return list;
}

export function modelKind(id) {
  if (/video|wan|kling|seedance|sora|veo/i.test(id)) return 'video';
  if (/image|dall-?e|flux|seedream|midjourney|nano.?banana|stable-?diffusion/i.test(id)) return 'image';
  return 'text';
}

export function pickModel(kind, preferred) {
  if (preferred) return preferred;
  const purpose = kind === 'text' ? 'thinking' : kind === 'image' ? 'image_gen' : 'video';
  const cfg = q.one('SELECT model_id FROM ai_config WHERE purpose = ?', purpose);
  const list = (getAcl() || []).filter((m) => modelKind(m) === kind);
  if (cfg?.model_id && (!list.length || list.includes(cfg.model_id))) return cfg.model_id;
  return list[0] || null;
}

/* ---------------- 媒体登记 ---------------- */
export function recordMedia({ scriptId, shotId, kind, filePath, duration, prompt, model, meta }) {
  q.run('INSERT INTO media_asset (id, script_id, shot_id, kind, file_path, duration, prompt, model, meta_json, create_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
    uid('md'), scriptId || null, shotId || null, kind, filePath, duration || null, prompt || '', model || '', JSON.stringify(meta || {}), now());
}
