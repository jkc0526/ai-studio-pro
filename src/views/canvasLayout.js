const COLUMN_WIDTH = 560;
const ROW_HEIGHT = 440;

const compareByCanvasPosition = (a, b) =>
  (a.position?.y ?? 0) - (b.position?.y ?? 0)
  || (a.position?.x ?? 0) - (b.position?.x ?? 0);

/** Assign media nodes to dedicated vertical lanes and keep remaining nodes separate. */
export function getAutoLayoutPositions(nodes) {
  const positions = new Map();
  if (!nodes.length) return positions;

  const originX = Math.min(...nodes.map((node) => node.position?.x ?? 0));
  const originY = Math.min(...nodes.map((node) => node.position?.y ?? 0));
  const lanes = [
    nodes.filter((node) => node.type === 'imageNode').sort(compareByCanvasPosition),
    nodes.filter((node) => node.type === 'videoNode').sort(compareByCanvasPosition),
    nodes.filter((node) => node.type !== 'imageNode' && node.type !== 'videoNode')
      .sort(compareByCanvasPosition),
  ];

  lanes.forEach((lane, column) => {
    lane.forEach((node, row) => {
      positions.set(node.id, {
        x: Math.round(originX + column * COLUMN_WIDTH),
        y: Math.round(originY + row * ROW_HEIGHT),
      });
    });
  });

  return positions;
}
