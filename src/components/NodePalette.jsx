import { useEffect, useMemo, useState } from 'react';

/* 节点面板：双击空白处 / 点击 + 按钮时弹出，按类别列出可添加的节点 */
export const NODE_CATEGORIES = [
  {
    key: 'input',
    label: '添加节点',
    hint: '从这些来源开始',
    items: [
      { type: 'textNode', label: '文本', desc: '小说 / 剧本 / 提示词原文', icon: '📝' },
      { type: 'uploadNode', label: '上传', desc: '本地图片或视频作为输入', icon: '⬆️' },
      { type: 'assetNode', label: '从素材库选择', desc: '复用已生成的图像/视频', icon: '🗂️' },
      { type: 'scriptNode', label: '脚本', desc: '引用现有剧本正文', icon: '📜' },
    ],
  },
  {
    key: 'gen',
    label: '生成',
    hint: '调用 AI 模型产出内容',
    items: [
      { type: 'llmNode', label: '大模型', desc: '用提示词生成文本（剧本/分镜/重写）', icon: '🧠' },
      { type: 'imageNode', label: '图像生成', desc: '从描述生成单张图片', icon: '🎨' },
      { type: 'gridNode', label: '九宫格', desc: '同一提示词生成 4 / 9 / 25 张备选', icon: '🟪' },
      { type: 'videoNode', label: '视频', desc: '图生视频（需要上游图片）', icon: '🎬' },
      { type: 'audioNode', label: '音频', desc: '占位节点，网关暂无 TTS', icon: '🔊' },
    ],
  },
  {
    key: 'tools',
    label: '添加工具',
    hint: '流程化处理',
    items: [
      { type: 'noteNode', label: '备注', desc: '黄色便利贴，写思路或待办', icon: '📌' },
    ],
  },
];

const ALL_ITEMS = NODE_CATEGORIES.flatMap((c) => c.items.map((i) => ({ ...i, category: c.key })));

export default function NodePalette({ open, onPick, onClose }) {
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    if (!q.trim()) return ALL_ITEMS;
    const k = q.toLowerCase();
    return ALL_ITEMS.filter((i) => i.label.toLowerCase().includes(k) || i.desc.toLowerCase().includes(k));
  }, [q]);

  if (!open) return null;

  return (
    <>
      <div className="palette-backdrop" onClick={onClose} />
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-head">
          <span>添加节点</span>
          <button className="ghost" onClick={onClose}>×</button>
        </div>
        <div className="palette-search">
          <input autoFocus placeholder="搜索节点…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="palette-body">
          {q.trim() ? (
            <div className="palette-cat">
              {filtered.length === 0 && <div className="palette-empty">无匹配节点</div>}
              {filtered.map((it) => (
                <button key={it.type} className="palette-item" onClick={() => onPick(it.type)}>
                  <span className="palette-icon">{it.icon}</span>
                  <span className="palette-meta">
                    <span className="palette-title">{it.label}</span>
                    <span className="palette-desc">{it.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            NODE_CATEGORIES.map((cat) => (
              <div key={cat.key} className="palette-cat">
                <div className="palette-cat-head">
                  <span>{cat.label}</span>
                  <span className="palette-cat-hint">{cat.hint}</span>
                </div>
                {cat.items.map((it) => (
                  <button key={it.type} className="palette-item" onClick={() => onPick(it.type)}>
                    <span className="palette-icon">{it.icon}</span>
                    <span className="palette-meta">
                      <span className="palette-title">{it.label}</span>
                      <span className="palette-desc">{it.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}