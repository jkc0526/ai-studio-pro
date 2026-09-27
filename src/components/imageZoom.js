export const MIN_IMAGE_SCALE = 1;
export const MAX_IMAGE_SCALE = 8;
export const IMAGE_ZOOM_FACTOR = 1.2;

export function getNextImageScale(scale, wheelDelta) {
  if (wheelDelta === 0) return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, scale));
  const next = wheelDelta < 0
    ? scale * IMAGE_ZOOM_FACTOR
    : scale / IMAGE_ZOOM_FACTOR;
  return Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, next));
}

export function zoomImageAtPoint(current, nextScale, point, origin = { x: 0, y: 0 }) {
  const ratio = nextScale / current.scale;
  return {
    scale: nextScale,
    x: point.x - origin.x - ((point.x - origin.x) - current.x) * ratio,
    y: point.y - origin.y - ((point.y - origin.y) - current.y) * ratio,
  };
}
