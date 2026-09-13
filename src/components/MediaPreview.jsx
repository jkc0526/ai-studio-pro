import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/* 图片/视频放大预览（点击缩略图打开，点遮罩或 Esc 关闭）
   必须走 portal 挂到 body：画布节点带着 transform，position:fixed 会被节点当成定位祖先 */
export default function MediaPreview({ item, onClose }) {
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, onClose]);

  if (!item) return null;
  const isVideo = item.type === 'video';
  return createPortal(
    <div className="mp-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="mp-panel">
        <div className="mp-head">
          <b>{item.key || '预览'}</b>
          {item.label && <span className="hint">{item.label}</span>}
          <span className="spacer" />
          <a className="ghost tiny" href={item.url} target="_blank" rel="noreferrer" download>下载</a>
          <button className="ghost tiny" onClick={onClose}>×</button>
        </div>
        <div className="mp-body">
          {isVideo
            ? <video src={item.url} controls autoPlay loop />
            : <img src={item.url} alt={item.key || ''} />}
        </div>
        <div className="mp-foot hint">点遮罩或按 Esc 关闭</div>
      </div>
    </div>,
    document.body,
  );
}
