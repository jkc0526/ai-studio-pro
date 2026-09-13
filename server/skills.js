import { q, uid, now } from './db.js';

/* ============================================================================
   Skill 应用（v0.7）
   一个 Skill = 一套可复用的创作套路：风格 + 参数 + 步骤 recipe + 提示词增强。
   对齐 LibTV 的形态：斜杠命令 + 标题 + 描述 + 作者 + 使用量 + 分类。

   spec_json 结构：
   {
     styleName,  shots, ratio, duration, agentName,
     goalTemplate,   // 支持 {script} {shots} {title} 占位符
     recipe: [...工具名],  // 期望的执行顺序（写进 System 让 Agent 照做，不是硬编码）
     boosts: { script, split, compose }  // 注入岗位人设后的套路专属规范
   }
   ============================================================================ */

const DEFAULT_SPEC = {
  styleName: '', shots: 8, ratio: '9:16', duration: 5, agentName: '',
  goalTemplate: '', recipe: [], boosts: {},
};

/** 套用：把模板渲染成实际目标文案，并解析出风格 / 岗位 / 参数 */
export function renderSkill(skill, { script, shots } = {}) {
  const spec = { ...DEFAULT_SPEC, ...(skill.spec || {}) };
  const n = Number(shots) || spec.shots || 8;
  const goal = String(spec.goalTemplate || '')
    .replaceAll('{script}', script?.title || '当前剧本')
    .replaceAll('{shots}', String(n))
    .replaceAll('{title}', skill.title || '');
  return {
    skillId: skill.id,
    command: skill.command,
    title: skill.title,
    goal: goal || `用「${skill.title}」套路完成《${script?.title || '当前剧本'}》`,
    styleName: spec.styleName || '',
    agentName: spec.agentName || '',
    shots: n,
    ratio: spec.ratio,
    duration: spec.duration,
    recipe: Array.isArray(spec.recipe) ? spec.recipe : [],
    boosts: spec.boosts || {},
  };
}

const rowToSkill = (r) => r && ({
  ...r,
  spec: (() => { try { return JSON.parse(r.spec_json || '{}'); } catch { return {}; } })(),
});

export function listSkills({ category, kind, q: keyword } = {}) {
  let sql = 'SELECT * FROM skill';
  const where = [];
  const args = [];
  if (category && category !== '全部') { where.push('category = ?'); args.push(category); }
  if (kind && kind !== '全部') { where.push('kind = ?'); args.push(kind); }
  if (keyword) { where.push('(title LIKE ? OR summary LIKE ? OR command LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY builtin DESC, uses DESC, sort_order, create_time';
  return q.all(sql, ...args).map(rowToSkill);
}

export function getSkill(id) { return rowToSkill(q.one('SELECT * FROM skill WHERE id = ?', id)); }
export function getSkillByCommand(command) { return rowToSkill(q.one('SELECT * FROM skill WHERE command = ?', String(command || '').replace(/^\//, ''))); }

export function skillCategories() {
  return {
    categories: q.all('SELECT DISTINCT category FROM skill ORDER BY category').map((r) => r.category).filter(Boolean),
    kinds: q.all('SELECT DISTINCT kind FROM skill ORDER BY kind').map((r) => r.kind).filter(Boolean),
  };
}

export function upsertSkill(body = {}, id = null) {
  const title = String(body.title || '').trim();
  if (!title) throw new Error('请填写 Skill 名称');
  const command = String(body.command || '').trim().replace(/^\//, '') || `skill-${Date.now().toString(36)}`;
  const cur = id ? q.one('SELECT * FROM skill WHERE id = ?', id) : null;
  if (id && !cur) throw new Error('Skill 不存在');
  /* spec 深合并：只传部分字段（比如只改 shots）时，风格 / recipe / boosts 不能被清空 */
  const prevSpec = cur ? (() => { try { return JSON.parse(cur.spec_json || '{}'); } catch { return {}; } })() : {};
  const spec = { ...DEFAULT_SPEC, ...prevSpec, ...(body.spec || {}) };
  const fields = {
    command,
    title,
    category: String(body.category || cur?.category || '通用').trim(),
    kind: String(body.kind || cur?.kind || 'video').trim(),
    summary: String(body.summary ?? cur?.summary ?? '').trim(),
    author: String(body.author || cur?.author || '我').trim(),
    avatar: String(body.avatar || cur?.avatar || title.slice(0, 2)).trim().slice(0, 4),
    spec: JSON.stringify(spec),
  };
  if (id) {
    q.run(`UPDATE skill SET command = ?, title = ?, category = ?, kind = ?, summary = ?, author = ?, avatar = ?, spec_json = ?, update_time = ? WHERE id = ?`,
      fields.command, fields.title, fields.category, fields.kind, fields.summary,
      fields.author, fields.avatar, fields.spec, now(), id);
    return getSkill(id);
  }
  const nid = uid('sk');
  const maxSort = q.one('SELECT COALESCE(MAX(sort_order),0) m FROM skill')?.m || 0;
  /* 注意：sort_order 与 spec_json 的绑定顺序必须和列顺序严格一致，
     之前用展开数组导致 spec_json 拿到了序号、sort_order 拿到了 JSON 串 */
  q.run(`INSERT INTO skill (id, command, title, category, kind, summary, author, avatar, uses, builtin, sort_order, spec_json, create_time, update_time)
         VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?)`,
    nid, fields.command, fields.title, fields.category, fields.kind, fields.summary,
    fields.author, fields.avatar, maxSort + 1, fields.spec, now(), now());
  return getSkill(nid);
}

export function deleteSkill(id) {
  const s = q.one('SELECT * FROM skill WHERE id = ?', id);
  if (!s) throw new Error('Skill 不存在');
  q.run('DELETE FROM skill WHERE id = ?', id);
  return { deleted: id };
}

export function bumpUsage(id) {
  q.run('UPDATE skill SET uses = uses + 1, update_time = ? WHERE id = ?', now(), id);
}

/** 给 Agent 的 System 提示词追加「创作套路」段落 */
export function skillSystemBlock(rendered) {
  if (!rendered) return '';
  const lines = [
    '',
    '【本次创作套路】' + (rendered.title || ''),
    rendered.recipe?.length ? `期望步骤顺序：${rendered.recipe.join(' → ')}` : '',
    rendered.ratio ? `画面比例：${rendered.ratio}${rendered.duration ? ` · 单镜约 ${rendered.duration} 秒` : ''}` : '',
    rendered.shots ? `镜头数量：约 ${rendered.shots} 镜` : '',
    rendered.styleName ? `统一风格：${rendered.styleName}（请用 set_style 落实）` : '',
    rendered.boosts?.script ? `剧本规范：${rendered.boosts.script}` : '',
    rendered.boosts?.split ? `分镜规范：${rendered.boosts.split}` : '',
    rendered.boosts?.compose ? `提示词规范：${rendered.boosts.compose}` : '',
    '以上套路规范优先于你的个人习惯；但仍受工具权限与预算约束，且花钱前必须 ask_user。',
  ];
  return lines.filter(Boolean).join('\n');
}
