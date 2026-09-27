import { useMemo, useState } from 'react';

export default function SkillCatalog({ skills = [], meta = {}, selectedId, onUse, compact = false, onClear }) {
  const [kind, setKind] = useState('全部');
  const [category, setCategory] = useState('全部');
  const filtered = useMemo(() => skills.filter((skill) => (
    kind === '全部' || skill.kind === kind
  ) && (category === '全部' || skill.category === category)), [skills, kind, category]);

  if (compact) {
    return <div className="skill-chips">{skills.map((skill) => <button key={skill.id} className={`skill-chip ${selectedId === skill.id ? 'selected' : ''}`} onClick={() => onUse(skill)}><span className="skill-chip-icon">✦</span><span><b>{skill.title}</b><small>{skill.category || skill.kind || '通用'}</small></span></button>)}</div>;
  }

  return (
    <div className="ag-skills">
      <div className="ag-skills-head"><b>Skill 全开，故事走起</b><span className="hint">套一个套路：风格 / 镜头 / 步骤 / 提示词规范一次性带齐</span><span className="spacer" /><div className="ag-skills-tabs">{['全部', ...(meta.kinds || [])].map((value) => <button key={value} className={`ag-skill-tab ${kind === value ? 'on' : ''}`} onClick={() => setKind(value)}>{value === 'video' ? '视频' : value === 'image' ? '图片' : value}</button>)}</div></div>
      <div className="ag-skills-cats">{['全部', ...(meta.categories || [])].map((value) => <button key={value} className={`ag-cat ${category === value ? 'on' : ''}`} onClick={() => setCategory(value)}>{value}</button>)}</div>
      <div className="ag-skills-grid">{!filtered.length && <div className="ag-empty">该分类下还没有 Skill</div>}{filtered.map((skill) => <div key={skill.id} className={`ag-skill ${selectedId === skill.id ? 'on' : ''}`}><span className="ag-skill-avatar">{skill.avatar || skill.title.slice(0, 2)}</span><div className="ag-skill-body"><div className="ag-skill-title"><b>{skill.title}</b><code>/{skill.command}</code><span className={`ag-skill-kind ${skill.kind}`}>{skill.kind === 'image' ? '图片' : '视频'}</span></div><p className="ag-skill-sum">{skill.summary}</p><div className="ag-skill-meta"><span>{skill.author}</span><span>·</span><span>{skill.uses || 0} 次使用</span>{!!skill.spec?.shots && <span>· {skill.spec.shots} 镜 {skill.spec.ratio}</span>}<span className="spacer" /><button className="ghost tiny" onClick={() => onUse(skill)}>{selectedId === skill.id ? '已套用' : '使用'}</button></div></div></div>)}</div>
      {selectedId && onClear && <div className="ag-picked"><span className="ag-picked-tag">已套用</span><span className="hint">已将 Skill 目标与参数带入下方运行台</span><span className="spacer" /><button className="ghost tiny" onClick={onClear}>取消套用</button></div>}
    </div>
  );
}
