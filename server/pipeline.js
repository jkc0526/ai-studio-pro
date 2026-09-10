import { callLLM, callImage } from './ai.js';
import { q, uid, now } from './db.js';

/* ---------------- 通用：让模型吐 JSON ---------------- */
export function parseJsonLoose(text) {
  if (!text) throw new Error('模型未返回内容');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[[{]/);
  if (start >= 0) {
    for (let end = raw.length; end > start; end--) {
      const slice = raw.slice(start, end);
      try { return JSON.parse(slice); } catch { /* 继续缩短 */ }
    }
  }
  throw new Error('JSON 解析失败');
}

/** 逐字符扫描出所有完整 JSON 对象，用于挽救被 max_tokens 截断的输出 */
export function extractObjects(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{', i);
    if (start < 0) break;
    let depth = 0; let inStr = false; let esc = false; let end = -1;
    for (let j = start; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) break;
    try {
      const o = JSON.parse(text.slice(start, end + 1));
      if (o && typeof o === 'object') out.push(o);
    } catch { /* 跳过解析失败的对象 */ }
    i = end + 1;
  }
  return out;
}

async function askJson(cfg, { system, user, model, maxTokens = 4096 }) {
  const r = await callLLM(cfg, { model, system, user, maxTokens });
  let data = null;
  try { data = parseJsonLoose(r.text); } catch { /* 交给调用方挽救 */ }
  return { data, raw: r.text, model: r.model, usage: r.usage, finishReason: r.finishReason };
}

const asArray = (v) => (Array.isArray(v) ? v : []);

/* ---------------- 提示词拼装（一致性核心） ---------------- */
export function charText(c) {
  const bits = [`【${c.name}】`];
  if (c.appearance) bits.push(c.appearance);
  if (c.outfit) bits.push(`服装：${c.outfit}`);
  return bits.join('，');
}

export function composeShotPrompt({ shot, characters = [], style, extra = '' }) {
  const clean = (s) => String(s || '').trim().replace(/[，。；、,;.\s]+$/, '');
  const parts = [];
  if (style?.prompt_prefix) parts.push(clean(style.prompt_prefix));
  if (shot?.scene) parts.push(clean(shot.scene));
  const cast = characters.filter((c) => c && c.appearance);
  if (cast.length) parts.push(`角色形象保持一致：${cast.map(charText).join('；')}`);
  if (shot?.camera) parts.push(clean(shot.camera));
  if (extra) parts.push(clean(extra));
  parts.push('画面高清，构图完整，无文字水印');
  return parts.filter(Boolean).join('，');
}

/* ---------------- 一：剧本 → 分镜表 ---------------- */
const SPLIT_SYSTEM = `你是资深 AI 漫剧分镜师。把用户给的剧本拆解成可直接用于 AI 绘图与视频生成的分镜表。
严格要求：
1. 只输出 JSON，不要任何解释文字或 markdown 代码块外的内容。
2. JSON 结构：{"shots":[{"scene":"","dialogue":"","camera":"","duration":5,"characters":["角色名"]}]}
3. scene 为中文画面描述，包含人物动作、表情、环境、光影，40-90 字，必须能被 AI 直接画出来；不要出现"同上""继续"等指代。
4. dialogue 为该镜头台词或旁白，没有就留空字符串。
5. camera 为镜头语言，如"中景，略微俯视，缓慢推近"。
6. duration 为镜头时长秒数，3-8 之间。
7. characters 只填该镜头出镜的角色名，必须从用户提供的角色清单中选，没有出镜就留空数组。
8. 镜头之间要有景别与角度变化，避免全部同一构图。`;

export async function splitScript({ script, characters, style, cfg, count = 6, model }) {
  const castList = characters.length
    ? characters.map((c) => `${c.name}${c.appearance ? `（${c.appearance}${c.outfit ? `，${c.outfit}` : ''}）` : ''}`).join('\n')
    : '（暂无角色档案）';
  const user = [
    `【剧本标题】${script.title || '未命名'}`,
    script.outline ? `【故事梗概】${script.outline}` : '',
    `【可用角色】\n${castList}`,
    style?.prompt_prefix ? `【画面风格】${style.prompt_prefix}` : '',
    `【剧本正文】\n${script.content || ''}`,
    `请拆成 ${count} 个镜头，输出 JSON。`,
  ].filter(Boolean).join('\n\n');

  const { data, raw, model: used, finishReason } = await askJson(cfg, { system: SPLIT_SYSTEM, user, model });

  // 严格解析失败时，从未闭合的输出里挽救出完整镜头对象
  let shots = data ? asArray(data.shots || data) : [];
  let salvaged = false;
  if (!shots.length) {
    shots = extractObjects(raw).flatMap((o) => (Array.isArray(o.shots) ? o.shots : o.scene ? [o] : []));
    salvaged = shots.length > 0;
  }
  if (!shots.length) {
    throw new Error(`模型未返回可解析的镜头${finishReason === 'length' ? '（输出被长度限制截断，可减少镜头数或换个模型）' : ''}：${raw.slice(0, 200)}…`);
  }

  const nameToId = new Map(characters.map((c) => [c.name, c.id]));
  const rows = shots.map((s, i) => {
    const ids = asArray(s.characters).map((n) => nameToId.get(String(n).trim())).filter(Boolean);
    return {
      scene: String(s.scene || '').trim(),
      dialogue: String(s.dialogue || '').trim(),
      camera: String(s.camera || '').trim(),
      duration: Number(s.duration) > 0 ? Number(s.duration) : 5,
      character_ids: JSON.stringify(ids),
      seq: i + 1,
    };
  }).filter((s) => s.scene);
  if (!rows.length) throw new Error('模型返回的镜头缺少画面描述');
  return { shots: rows, model: used, salvaged, truncated: finishReason === 'length' };
}

/* ---------------- 二：剧本 → 角色档案 ---------------- */
const CHAR_SYSTEM = `你是漫剧角色设计师。从剧本中提取主要角色，为每个角色写一份可复用的"形象锁定档案"，用于让 AI 在每一镜中画出同一个人。
要求：
1. 只输出 JSON：{"characters":[{"name":"","role":"","appearance":"","outfit":"","personality":""}]}
2. appearance 为外形锁定描述，必须包含：性别年龄、发型发色、脸型五官特征、身高体型、显著识别特征（疤痕/耳饰/瞳色等），60-120 字，用固定的具体形容词，便于每镜复用。
3. outfit 为常驻服装描述，40-80 字，颜色与材质要具体。
4. role 为主角/女主/反派/配角等定位。
5. 最多 6 个角色，只提取对剧情重要的。`;

export async function extractCharacters({ script, cfg, model }) {
  const user = `【剧本标题】${script.title || ''}\n【梗概】${script.outline || ''}\n【正文】\n${script.content || ''}\n\n请提取角色档案，输出 JSON。`;
  const { data, raw, model: used } = await askJson(cfg, { system: CHAR_SYSTEM, user, model });
  let list = data ? asArray(data.characters || data) : [];
  if (!list.length) list = extractObjects(raw).flatMap((o) => (Array.isArray(o.characters) ? o.characters : o.name ? [o] : []));
  const cleaned = list.map((c) => ({
    name: String(c.name || '').trim(),
    role: String(c.role || '').trim(),
    appearance: String(c.appearance || '').trim(),
    outfit: String(c.outfit || '').trim(),
    personality: String(c.personality || '').trim(),
  })).filter((c) => c.name);
  if (!cleaned.length) throw new Error(`未能从剧本中识别出角色：${raw.slice(0, 200)}…`);
  return { characters: cleaned, model: used };
}

/* ---------------- 三：生图 ---------------- */
const pickStyle = (styleId) => (styleId ? q.one('SELECT * FROM style_preset WHERE id = ?', styleId) : null);

function charListFor(shot, projectId) {
  const ids = JSON.parse(shot.character_ids || '[]');
  if (!ids.length) return [];
  return ids.map((id) => q.one('SELECT * FROM character WHERE id = ?', id)).filter(Boolean);
}

export async function generateShotImage({ shot, styleId, imageCfg, extra = '', size = '1024x1536', model }) {
  const style = pickStyle(styleId ?? shot.style_id);
  const cast = charListFor(shot);
  const prompt = composeShotPrompt({ shot, characters: cast, style, extra });
  const r = await callImage(imageCfg, { model, prompt, size });
  q.run('UPDATE shot SET image_url = ?, prompt_used = ?, model_used = ?, status = ?, error = NULL, update_time = ? WHERE id = ?',
    r.url, prompt, r.model, 'done', now(), shot.id);
  q.run('INSERT INTO asset (id, canvas_id, node_id, file_path, media_type, prompt, model, create_time) VALUES (?,?,?,?,?,?,?,?)',
    uid('as'), shot.script_id, shot.id, r.url, 'image', prompt, r.model, now());
  return { image_url: r.url, prompt, model: r.model };
}

export async function generateCharacterSheet({ character, styleId, imageCfg, model, size = '1536x1024' }) {
  const style = pickStyle(styleId);
  const prompt = composeShotPrompt({
    shot: {
      scene: `角色三视图设定稿：同一角色的正面、侧面、背面三视图并排排列，白色纯净背景，全身站姿，比例准确`,
      camera: '正交平视视角，无透视变形，影棚均匀布光',
    },
    characters: [character],
    style,
  });
  const r = await callImage(imageCfg, { model, prompt, size });
  q.run('UPDATE character SET sheet_image_url = ?, update_time = ? WHERE id = ?', r.url, now(), character.id);
  return { sheet_image_url: r.url, prompt, model: r.model };
}

/* ---------------- 四：批量任务（带进度） ---------------- */
const jobs = new Map();

export function getJob(id) {
  const mem = jobs.get(id);
  if (mem) return mem;
  const row = q.one('SELECT * FROM job WHERE id = ?', id);
  return row ? { ...row, log: JSON.parse(row.log_json || '[]') } : null;
}

export function listJobs() {
  return q.all('SELECT * FROM job ORDER BY create_time DESC LIMIT 20')
    .map((r) => ({ ...r, log: JSON.parse(r.log_json || '[]') }));
}

const MAX_PARALLEL = 2;

export function startBatch({ kind, scopeId, items, worker }) {
  const id = uid('job');
  const job = { id, kind, scopeId, status: 'running', total: items.length, done: 0, failed: 0, log: [], error: null };
  jobs.set(id, job);
  q.run('INSERT INTO job (id, kind, scope_id, status, total, done, failed, log_json, create_time, update_time) VALUES (?,?,?,?,?,0,0,?,?,?)',
    id, kind, scopeId || null, 'running', items.length, '[]', now(), now());

  const persist = () => q.run('UPDATE job SET status = ?, done = ?, failed = ?, log_json = ?, update_time = ? WHERE id = ?',
    job.status, job.done, job.failed, JSON.stringify(job.log.slice(-200)), now(), id);

  (async () => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          const res = await worker(item);
          job.done++;
          job.log.push({ ok: true, item: item.label ?? item.id, result: res ?? null, at: now() });
        } catch (e) {
          job.failed++;
          job.log.push({ ok: false, item: item.label ?? item.id, error: e?.message || String(e), at: now() });
        }
        persist();
      }
    });
    await Promise.all(runners);
    job.status = job.failed === job.total ? 'failed' : 'done';
    persist();
  })().catch((e) => { job.status = 'failed'; job.error = e.message; persist(); });

  return job;
}
