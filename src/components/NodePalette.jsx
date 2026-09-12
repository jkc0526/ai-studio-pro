import { useEffect, useState } from 'react';

/* 线性图标（按 OiiOii 截图风格，stroke 风格而非 emoji） */
const I = {
  note: 'M6 3h9l5 5v13H6zM15 3v5h5',
  text: 'M5 5h14M12 5v14M9 19h6',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M9 9.5a1 1 0 1 0 0-.01',
  video: 'M3 7h11v10H3zM14 10l6-3v10l-6-3',
  audio: 'M5 10v4M9 7v10M13 5v14M17 9v6M21 11v2',
  script: 'M4 5h16v14H4zM4 9h16M8 9v10M12 9v10M16 9v10',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  compose: 'M4 6h16M4 12h10M4 18h16M18 10l3 2-3 2',
  director: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
};

function Icon({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/* 双击空白处弹出的节点菜单（对齐 OiiOii：基础 / 工具 / 批量上传） */
export const NODE_MENU = [
  {
    key: 'basic',
    label: '基础',
    items: [
      { type: 'noteNode', label: '便签', icon: I.note },
      { type: 'textNode', label: '文本', icon: I.text },
      { type: 'imageNode', label: '图片', icon: I.image },
      { type: 'videoNode', label: '视频', desc: '首帧图或文本描述生成视频', icon: I.video },
      { type: 'audioNode', label: '音频', badge: 'BETA', icon: I.audio },
    ],
  },
  {
    key: 'tools',
    label: '工具',
    items: [
      { type: 'scriptNode', label: '分镜脚本', icon: I.script },
      { type: 'gridNode', label: '分镜格子', icon: I.grid },
      { type: 'composeNode', label: '视频合成', icon: I.compose },
      { type: 'directorNode', label: '3D导演台', icon: I.director },
    ],
  },
  {
    key: 'batch',
    label: '',
    items: [
      { type: 'batchUploadNode', label: '批量上传', desc: '批量导入图片或其他文件', icon: I.upload },
    ],
  },
];

/* 兼容旧引用 */
export const NODE_CATEGORIES = NODE_MENU;

const ALL_ITEMS = NODE_MENU.flatMap((c) => c.items);

export default function NodePalette({ open, onPick, onClose }) {
  const [q, setQ] = useState('');

  useEffect(() => { if (!open) setQ(''); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const searching = !!q.trim();
  const k = q.trim().toLowerCase();
  const hits = searching
    ? ALL_ITEMS.filter((i) => `${i.label} ${i.desc || ''}`.toLowerCase().includes(k))
    : [];

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        {searching && (
          <div className="palette-search">
            <input autoFocus placeholder="搜索节点…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}

        <div className="palette-body">
          {searching ? (
            <div className="palette-cat">
              {hits.length === 0 && <div className="palette-empty">无匹配节点</div>}
              {hits.map((it) => (
                <MenuRow key={it.type} item={it} onPick={onPick} />
              ))}
            </div>
          ) : (
            NODE_MENU.map((cat, ci) => (
              <div key={cat.key} className={`palette-cat ${ci > 0 ? 'palette-cat-gap' : ''}`}>
                {cat.label && <div className="palette-cat-head"><span>{cat.label}</span></div>}
                {cat.items.map((it) => (
                  <MenuRow key={it.type} item={it} onPick={onPick} />
                ))}
              </div>
            ))
          )}
        </div>

        {/* 底部搜索入口（点击展开搜索框） */}
        {!searching && (
          <button className="palette-search-hint" onClick={() => setQ(' ')}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" />
            </svg>
            搜索节点
          </button>
        )}
      </div>
    </>
  );
}

function MenuRow({ item, onPick }) {
  return (
    <button className="palette-item" onClick={() => onPick(item.type)}>
      <span className="palette-icon"><Icon d={item.icon} /></span>
      <span className="palette-meta">
        <span className="palette-title">
          {item.label}
          {item.badge && <em className="palette-badge">{item.badge}</em>}
        </span>
        {item.desc && <span className="palette-desc">{item.desc}</span>}
      </span>
    </button>
  );
}
