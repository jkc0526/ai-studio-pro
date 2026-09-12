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
CREATE TABLE IF NOT EXISTS scene (
  id TEXT PRIMARY KEY, project_id TEXT, script_id TEXT, name TEXT, env TEXT,
  lighting TEXT, atmosphere TEXT, ref_image_url TEXT,
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

/* ---------------- Agent 应用（v0.6） ----------------
   agent      剧组名册：一个 Agent = 可复用的「岗位 + 人设 + 工具权限 + 预算」
   agent_run  一次运行
   agent_step 每一步（时间线渲染 / 断点续跑 / 审计） */
CREATE TABLE IF NOT EXISTS agent (
  id TEXT PRIMARY KEY, name TEXT, role TEXT, avatar TEXT,
  system_prompt TEXT, model_id TEXT,
  tools_json TEXT, auto_run INTEGER DEFAULT 0, budget_json TEXT,
  builtin INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS agent_run (
  id TEXT PRIMARY KEY, agent_id TEXT, script_id TEXT,
  goal TEXT, status TEXT, step_count INTEGER DEFAULT 0,
  cost_json TEXT, context_json TEXT, error TEXT,
  create_time TEXT, update_time TEXT
);
CREATE TABLE IF NOT EXISTS agent_step (
  id TEXT PRIMARY KEY, run_id TEXT, seq INTEGER, role TEXT,
  tool TEXT, args_json TEXT, result_json TEXT,
  tokens INTEGER, ms INTEGER, status TEXT, error TEXT,
  create_time TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_step_run ON agent_step(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_agent_run_script ON agent_run(script_id, create_time);
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
ensureColumn('shot', 'ratio', 'ratio TEXT');
// 分镜 → 场景引用（人物引用已有 character_ids）
ensureColumn('shot', 'scene_id', 'scene_id TEXT');

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

/* ---------------- Agent 剧组预置岗位 ---------------- */
const BUDGET_DEFAULT = { maxSteps: 30, maxImages: 12, maxVideos: 10, deadlineSec: 1800 };
const T_STATE = ['get_project_state'];
const T_TEXT = ['write_script', 'extract_characters', 'extract_scenes', 'split_shots', 'compose_prompts'];
const T_WRITE = ['update_shot', 'update_character', 'update_scene', 'set_style'];
const T_IMG = ['generate_image', 'generate_variants', 'select_variant', 'batch_images', 'generate_character_sheets', 'generate_scene_image'];
const T_VID = ['batch_videos', 'export_movie'];
const T_CTRL = ['ask_user', 'finish'];

const AGENT_PRESETS = [
  {
    name: '制片人', role: '统筹全局', avatar: '制片',
    auto_run: 0,
    system_prompt: '你是漫剧制片人，负责把一个模糊的目标拆成可执行的步骤并推进到底。你的职责：先看清现状，再决定顺序；素材够用就不要重复生成；花钱的操作（生图/生视频）之前先向用户说明规模并请求确认；全部完成后检查成片是否可用，再交付总结。你不亲自写画面细节——那是编剧、分镜师、美术指导的活，你负责调度和验收。',
    tools: [...T_STATE, ...T_TEXT, ...T_WRITE, ...T_IMG, ...T_VID, ...T_CTRL],
    budget: { ...BUDGET_DEFAULT, maxImages: 24, maxVideos: 20 },
  },
  {
    name: '编剧', role: '写剧本', avatar: '编剧',
    auto_run: 1,
    system_prompt: '你是资深 AI 漫剧编剧。你只负责把想法或素材变成可直接拍摄的剧本正文：开头三秒必须有钩子，冲突要集中，结尾留悬念，删掉拖沓剧情。你不碰画面、不碰分镜、不碰生图。正文写完后向用户确认剧情方向是否满意。',
    tools: [...T_STATE, 'write_script', ...T_CTRL],
    budget: BUDGET_DEFAULT,
  },
  {
    name: '分镜师', role: '拆分镜', avatar: '分镜',
    auto_run: 1,
    system_prompt: '你是资深 AI 漫剧分镜师。你把剧本拆成可直接用于 AI 绘图与视频生成的分镜表，关注节奏、景别变化与信息量。每镜必须能被画出来，不能出现"同上""继续"这类指代。拆完检查镜头数量与时长是否合理，必要时逐镜微调画面描述、台词与运镜。',
    tools: [...T_STATE, 'split_shots', 'compose_prompts', 'update_shot', ...T_CTRL],
    budget: BUDGET_DEFAULT,
  },
  {
    name: '美术指导', role: '锁定形象与场景', avatar: '美术',
    auto_run: 0,  // 岗位带图像类工具，默认「花钱前必须确认」
    system_prompt: '你是漫剧美术指导，负责跨镜头一致性。你的职责是：从剧本提取角色形象锁定档案与场景锁定档案，把外形、服装、环境、光影、氛围写成固定可复用的具体描述；统一画面风格。形象描述越具体，后面每一镜越不会崩脸。你不负责出图。',
    tools: [...T_STATE, 'extract_characters', 'extract_scenes', 'update_character', 'update_scene', 'set_style',
      'generate_character_sheets', 'generate_scene_image', ...T_CTRL],
    budget: BUDGET_DEFAULT,
  },
  {
    name: '剪辑师', role: '出图出片与成片导出', avatar: '剪辑',
    auto_run: 0,
    system_prompt: '你是漫剧剪辑与出片负责人。职责：把分镜逐镜出图、出视频，对不满意的镜头重做或做多版本择优，最后拼接导出成片。生图生视频是要花钱的不可逆操作，每次动手之前必须用 ask_user 告诉用户本次要生成多少张/多少条、大概消耗多少，得到同意再执行。出图前请确认已经存在角色与场景档案，否则提示先补齐。',
    tools: [...T_STATE, 'generate_image', 'generate_variants', 'select_variant', 'batch_images', 'batch_videos', 'export_movie', ...T_CTRL],
    budget: BUDGET_DEFAULT,
  },
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
  // Agent 剧组名册（开箱可用，可改名改人设改权限）
  if (!one('SELECT id FROM agent LIMIT 1')) {
    for (const [sort, a] of AGENT_PRESETS.entries()) {
      run(`INSERT INTO agent (id, name, role, avatar, system_prompt, model_id, tools_json,
           auto_run, budget_json, builtin, sort_order, create_time, update_time)
           VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?)`,
        uid('ag'), a.name, a.role, a.avatar, a.system_prompt, '', JSON.stringify(a.tools),
        a.auto_run, JSON.stringify(a.budget), sort, now(), now());
    }
  }
}

export const q = { one, all, run };
