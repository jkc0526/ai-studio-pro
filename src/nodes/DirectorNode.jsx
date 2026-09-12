import { Handle, Position } from '@xyflow/react';
import { useCanvas } from '../context.js';

const SHOTS = [
  { v: 'orbit', label: '环绕运镜', hint: '相机绕主体做 360° 环绕' },
  { v: 'push', label: '推拉变焦', hint: '缓慢推近 / 拉远，突出主体' },
  { v: 'pan', label: '横移摇镜', hint: '水平平移，展示环境全貌' },
  { v: 'crane', label: '升降镜头', hint: '机位抬升 / 下降，交代空间' },
];

/* 3D 导演台：编排相机运动与空间关系，产出「运镜描述」供视频节点引用
   当前为编排台（生成结构化运镜提示词），3D 预览与实时渲染待后续接入。 */
export default function DirectorNode({ id, data, selected }) {
  const ctx = useCanvas();
  const shot = data.cameraShot || 'orbit';
  const cfg = SHOTS.find((s) => s.v === shot) || SHOTS[0];

  const apply = () => {
    const text = `【3D导演台】相机运动：${cfg.label}（${cfg.hint}）${data.subject ? `；主体：${data.subject}` : ''}${data.space ? `；空间：${data.space}` : ''}`;
    ctx.updateNode(id, { output: text });
    ctx.copy?.(text);
  };

  return (
    <div className={`oii-node oii-node-director ${selected ? 'on' : ''}`}>
      {selected && (
        <div className="oii-toolbar nodrag">
          <span className="oii-tb-tag">实验性</span>
          <button className="oii-tb oii-tb-text" onClick={() => ctx.deleteNode(id)}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
            </svg>
            删除
          </button>
        </div>
      )}

      <div className="oii-node-title">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />
        </svg>
        {data.label || '3D导演台'}
      </div>

      <div className="oii-card has-media" style={{ aspectRatio: '16 / 9' }}>
        <div className="oii-director-view">
          <div className="oii-director-grid" />
          <div className={`oii-director-cam oii-cam-${shot}`}>
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 7h11v10H3zM14 10l6-3v10l-6-3" />
            </svg>
          </div>
          <span className="oii-director-label">{cfg.label}</span>
        </div>
      </div>

      <div className="oii-prompt">
        <div className="oii-tabs nodrag">
          {SHOTS.map((s) => (
            <button key={s.v} className={`oii-tab ${shot === s.v ? 'on' : ''}`} title={s.hint}
              onClick={() => ctx.updateNode(id, { cameraShot: s.v })}>
              {s.label}
            </button>
          ))}
        </div>

        <input className="nodrag oii-line" value={data.subject || ''} placeholder="主体（如：沈昭昭 · 唐代官袍）"
          onChange={(e) => ctx.updateNode(id, { subject: e.target.value })} />
        <input className="nodrag oii-line" value={data.space || ''} placeholder="空间（如：金銮殿 · 御道纵深）"
          onChange={(e) => ctx.updateNode(id, { space: e.target.value })} />

        {data.output && <div className="oii-output">{data.output}</div>}

        <div className="oii-params">
          <span className="oii-hint">运镜描述可被下游视频节点引用</span>
          <span className="oii-spacer" />
          <button className="nodrag oii-apply" onClick={apply}>生成运镜描述</button>
        </div>
      </div>

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
