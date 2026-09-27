import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getNextImageScale, zoomImageAtPoint } from './imageZoom.js';

/* 图片/视频预览必须走 portal：画布节点带 transform，fixed 弹层不能挂在节点内部。 */
export default function MediaPreview({ item, onClose }) {
  const [imageView, setImageView] = useState({ scale: 1, x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const closeRef = useRef(null);

  const isImage = item?.type !== 'video';
  const isZoomed = imageView.scale > 1.001;

  useEffect(() => {
    if (!item) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [item]);

  useEffect(() => {
    setImageView({ scale: 1, x: 0, y: 0 });
    setIsDragging(false);
    dragRef.current = null;
    if (item?.type === 'image') closeRef.current?.focus();
  }, [item?.url, item?.type]);

  useEffect(() => {
    if (!item) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
        return;
      }
      if (!isImage || event.target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '')) return;
      if (event.key === '0') {
        event.preventDefault();
        setImageView({ scale: 1, x: 0, y: 0 });
        return;
      }
      if (!['+', '=', '-', '_'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['+', '='].includes(event.key) ? -1 : 1;
      const origin = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      setImageView((current) => {
        const scale = getNextImageScale(current.scale, direction);
        return zoomImageAtPoint(current, scale, origin, origin);
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, isImage, onClose]);

  const resetImageView = () => setImageView({ scale: 1, x: 0, y: 0 });

  const zoomFromCenter = (direction) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const origin = { x: rect.width / 2, y: rect.height / 2 };
    setImageView((current) => {
      const scale = getNextImageScale(current.scale, direction);
      return zoomImageAtPoint(current, scale, origin, origin);
    });
  };

  const handleWheel = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const origin = { x: rect.width / 2, y: rect.height / 2 };
    setImageView((current) => {
      const scale = getNextImageScale(current.scale, event.deltaY);
      if (scale === current.scale) return current;
      return zoomImageAtPoint(current, scale, point, origin);
    });
  };

  const handlePointerDown = (event) => {
    if (!isZoomed || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startView: imageView,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setImageView({
      ...drag.startView,
      x: drag.startView.x + event.clientX - drag.startX,
      y: drag.startView.y + event.clientY - drag.startY,
    });
  };

  const stopDragging = (event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (!item) return null;
  const title = item.key || '预览';

  return createPortal(
    <div
      className={`mp-mask${isImage ? ' mp-mask-image' : ''}`}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div
        className={`mp-panel${isImage ? ' mp-panel-image' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={isImage ? `${title}全屏图片查看器` : `${title}视频预览`}
      >
        <div className={`mp-head${isImage ? ' mp-head-image' : ''}`}>
          <b>{title}</b>
          {item.label && <span className="hint">{item.label}</span>}
          <span className="spacer" />
          <a
            className={isImage ? 'mp-image-control' : 'ghost tiny'}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            download
          >下载</a>
          <button
            ref={closeRef}
            className={isImage ? 'mp-image-control mp-image-close' : 'ghost tiny'}
            onClick={onClose}
            aria-label="关闭预览"
            title="关闭（Esc）"
          >×</button>
        </div>
        {isImage ? (
          <>
            <div className="mp-body mp-body-image">
              <div
                ref={stageRef}
                className={`mp-image-stage${isZoomed ? ' is-zoomed' : ''}${isDragging ? ' is-dragging' : ''}`}
                onWheel={handleWheel}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
                role="img"
                aria-label={title}
              >
                <div
                  className="mp-image-plane"
                  style={{ transform: `translate3d(${imageView.x}px, ${imageView.y}px, 0) scale(${imageView.scale})` }}
                >
                  <img src={item.url} alt={title} draggable="false" />
                </div>
              </div>
            </div>
            <div className="mp-foot mp-foot-image">
              <span className="hint">滚动滚轮缩放 · 放大后拖动查看 · Esc 关闭</span>
              <div className="mp-image-tools" aria-label="图片缩放控制">
                <button className="mp-image-control" onClick={() => zoomFromCenter(1)} disabled={!isZoomed} aria-label="缩小" title="缩小">−</button>
                <button className="mp-image-control mp-image-scale" onClick={resetImageView} aria-label="适应窗口" title="适应窗口">{Math.round(imageView.scale * 100)}%</button>
                <button className="mp-image-control" onClick={() => zoomFromCenter(-1)} disabled={imageView.scale >= 8} aria-label="放大" title="放大">＋</button>
                <button className="mp-image-control mp-image-fit" onClick={resetImageView}>适应窗口</button>
              </div>
            </div>
          </>
        ) : (
          <div className="mp-body">
            <video src={item.url} controls autoPlay loop />
          </div>
        )}
        {!isImage && <div className="mp-foot hint">点遮罩或按 Esc 关闭</div>}
      </div>
    </div>,
    document.body,
  );
}
