import path from 'node:path';
import fs from 'node:fs';
import { q, uid, now, OUTPUT_DIR } from './db.js';
import * as pipeline from './pipeline.js';
import * as videoMod from './video.js';
import * as exporter from './export.js';
import { callLLM } from './ai.js';
import { videoArgsForImage } from './engine.js';

/* ============================================================================
   Agent 工具注册表
   —— 每一个工具都是 server/pipeline.js / export.js 现有函数的薄封装，
      不新增任何 AI 能力，保证 Agent 出的图与用户手点的图行为完全一致。

   工具 run() 的返回约定：
     { brief: 给界面看的一行摘要, text: 回灌给模型的观察文本（必须控制长度）,
       data?: 给前端渲染的结构化数据 }
   永远不要把 base64 / 完整 JSON / 大段原文塞进 text —— 那是上下文爆炸的根源。
   ============================================================================ */

const projId = () => q.one('SELECT id FROM project ORDER BY create_time LIMIT 1')?.id || null;
const shotsOf = (scriptId) => q.all('SELECT * FROM shot WHERE script_id = ? ORDER BY seq', scriptId);
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

function cfgOf(purpose) {
  const row = q.one('SELECT * FROM ai_config WHERE purpose = ?', purpose);
  if (!row) throw new Error(`没有找到「${purpose}」模型配置，请先到「设置」里配置`);
  return row;
}

function shotBySeq(scriptId, seq) {
  const n = Number(seq);
  if (!Number.isFinite(n)) throw new Error(`镜头序号必须是数字，收到：${JSON.stringify(seq)}`);
  const s = q.one('SELECT * FROM shot WHERE script_id = ? AND seq = ?', scriptId, n);
  if (!s) throw new Error(`镜头 ${n} 不存在（该剧本共 ${shotsOf(scriptId).length} 个镜头，序号从 1 开始）`);
  return s;
}

/** 按名字找人/找景/找风格：先精确、再包含，容忍模型把名字写得不完全一致 */
function fuzzyOne(sql, name, label) {
  const key = String(name || '').trim();
  if (!key) throw new Error(`缺少「${label}」名称`);
  return q.one(sql, key) || q.one(sql.replace(' = ?', ' LIKE ?'), `%${key}%`);
}

function findCharacter(name) {
  const c = fuzzyOne('SELECT * FROM character WHERE name = ?', name, '角色');
  if (!c) throw new Error(`没找到角色「${name}」，请先用 get_project_state 确认角色档案是否存在`);
  return c;
}

function findStyle(name) {
  const s = fuzzyOne('SELECT * FROM style_preset WHERE name = ?', name, '风格');
  if (!s) throw new Error(`没找到风格「${name}」，可用风格请用 get_project_state 查看`);
  return s;
}

function findScene(name, scriptId) {
  const key = String(name || '').trim();
  if (!key) throw new Error('缺少「场景」名称');
  return q.one('SELECT * FROM scene WHERE name = ? AND (script_id = ? OR script_id IS NULL)', key, scriptId)
    || q.one('SELECT * FROM scene WHERE name LIKE ? AND (script_id = ? OR script_id IS NULL)', `%${key}%`, scriptId);
}

/** 小并发池（默认 2，与 pipeline.startBatch 的 MAX_PARALLEL 对齐） */
async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try { out[i] = { ok: true, value: await worker(items[i], i) }; }
      catch (e) { out[i] = { ok: false, error: e?.message || String(e) }; }
    }
  }));
  return out;
}

/** 与 /api/shots/:id/video 的 shotPromptFor 保持一致 */
const videoPromptFor = (shot) => (
  [shot.camera, shot.scene].filter(Boolean).join('，').slice(0, 400) || '镜头平稳运动，氛围自然'
);

const needImage = (url, what) => {
  if (!url) throw new Error(`${what}还没有图片，请先生成图片`);
  return path.join(OUTPUT_DIR, path.basename(url));
};

/* ============================================================================
   工具定义
   kind:  read（不花钱） | text（文本模型） | image（图像额度） | video（视频额度）
          —— kind 决定「要不要过花钱确认闸门」和「计入哪一类预算」
   group: 仅用于前端按域分组展示；不写则取 kind。
          export_movie 就是典型：它属于视频域（group=video），但只是本机跑 ffmpeg、
          不消耗任何模型额度，所以 kind 保持 read，不该被确认闸门拦住。
   control: 'ask' | 'finish' —— 由编排循环接管，不进入 run
   ============================================================================ */
