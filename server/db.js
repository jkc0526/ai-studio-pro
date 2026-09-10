import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// 打包成桌面应用时，数据目录由 WEAVE_DATA_DIR 指定（放在 exe 同级或用户目录）
export const DATA_DIR = process.env.WEAVE_DATA_DIR
  ? path.resolve(process.env.WEAVE_DATA_DIR)
  : path.join(ROOT, 'data');
export const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'weave.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, is_default INTEGER DEFAULT 0,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS canvas (
  id TEXT PRIMARY KEY, project_id TEXT, title TEXT,
  canvas_json TEXT, node_count INTEGER DEFAULT 0, cover_image_url TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS ai_config (
  id TEXT PRIMARY KEY, purpose TEXT UNIQUE, provider TEXT,
  base_url TEXT, api_key TEXT, model_id TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS snippet (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS run_log (
  id TEXT PRIMARY KEY, canvas_id TEXT, status TEXT,
  steps_json TEXT, error TEXT, create_time TEXT
);
CREATE TABLE IF NOT EXISTS asset (
  id TEXT PRIMARY KEY, canvas_id TEXT, node_id TEXT, file_path TEXT,
  media_type TEXT, prompt TEXT, model TEXT, create_time TEXT
);
CREATE TABLE IF NOT EXISTS script (
  id TEXT PRIMARY KEY, project_id TEXT, title TEXT, outline TEXT, content TEXT,
  style_id TEXT, sort_order INTEGER DEFAULT 0, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS shot (
  id TEXT PRIMARY KEY, script_id TEXT, seq INTEGER, scene TEXT, dialogue TEXT,
  camera TEXT, duration REAL, character_ids TEXT, style_id TEXT,
  image_url TEXT, video_url TEXT,
  status TEXT, prompt_used TEXT, model_used TEXT, error TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS character (
  id TEXT PRIMARY KEY, project_id TEXT, name TEXT, role TEXT, appearance TEXT,
  outfit TEXT, personality TEXT, ref_image_url TEXT, sheet_image_url TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS style_preset (
  id TEXT PRIMARY KEY, name TEXT, prompt_prefix TEXT, negative_prompt TEXT,
  builtin INTEGER DEFAULT 0, create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS job (
  id TEXT PRIMARY KEY, kind TEXT, scope_id TEXT, status TEXT, total INTEGER,
  done INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, log_json TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS shot_variant (
  id TEXT PRIMARY KEY, shot_id TEXT, image_url TEXT, prompt TEXT, model TEXT,
  selected INTEGER DEFAULT 0, create_time TEXT
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY, value TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS media_asset (
  id TEXT PRIMARY KEY, script_id TEXT, shot_id TEXT, kind TEXT, file_path TEXT,
  duration REAL, prompt TEXT, model TEXT, meta_json TEXT, create_time TEXT
);
CREATE TABLE IF NOT EXISTS provider (
  id TEXT PRIMARY KEY, name TEXT, protocol TEXT, base_url TEXT, api_key TEXT,
  models_json TEXT, notes TEXT, enabled INTEGER DEFAULT 1,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS custom_api (
  id TEXT PRIMARY KEY, name TEXT, kind TEXT, method TEXT,
  url_template TEXT, headers_json TEXT, body_template TEXT,
  response_path TEXT, result_type TEXT, text_path TEXT,
  poll_url_template TEXT, poll_interval INTEGER, poll_max INTEGER,
  poll_status_path TEXT, poll_done_values TEXT, poll_fail_values TEXT, poll_result_path TEXT,
  notes TEXT, create_time TEXT, update_time TEXT
);
`);

export const now = () => new Date().toISOString();
export const uid = (p = 'id') =>
  `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const one = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

/* ---------------- 轻量迁移：给已存在的表补列 ---------------- */
function ensureColumn(table, column, ddl) {
  const cols = all(`PRAGMA table_info(${table})`).map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

ensureColumn('ai_config', 'provider_id', 'provider_id TEXT');
ensureColumn('ai_config', 'custom_api_id', 'custom_api_id TEXT');
ensureColumn('ai_config', 'notes', 'notes TEXT');

// 常见的第三方 / 自建网关预设（不含密钥，粘贴 Key 即可用）
const PROVIDER_PRESETS = [
  ['OpenAI 官方', 'openai', 'https://api.openai.com/v1', 'GPT-4o / gpt-image-1 / Sora，需要海外网络'],
  ['Anthropic Claude', 'anthropic', 'https://api.anthropic.com/v1', 'Claude 系列，走 /messages 协议'],
  ['Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta', 'Gemini 系列，走 generateContent 协议'],
  ['硅基流动 SiliconFlow', 'openai', 'https://api.siliconflow.cn/v1', '国产聚合，含可灵/通义等图像视频模型'],
  ['阿里云百炼', 'openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1', '通义千问 / 万相（兼容模式）'],
  ['火山方舟', 'openai', 'https://ark.cn-beijing.volces.com/api/v3', '豆包 / 即梦 Seedream、Seedance'],
  ['DeepSeek', 'openai', 'https://api.deepseek.com/v1', '文本模型性价比高'],
  ['月之暗面 Kimi', 'openai', 'https://api.moonshot.cn/v1', '长上下文文本'],
  ['智谱 GLM', 'openai', 'https://open.bigmodel.cn/api/paas/v4', 'GLM / CogVideoX'],
  ['OpenRouter', 'openai', 'https://openrouter.ai/api/v1', '多模型路由，一个 Key 通吃'],
  ['本地 Ollama', 'openai', 'http://127.0.0.1:11434/v1', '本机推理，无需联网（Key 填 ollama）'],
  ['自建中转站', 'openai', 'https://your-gateway.example.com/v1', '任何 OpenAI 兼容网关'],
];

const BUILTIN_STYLES = [
  ['水墨武侠', '中国水墨画风格，写意笔触，墨色浓淡晕染，留白构图，冷月残阳色调，2D 动画质感'],
  ['日系2D动画', '日本赛璐璐动画风格，干净线稿，平涂上色，光影分段明确，新海诚式高饱和天空'],
  ['国风厚涂', '国风厚涂插画，细腻笔触，绢本质感，工笔细节结合写意背景，暖金色调'],
  ['3D动画电影', '皮克斯式 3D 动画电影质感，柔顺毛发与布料解算，次表面散射皮肤，影棚级布光'],
  ['赛博朋克', '赛博朋克风格，霓虹紫青对撞光，雨夜湿滑地面反射，全息广告牌，高对比暗部'],
  ['写实电影感', '写实电影摄影风格，浅景深，自然光与实用光混合，柯达胶片颗粒，冷暖对比'],
  ['水彩绘本', '水彩绘本插画，纸纹可见，颜料自然扩散边缘，色彩透明清亮，柔和轮廓线'],
  ['黏土定格', '黏土定格动画风格，指纹质感表面，微缩模型布景，柔和棚拍灯光'],
  ['Q版可爱', 'Q版三头身可爱风格，圆润造型，明亮糖果色，简洁背景，表情夸张'],
  ['韩漫厚涂', '韩式厚涂漫画风格，精致五官，皮肤高光细腻，服装褶皱考究，都市光影'],
  ['暗黑哥特', '暗黑哥特风格，低饱和冷灰调，教堂尖顶与彩窗，体积光，压抑氛围'],
  ['复古胶片', '复古胶片摄影风格，暖黄褪色，明显颗粒与漏光，柯达 Portra 色调，怀旧氛围'],
];

export function seed() {
  const p = one('SELECT id FROM project LIMIT 1');
  if (!p) {
    const id = uid('prj');
    run(
      'INSERT INTO project (id, title, is_default, create_time, update_time) VALUES (?,?,1,?,?)',
      id, '默认项目', now(), now()
    );
  }
  if (!one('SELECT id FROM snippet LIMIT 1')) {
    const items = [
      ['小说转剧本', '你是资深 AI 漫剧策划，请把下面这段小说改写成适配 AI 漫剧的剧本：开头打造爆款钩子，结尾留悬念伏笔，删减拖沓剧情，不适合漫剧呈现的内容做合理改编。'],
      ['剧本提取角色', '根据剧本生成每个角色的人物设定，包含外形、服装、性格，符合 AI 绘图要求，每个角色只输出一段完整提示词。'],
      ['分镜提示词', '把剧本拆成 4-8 个分镜，每个分镜输出：画面描述 + 镜头语言 + 光影氛围，写成可直接用于 AI 绘图的中文提示词。'],
    ];
    for (const [name, content] of items) {
      run('INSERT INTO snippet (id, name, content, create_time, update_time) VALUES (?,?,?,?,?)',
        uid('ps'), name, content, now(), now());
    }
  }
  if (!one('SELECT id FROM style_preset LIMIT 1')) {
    for (const [name, prefix] of BUILTIN_STYLES) {
      run('INSERT INTO style_preset (id, name, prompt_prefix, negative_prompt, builtin, create_time, update_time) VALUES (?,?,?,?,1,?,?)',
        uid('sty'), name, prefix, '低清，模糊，多余手指，畸形肢体，文字水印', now(), now());
    }
  }
  for (const purpose of ['thinking', 'image_gen', 'video']) {
    if (!one('SELECT id FROM ai_config WHERE purpose = ?', purpose)) {
      run('INSERT INTO ai_config (id, purpose, provider, base_url, api_key, model_id, update_time) VALUES (?,?,?,?,?,?,?)',
        uid('cfg'), purpose, 'openai', 'https://api.openai.com/v1', '',
        purpose === 'thinking' ? 'gpt-4o-mini' : purpose === 'image_gen' ? 'gpt-image-1' : 'sora-2', now());
    }
  }
  if (!one('SELECT id FROM provider LIMIT 1')) {
    for (const [name, protocol, base, notes] of PROVIDER_PRESETS) {
      run('INSERT INTO provider (id, name, protocol, base_url, api_key, models_json, notes, enabled, create_time, update_time) VALUES (?,?,?,?,?,?,?,1,?,?)',
        uid('pv'), name, protocol, base, '', '[]', notes, now(), now());
    }
  }
  // 把用户已填好的配置自动迁移成一个可复用的供应商，原有调用不受影响
  const legacy = one("SELECT * FROM ai_config WHERE api_key IS NOT NULL AND api_key <> '' LIMIT 1");
  const linked = one('SELECT COUNT(*) c FROM ai_config WHERE provider_id IS NOT NULL').c;
  if (legacy && !linked) {
    const pid = uid('pv');
    run('INSERT INTO provider (id, name, protocol, base_url, api_key, models_json, notes, enabled, create_time, update_time) VALUES (?,?,?,?,?,?,?,1,?,?)',
      pid, '我的网关（自动迁移）', 'openai', legacy.base_url, legacy.api_key, '[]', '由原有配置自动迁移生成，可改名或替换', now(), now());
    for (const purpose of ['thinking', 'image_gen', 'video']) {
      run('UPDATE ai_config SET provider_id = ? WHERE purpose = ?', pid, purpose);
    }
  }
  // 自定义接口示例（用户可改可删）
  if (!one('SELECT id FROM custom_api LIMIT 1')) {
    run(`INSERT INTO custom_api (id, name, kind, method, url_template, headers_json, body_template,
         response_path, result_type, text_path, poll_url_template, poll_interval, poll_max,
         poll_status_path, poll_done_values, poll_fail_values, poll_result_path, notes, create_time, update_time)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      uid('ca'), '示例：OpenAI 文本（自定义）', 'text', 'POST',
      '{{base_url}}/chat/completions', '{}',
      '{"model":"{{model}}","messages":[{"role":"system","content":"{{system}}"},{"role":"user","content":"{{user}}"}],"stream":false,"max_tokens":{{max_tokens}}}',
      '', 'text', 'choices.0.message.content', '', 5000, 120, 'status', 'completed,success', 'failed,error', 'url',
      '自定义接口示例：可改成任何 REST 接口，用 {{prompt}} {{image}} {{model}} 等占位符注入参数', now(), now());
  }
}

export const q = { one, all, run };