export const TOOLS = {
  /* ---------------- 看清现状 ---------------- */
  get_project_state: {
    kind: 'read',
    desc: '查看当前剧本的现状：正文字数、镜头数与出图/出片进度、角色档案、场景档案、画面风格、可用风格列表。每一轮开始前都建议先调用它，不要凭记忆猜。',
    args: {},
    async run(_a, ctx) {
      const script = ctx.script();
      if (!script) throw new Error('当前没有选中剧本');
      const shots = shotsOf(script.id);
      const chars = q.all('SELECT * FROM character ORDER BY create_time');
      const scenes = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL ORDER BY create_time', script.id);
      const style = script.style_id ? q.one('SELECT * FROM style_preset WHERE id = ?', script.style_id) : null;
      const state = {
        剧本: {
          标题: script.title, 梗概: clip(script.outline, 150),
          正文字数: (script.content || '').length, 正文开头: clip(script.content, 260),
        },
        画面风格: style?.name || '（未设置）',
        镜头: {
          总数: shots.length,
          已出图: shots.filter((s) => s.image_url).length,
          已出片: shots.filter((s) => s.video_url).length,
          列表: shots.map((s) => ({
            序号: s.seq, 画面: clip(s.scene, 60), 台词: clip(s.dialogue, 30),
            运镜: clip(s.camera, 24), 时长: s.duration, 状态: s.status, 有提示词: !!s.prompt_used,
          })),
        },
        角色: chars.map((c) => ({ 姓名: c.name, 定位: c.role, 外形: clip(c.appearance, 70) })),
        场景: scenes.map((s) => ({ 名称: s.name, 环境: clip(s.env, 60) })),
        可用风格: q.all('SELECT name FROM style_preset ORDER BY builtin DESC, create_time').map((r) => r.name),
        ffmpeg可用: !!exporter.findFfmpeg(),
      };
      const brief = `剧本《${script.title}》${state.剧本.正文字数} 字 · ${shots.length} 镜（图 ${state.镜头.已出图} / 片 ${state.镜头.已出片}）· 角色 ${chars.length} · 场景 ${scenes.length}${style ? ` · 风格「${style.name}」` : ''}`;
      return { brief, text: JSON.stringify(state), data: state };
    },
  },

  /* ---------------- 文本类 ---------------- */
  write_script: {
    kind: 'text',
    desc: '撰写或重写剧本正文（会覆盖原有正文）。剧本已有正文时，必须先用 ask_user 征求同意，再传 重写:true。',
    args: { 要求: 'string，用户对剧情/改编方向的具体要求，可留空', 重写: 'boolean，覆盖已有正文时必须传 true' },
    async run(a, ctx) {
      const script = ctx.script();
      if (!script) throw new Error('当前没有选中剧本');
      const has = (script.content || '').trim().length > 0;
      if (has && a.重写 !== true) {
        return {
          brief: '剧本已有正文，未确认覆盖',
          text: `剧本正文已有 ${script.content.trim().length} 字。若要覆盖重写，请先用 ask_user 向用户确认，然后带 重写:true 重新调用本工具。`,
        };
      }
      const user = [
        a.要求,
        script.outline && `【已有梗概】${script.outline}`,
        has && `【已有正文（需要改写）】\n${clip(script.content, 3000)}`,
      ].filter(Boolean).join('\n\n') || `请根据标题《${script.title}》创作一集漫剧剧本。`;
      const r = await callLLM(cfgOf('thinking'), { model: ctx.modelId, system: pipeline.SCRIPT_SYSTEM, user });
      const text = String(r.text || '').trim();
      if (!text) throw new Error('模型未返回剧本正文');
      q.run('UPDATE script SET content = ?, update_time = ? WHERE id = ?', text, now(), script.id);
      ctx.spend('llmCalls');
      return {
        brief: `剧本正文已写入（${text.length} 字）`,
        text: `已写入剧本正文，共 ${text.length} 字。开头：${clip(text, 260)}`,
        data: { words: text.length },
      };
    },
  },

  extract_characters: {
    kind: 'text',
    desc: '从剧本正文提取角色档案（形象锁定）。已存在的同名角色会自动跳过，不会重复创建。',
    args: {},
    async run(_a, ctx) {
      const script = ctx.script();
      if (!script) throw new Error('当前没有选中剧本');
      if (!(script.content || '').trim()) throw new Error('剧本正文为空，请先调用 write_script');
      const { characters } = await pipeline.extractCharacters({ script, cfg: cfgOf('thinking'), model: ctx.modelId });
      ctx.spend('llmCalls');
      const created = [];
      for (const c of characters) {
        if (q.one('SELECT id FROM character WHERE name = ?', c.name)) continue;
        q.run('INSERT INTO character (id, project_id, name, role, appearance, outfit, personality, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?)',
          uid('ch'), projId(), c.name, c.role, c.appearance, c.outfit, c.personality, now(), now());
        created.push(c.name);
      }
      const all = q.all('SELECT * FROM character ORDER BY create_time');
      return {
        brief: created.length
          ? `提取到 ${created.length} 个新角色：${created.join('、')}`
          : `角色已齐备，无需重复提取（现有 ${all.length} 个）`,
        text: `角色档案现状：\n${all.map((c) => `- ${c.name}（${c.role || '未定'}）：${clip(c.appearance, 80)}${c.outfit ? `｜服装：${clip(c.outfit, 50)}` : ''}`).join('\n') || '（无）'}`,
        data: { created, total: all.length },
      };
    },
  },

  extract_scenes: {
    kind: 'text',
    desc: '从剧本正文提取场景档案（环境/光影/氛围锁定）。已存在的同名场景会自动跳过。',
    args: {},
    async run(_a, ctx) {
      const script = ctx.script();
      if (!script) throw new Error('当前没有选中剧本');
      if (!(script.content || '').trim()) throw new Error('剧本正文为空，请先调用 write_script');
      const { scenes } = await pipeline.extractScenes({ script, cfg: cfgOf('thinking'), model: ctx.modelId });
      ctx.spend('llmCalls');
      const created = [];
      for (const s of scenes) {
        if (q.one('SELECT id FROM scene WHERE name = ? AND (script_id = ? OR script_id IS NULL)', s.name, script.id)) continue;
        q.run('INSERT INTO scene (id, project_id, script_id, name, env, lighting, atmosphere, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?)',
          uid('sc'), projId(), script.id, s.name, s.env, s.lighting, s.atmosphere, now(), now());
        created.push(s.name);
      }
      const all = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL ORDER BY create_time', script.id);
      return {
        brief: created.length
          ? `提取到 ${created.length} 个新场景：${created.join('、')}`
          : `场景已齐备，无需重复提取（现有 ${all.length} 个）`,
        text: `场景档案现状：\n${all.map((s) => `- ${s.name}：${clip(s.env, 70)}${s.lighting ? `｜光影：${clip(s.lighting, 40)}` : ''}`).join('\n') || '（无）'}`,
        data: { created, total: all.length },
      };
    },
  },

  split_shots: {
    kind: 'text',
    desc: '把剧本正文拆成分镜表。剧本已有镜头时，必须先 ask_user 征求用户同意，再显式传 模式:"replace"（全部重拆）或 "append"（追加）。',
    args: { 镜头数: 'number，建议 4-12', 模式: '"replace" | "append"，剧本已有镜头时必填' },
    async run(a, ctx) {
      const script = ctx.script();
      if (!script) throw new Error('当前没有选中剧本');
      if (!(script.content || '').trim()) throw new Error('剧本正文为空，请先调用 write_script');

      const existing = shotsOf(script.id);
      const mode = a.模式 === 'append' ? 'append' : a.模式 === 'replace' ? 'replace' : null;
      // 护栏一：已有镜头却不说明模式 —— 直接拦下，避免重复拆镜堆镜头（v0.3.0 踩过）
      if (existing.length && !mode) {
        return {
          brief: `已有 ${existing.length} 个镜头，未指定模式`,
          text: `剧本已有 ${existing.length} 个镜头。请先用 ask_user 向用户确认是"全部重拆"还是"追加"，然后带上 模式 参数重新调用本工具。`,
        };
      }
      // 护栏二：已有素材还要求全部重拆 —— 先让用户点头
      const withMedia = existing.filter((s) => s.image_url || s.video_url).length;
      if (mode === 'replace' && withMedia > 0) {
        return {
          brief: `拒绝重拆：${withMedia} 个镜头已有图/片`,
          text: `有 ${withMedia} 个镜头已经出过图或视频，全部重拆会让这些素材失去引用。请先用 ask_user 征得用户明确同意，再重新调用本工具。`,
        };
      }

      const characters = q.all('SELECT * FROM character');
      const scenes = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL', script.id);
      const style = script.style_id ? q.one('SELECT * FROM style_preset WHERE id = ?', script.style_id) : null;
      const count = Math.min(24, Math.max(1, Number(a.镜头数) || 6));
      const { shots, salvaged, truncated } = await pipeline.splitScript({
        script, characters, scenes, style, cfg: cfgOf('thinking'), count, model: ctx.modelId,
      });
      ctx.spend('llmCalls');

      let deleted = 0;
      if (mode === 'replace') {
        deleted = existing.length;
        q.run('DELETE FROM shot WHERE script_id = ?', script.id);
      }
      const base = mode === 'append'
        ? (q.one('SELECT COALESCE(MAX(seq),0) m FROM shot WHERE script_id = ?', script.id)?.m || 0)
        : 0;
      for (const s of shots) {
        q.run('INSERT INTO shot (id, script_id, seq, scene, dialogue, camera, duration, character_ids, scene_id, style_id, status, create_time, update_time) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
          uid('sh'), script.id, base + s.seq, s.scene, s.dialogue, s.camera, s.duration, s.character_ids,
          s.scene_id || null, script.style_id || null, 'idle', now(), now());
      }
      const rows = shotsOf(script.id);
      if (mode === 'append') rows.forEach((r, i) => q.run('UPDATE shot SET seq = ? WHERE id = ?', i + 1, r.id));
      const finalRows = shotsOf(script.id);

      return {
        brief: `分镜表就绪：共 ${finalRows.length} 镜${deleted ? `（已删除旧 ${deleted} 镜）` : ''}${salvaged ? '（输出被截断，已保留完整部分）' : ''}`,
        text: [
          `分镜表已写入，共 ${finalRows.length} 个镜头：`,
          ...finalRows.map((s) => `${s.seq}. ${clip(s.scene, 60)}｜${clip(s.camera, 24)}｜${s.duration}s`),
          truncated ? '注意：模型输出达到长度上限，镜头数可能少于要求，可再追加。' : '',
        ].filter(Boolean).join('\n'),
        data: { total: finalRows.length, deleted },
      };
    },
  },

  compose_prompts: {
    kind: 'text',
    desc: '为镜头合成最终绘图提示词（逐镜调用文本模型，写回 prompt_used）。不传序号则处理全部镜头。出图前建议先做这一步，画面一致性更好。',
    args: { 镜头序号: 'number[]，留空表示全部镜头' },
    async run(a, ctx) {
      const script = ctx.script();
      if (!script) throw new Error('当前没有选中剧本');
      const all = shotsOf(script.id);
      if (!all.length) throw new Error('还没有镜头，请先调用 split_shots');
      const wanted = Array.isArray(a.镜头序号) && a.镜头序号.length
        ? all.filter((s) => a.镜头序号.map(Number).includes(s.seq))
        : all;
      if (!wanted.length) throw new Error('指定的镜头序号都不存在');

      const cfg = cfgOf('thinking');
      const style = script.style_id ? q.one('SELECT * FROM style_preset WHERE id = ?', script.style_id) : null;
      const castByName = Object.fromEntries(q.all('SELECT * FROM character').map((c) => [c.name, c]));
      const sceneById = Object.fromEntries(
        q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL', script.id).map((s) => [s.id, s]));

      const done = [];
      for (const s of wanted) {
        const castText = (s.character_ids ? JSON.parse(s.character_ids || '[]') : [])
          .map((id) => castByName[id]).filter(Boolean).map((c) => pipeline.charText(c)).join('；');
        const sc = s.scene_id ? sceneById[s.scene_id] : null;
        const sceneText = sc
          ? [sc.name, sc.env, sc.lighting && `光影：${sc.lighting}`, sc.atmosphere && `氛围：${sc.atmosphere}`].filter(Boolean).join('，')
          : '';
        const user = pipeline.composeUserMessage({ script, style, shot: s, castText, sceneText });
        const r = await callLLM(cfg, { model: ctx.modelId, system: pipeline.COMPOSE_SYSTEM, user });
        const p = String(r.text || '').trim();
        if (!p) continue;
        q.run('UPDATE shot SET prompt_used = ?, update_time = ? WHERE id = ?', p, now(), s.id);
        done.push({ seq: s.seq, prompt: p });
      }
      ctx.spend('llmCalls', done.length);
      return {
        brief: `已合成 ${done.length}/${wanted.length} 镜提示词`,
        text: `提示词合成完成（${done.length} 镜）：\n${done.map((d) => `${d.seq}. ${clip(d.prompt, 90)}`).join('\n')}`,
        data: { composed: done.length, prompts: done.map((d) => ({ seq: d.seq, prompt: clip(d.prompt, 300) })) },
      };
    },
  },

  /* ---------------- 写操作（不花钱，即时生效） ---------------- */
  update_shot: {
    kind: 'read',
    desc: '修改单个镜头的画面描述、台词、运镜、时长、出镜角色或所在场景。只传需要改的字段。',
    args: {
      镜头序号: 'number，必填',
      画面: 'string', 台词: 'string', 运镜: 'string', 时长: 'number，3-8 秒',
      出镜角色: 'string[]，角色名数组，会覆盖原有出镜名单', 场景名: 'string，必须已存在于场景档案',
    },
    async run(a, ctx) {
      const shot = shotBySeq(ctx.scriptId, a.镜头序号);
      const sets = [];
      const args = [];
      const changed = [];
      const put = (field, value) => { sets.push(`${field} = ?`); args.push(value); changed.push(field); };

      if (a.画面 !== undefined) put('scene', String(a.画面).trim());
      if (a.台词 !== undefined) put('dialogue', String(a.台词).trim());
      if (a.运镜 !== undefined) put('camera', String(a.运镜).trim());
      if (a.时长 !== undefined) {
        const d = Math.min(10, Math.max(1, Number(a.时长) || 5));
        put('duration', d);
      }
      if (Array.isArray(a.出镜角色)) {
        const ids = a.出镜角色.map((n) => {
          const c = q.one('SELECT id FROM character WHERE name = ?', String(n).trim());
          if (!c) throw new Error(`出镜角色「${n}」不存在于角色档案中`);
          return c.id;
        });
        put('character_ids', JSON.stringify(ids));
      }
      if (a.场景名 !== undefined) {
        const sc = findScene(a.场景名, ctx.scriptId);
        if (!sc) throw new Error(`场景「${a.场景名}」不存在，请先提取场景档案或选用已有场景`);
        put('scene_id', sc.id);
      }
      if (!changed.length) return { brief: `镜头 ${shot.seq} 未做修改`, text: '没有传入任何需要修改的字段。' };

      q.run(`UPDATE shot SET ${sets.join(', ')}, update_time = ? WHERE id = ?`, ...args, now(), shot.id);
      const after = q.one('SELECT * FROM shot WHERE id = ?', shot.id);
      return {
        brief: `镜头 ${after.seq} 已更新（${changed.length} 个字段）`,
        text: `镜头 ${after.seq} 现状：${clip(after.scene, 80)}｜台词：${clip(after.dialogue, 40)}｜运镜：${clip(after.camera, 30)}｜${after.duration}s`,
        data: { seq: after.seq, fields: changed },
      };
    },
  },

  update_character: {
    kind: 'read',
    desc: '修改角色档案（形象锁定）。用于把外形/服装描述改得更具体、更一致。',
    args: { 角色名: 'string，必填', 形象: 'string', 服装: 'string', 性格: 'string', 定位: 'string' },
    async run(a) {
      const c = findCharacter(a.角色名);
      const sets = []; const args = []; const changed = [];
      const put = (f, v) => { sets.push(`${f} = ?`); args.push(String(v).trim()); changed.push(f); };
      if (a.形象 !== undefined) put('appearance', a.形象);
      if (a.服装 !== undefined) put('outfit', a.服装);
      if (a.性格 !== undefined) put('personality', a.性格);
      if (a.定位 !== undefined) put('role', a.定位);
      if (!changed.length) return { brief: `角色「${c.name}」未做修改`, text: '没有传入任何需要修改的字段。' };
      q.run(`UPDATE character SET ${sets.join(', ')}, update_time = ? WHERE id = ?`, ...args, now(), c.id);
      return { brief: `角色「${c.name}」已更新`, text: `角色「${c.name}」最新形象：${clip(a.形象 ?? c.appearance, 120)}` };
    },
  },

  update_scene: {
    kind: 'read',
    desc: '修改场景档案（环境锁定）。',
    args: { 场景名: 'string，必填', 环境: 'string', 光影: 'string', 氛围: 'string' },
    async run(a, ctx) {
      const s = findScene(a.场景名, ctx.scriptId);
      if (!s) throw new Error(`场景「${a.场景名}」不存在，请先提取场景档案`);
      const sets = []; const args = []; const changed = [];
      const put = (f, v) => { sets.push(`${f} = ?`); args.push(String(v).trim()); changed.push(f); };
      if (a.环境 !== undefined) put('env', a.环境);
      if (a.光影 !== undefined) put('lighting', a.光影);
      if (a.氛围 !== undefined) put('atmosphere', a.氛围);
      if (!changed.length) return { brief: `场景「${s.name}」未做修改`, text: '没有传入任何需要修改的字段。' };
      q.run(`UPDATE scene SET ${sets.join(', ')}, update_time = ? WHERE id = ?`, ...args, now(), s.id);
      return { brief: `场景「${s.name}」已更新`, text: `场景「${s.name}」最新环境：${clip(a.环境 ?? s.env, 120)}` };
    },
  },

  set_style: {
    kind: 'read',
    desc: '统一整部剧本的画面风格（会同时应用到所有镜头）。风格名必须是可用风格列表里存在的。',
    args: { 风格名: 'string，必填' },
    async run(a, ctx) {
      const st = findStyle(a.风格名);
      q.run('UPDATE script SET style_id = ?, update_time = ? WHERE id = ?', st.id, now(), ctx.scriptId);
      q.run('UPDATE shot SET style_id = ?, update_time = ? WHERE script_id = ?', st.id, now(), ctx.scriptId);
      return {
        brief: `画面风格已切换为「${st.name}」`,
        text: `风格已统一为「${st.name}」，前缀：${clip(st.prompt_prefix, 100)}。已应用到全部镜头。`,
        data: { styleId: st.id, name: st.name },
      };
    },
  },

  /* ---------------- 图像类（消耗额度，需确认） ---------------- */
  generate_image: {
    kind: 'image',
    desc: '为指定镜头生成分镜图（消耗图像额度）。该镜头已有图时会覆盖。',
    args: { 镜头序号: 'number，必填', 尺寸: 'string，默认 1024x1536 竖屏' },
    async run(a, ctx) {
      const shot = shotBySeq(ctx.scriptId, a.镜头序号);
      q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'running', now(), shot.id);
      try {
        const out = await pipeline.generateShotImage({
          shot, styleId: ctx.styleId || shot.style_id, imageCfg: cfgOf('image_gen'),
          extra: a.附加 || '', size: a.尺寸 || '1024x1536', model: ctx.imageModelId,
        });
        ctx.spend('images');
        return {
          brief: `镜头 ${shot.seq} 出图完成`,
          text: `镜头 ${shot.seq} 已出图，图片地址 ${out.url}。提示词：${clip(out.prompt, 90)}`,
          data: { seq: shot.seq, image: out.image_url, prompt: out.prompt },
        };
      } catch (e) {
        q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
        throw e;
      }
    },
  },

  generate_variants: {
    kind: 'image',
    desc: '为同一镜头生成多个版本供择优（消耗图像额度，每版一张）。生成后需再调用 select_variant 定稿。',
    args: { 镜头序号: 'number，必填', 版本数: 'number，1-4，默认 2' },
    async run(a, ctx) {
      const shot = shotBySeq(ctx.scriptId, a.镜头序号);
      const n = Math.min(4, Math.max(1, Number(a.版本数) || 2));
      q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'running', now(), shot.id);
      const produced = [];
      try {
        for (let i = 0; i < n; i++) {
          const out = await pipeline.generateShotImage({
            shot, styleId: ctx.styleId || shot.style_id, imageCfg: cfgOf('image_gen'),
            size: a.尺寸 || '1024x1536', model: ctx.imageModelId,
          });
          produced.push(out);
        }
      } catch (e) {
        q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
        throw e;
      }
      ctx.spend('images', produced.length);
      // 落版本表：与 /api/shots/:id/image 的多版本语义保持一致（最后一版为当前定稿）。
      // 不落库的话 select_variant 永远查不到版本，版本择优这条链就是断的。
      q.run('UPDATE shot_variant SET selected = 0 WHERE shot_id = ?', shot.id);
      for (const [i, p] of produced.entries()) {
        q.run('INSERT INTO shot_variant (id, shot_id, image_url, prompt, model, selected, create_time) VALUES (?,?,?,?,?,?,?)',
          uid('vr'), shot.id, p.image_url, p.prompt, p.model, i === produced.length - 1 ? 1 : 0, now());
      }
      return {
        brief: `镜头 ${shot.seq} 生成 ${produced.length} 个版本`,
        text: `镜头 ${shot.seq} 共 ${produced.length} 个版本（第 1 版为最早）。请调用 select_variant 选择定稿版本，或调用 generate_image 覆盖重画。`,
        data: { seq: shot.seq, variants: produced.map((p) => p.image_url) },
      };
    },
  },

  select_variant: {
    kind: 'read',
    desc: '在镜头已有的多个版本里挑一个定稿（不花钱）。',
    args: { 镜头序号: 'number，必填', 第几版: 'number，1 表示最新一版' },
    async run(a, ctx) {
      const shot = shotBySeq(ctx.scriptId, a.镜头序号);
      const list = q.all('SELECT * FROM shot_variant WHERE shot_id = ? ORDER BY create_time DESC, rowid DESC', shot.id);
      if (!list.length) throw new Error(`镜头 ${shot.seq} 还没有任何版本，请先调用 generate_variants`);
      const idx = (Number(a.第几版) || 1) - 1;
      const v = list[idx];
      if (!v) throw new Error(`镜头 ${shot.seq} 只有 ${list.length} 个版本，取不到第 ${idx + 1} 版`);
      q.run('UPDATE shot_variant SET selected = 0 WHERE shot_id = ?', shot.id);
      q.run('UPDATE shot_variant SET selected = 1 WHERE id = ?', v.id);
      q.run('UPDATE shot SET image_url = ?, prompt_used = ?, status = ?, error = NULL, update_time = ? WHERE id = ?',
        v.image_url, v.prompt, 'done', now(), shot.id);
      return {
        brief: `镜头 ${shot.seq} 已定稿第 ${idx + 1} 版`,
        text: `镜头 ${shot.seq} 定稿为第 ${idx + 1} 版（共 ${list.length} 版）。`,
        data: { seq: shot.seq, image: v.image_url },
      };
    },
  },

  batch_images: {
    kind: 'image',
    desc: '批量给镜头出图（并发 2，消耗图像额度）。不传序号则处理该剧本全部镜头，建议先确认镜头数量与预算。',
    args: { 镜头序号: 'number[]，留空表示全部', 只补缺: 'boolean，true 时只处理还没有图的镜头' },
    async run(a, ctx) {
      const all = shotsOf(ctx.scriptId);
      let work = Array.isArray(a.镜头序号) && a.镜头序号.length
        ? all.filter((s) => a.镜头序号.map(Number).includes(s.seq))
        : [...all];
      if (a.只补缺) work = work.filter((s) => !s.image_url);
      if (!work.length) return { brief: '没有需要出图的镜头', text: '当前没有需要出图的镜头（可能都已出图）。' };

      const cfg = cfgOf('image_gen');
      let okCount = 0;
      const failures = [];
      const results = await pool(work, 2, async (s) => {
        const shot = q.one('SELECT * FROM shot WHERE id = ?', s.id);
        q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'running', now(), shot.id);
        try {
          const out = await pipeline.generateShotImage({
            shot, styleId: ctx.styleId || shot.style_id, imageCfg: cfg, size: a.尺寸 || '1024x1536', model: ctx.imageModelId,
          });
          okCount++;
          ctx.emit?.({ stage: 'image', seq: shot.seq, done: okCount, total: work.length });
          return out;
        } catch (e) {
          q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
          throw e;
        }
      });
      results.forEach((r, i) => { if (!r.ok) failures.push(`镜头 ${work[i].seq}：${r.error}`); });
      ctx.spend('images', okCount);

      return {
        brief: `批量出图 ${okCount}/${work.length}${failures.length ? `，失败 ${failures.length} 个` : '，全部成功'}`,
        text: [
          `批量出图完成：成功 ${okCount} 个，失败 ${failures.length} 个。`,
          failures.length ? `失败明细：\n${failures.slice(0, 8).join('\n')}` : '',
          failures.length ? '可对失败镜头重新调用 generate_image 单独重试。' : '',
        ].filter(Boolean).join('\n'),
        data: { ok: okCount, total: work.length, failures },
      };
    },
  },

  generate_character_sheets: {
    kind: 'image',
    desc: '为角色生成三视图设定稿（消耗图像额度）。用于锁定角色外观，建议在批量出图之前做。',
    args: { 角色名: 'string，留空表示全部角色' },
    async run(a, ctx) {
      const list = a.角色名
        ? [findCharacter(a.角色名)]
        : q.all('SELECT * FROM character ORDER BY create_time');
      if (!list.length) throw new Error('还没有角色档案，请先调用 extract_characters');
      const cfg = cfgOf('image_gen');
      let okCount = 0; const failures = [];
      await pool(list, 2, async (c) => {
        try {
          await pipeline.generateCharacterSheet({ character: c, styleId: ctx.styleId, imageCfg: cfg, model: ctx.imageModelId });
          okCount++;
        } catch (e) { failures.push(`${c.name}：${e.message}`); throw e; }
      });
      ctx.spend('images', okCount);
      return {
        brief: `角色三视图 ${okCount}/${list.length} 完成`,
        text: `角色三视图生成完成：成功 ${okCount} 个${failures.length ? `，失败 ${failures.length} 个（${failures.slice(0, 5).join('；')}）` : ''}。`,
        data: { ok: okCount, total: list.length },
      };
    },
  },

  generate_scene_image: {
    kind: 'image',
    desc: '为场景生成概念设定图（消耗图像额度），锁定空间外观。',
    args: { 场景名: 'string，留空表示全部场景' },
    async run(a, ctx) {
      const all = q.all('SELECT * FROM scene WHERE script_id = ? OR script_id IS NULL ORDER BY create_time', ctx.scriptId);
      const list = a.场景名 ? [findScene(a.场景名, ctx.scriptId)].filter(Boolean) : all;
      if (!list.length) throw new Error('还没有场景档案，请先调用 extract_scenes');
      const cfg = cfgOf('image_gen');
      let okCount = 0;
      await pool(list, 2, async (s) => {
        await pipeline.generateSceneImage({ scene: s, styleId: ctx.styleId, imageCfg: cfg, model: ctx.imageModelId });
        okCount++;
      });
      ctx.spend('images', okCount);
      return { brief: `场景设定图 ${okCount}/${list.length} 完成`, text: `场景概念图生成完成，成功 ${okCount} 个。`, data: { ok: okCount, total: list.length } };
    },
  },

  /* ---------------- 视频类（消耗额度，需确认） ---------------- */
  batch_videos: {
    kind: 'video',
    desc: '把已有分镜图批量转成视频（并发 2，消耗视频额度，耗时较长）。没有图的镜头会被跳过。',
    args: { 镜头序号: 'number[]，留空表示全部', 只补缺: 'boolean，true 时只处理还没有视频的镜头' },
    async run(a, ctx) {
      const all = shotsOf(ctx.scriptId);
      let work = Array.isArray(a.镜头序号) && a.镜头序号.length
        ? all.filter((s) => a.镜头序号.map(Number).includes(s.seq))
        : [...all];
      work = work.filter((s) => s.image_url);
      if (a.只补缺) work = work.filter((s) => !s.video_url);
      if (!work.length) return { brief: '没有可转视频的镜头', text: '没有可用于图生视频的镜头（需要先出分镜图）。' };

      const model = ctx.videoModelId || videoMod.pickModel('video');
      if (!model) throw new Error('未找到可用的视频模型，请到「设置」里填写或确认账号权限');

      let okCount = 0; const failures = [];
      await pool(work, 2, async (s) => {
        const shot = q.one('SELECT * FROM shot WHERE id = ?', s.id);
        q.run('UPDATE shot SET status = ?, error = NULL, update_time = ? WHERE id = ?', 'video', now(), shot.id);
        try {
          // 每镜独立判定：有分镜图 → keyframe(first_frame)，无图 → text（统一走 videoArgsForImage）
          const dataUrl = shot.image_url
            ? `data:image/png;base64,${fs.readFileSync(needImage(shot.image_url, `镜头 ${shot.seq}`)).toString('base64')}`
            : null;
          const out = await videoMod.callVideo('video', {
            model,
            prompt: videoPromptFor(shot),
            ...videoArgsForImage({ image: dataUrl, duration: Number(shot.duration) || 5, ratio: shot.ratio || undefined }),
          });
          q.run('UPDATE shot SET video_url = ?, status = ?, error = NULL, update_time = ? WHERE id = ?', out.url, 'done', now(), shot.id);
          videoMod.recordMedia({
            scriptId: shot.script_id, shotId: shot.id, kind: 'video', filePath: out.url,
            prompt: videoPromptFor(shot), model: out.model, meta: { source: out.sourceUrl },
          });
          okCount++;
          ctx.emit?.({ stage: 'video', seq: shot.seq, done: okCount, total: work.length });
          return out;
        } catch (e) {
          q.run('UPDATE shot SET status = ?, error = ?, update_time = ? WHERE id = ?', 'error', e.message, now(), shot.id);
          failures.push(`镜头 ${shot.seq}：${e.message}`);
          throw e;
        }
      });
      ctx.spend('videos', okCount);
      return {
        brief: `图生视频 ${okCount}/${work.length}${failures.length ? `，失败 ${failures.length} 个` : '，全部成功'}`,
        text: [
          `图生视频完成：成功 ${okCount} 个，失败 ${failures.length} 个，使用模型 ${model}。`,
          failures.length ? `失败明细：\n${failures.slice(0, 8).join('\n')}` : '',
        ].filter(Boolean).join('\n'),
        data: { ok: okCount, total: work.length, model, failures },
      };
    },
  },

  export_movie: {
    kind: 'read',
    group: 'video',
    desc: '把所有镜头按镜序拼接导出成片（竖屏 MP4 + SRT 字幕）。会自动跳过没有素材的镜头。较慢但不再消耗模型额度。',
    args: { 宽: 'number，默认 1080', 高: 'number，默认 1920', 帧率: 'number，默认 30' },
    async run(a, ctx) {
      const shots = shotsOf(ctx.scriptId);
      if (!shots.some((s) => s.video_url || s.image_url)) {
        throw new Error('没有任何镜头有图或视频，无法导出。请先生成图片或视频');
      }
      const out = await exporter.exportMovie({
        scriptId: ctx.scriptId,
        width: Number(a.宽) || 1080,
        height: Number(a.高) || 1920,
        fps: Number(a.帧率) || 30,
      });
      return {
        brief: `成片已导出：${out.shots} 镜 / ${Math.round(out.duration)} 秒${out.skipped.length ? `（跳过 ${out.skipped.length} 镜）` : ''}`,
        text: [
          `成片已导出：${out.url}`,
          `拼接 ${out.shots} 个镜头，总时长约 ${Math.round(out.duration)} 秒。`,
          out.srt ? `字幕文件：${out.srt}` : '',
          out.skipped.length ? `被跳过的空镜序号：${out.skipped.join('、')}` : '',
        ].filter(Boolean).join('\n'),
        data: { movie: out.url, srt: out.srt, duration: out.duration, shots: out.shots, skipped: out.skipped },
      };
    },
  },

  /* ---------------- 控制类（由编排循环接管） ---------------- */
  ask_user: {
    kind: 'read',
    control: 'ask',
    desc: '向用户提问或请求确认，会暂停本次运行直到用户回答。凡是花钱的操作（生图/生视频）、覆盖已有正文、重拆已有镜头的分镜表，都必须先调用它。',
    args: { 问题: 'string，必填，要说清楚打算做什么、规模多大', 选项: 'string[]，可选的快捷选项' },
  },

  finish: {
    kind: 'read',
    control: 'finish',
    desc: '任务完成，结束本次运行并向用户交付总结。总结要说清楚：做了什么、产物在哪、还有什么没做。',
    args: { 总结: 'string，必填，给用户的交付说明' },
  },
};

/** 给模型看的工具清单文本（只列该 Agent 有权限调用的） */
export function toolCatalog(names) {
  return names
    .map((n) => TOOLS[n] && `- ${n}：${TOOLS[n].desc}\n  参数：${JSON.stringify(TOOLS[n].args)}`)
    .filter(Boolean)
    .join('\n');
}

/** 永远允许的控制工具，不受白名单限制 */
export const ALWAYS_ALLOWED = ['ask_user', 'finish'];
