import assert from 'node:assert/strict';
import { getAutoLayoutPositions } from '../src/views/canvasLayout.js';

const nodes = [
  { id: 'script', type: 'textNode', position: { x: 400, y: 250 } },
  { id: 'image-a', type: 'imageNode', position: { x: 100, y: 900 } },
  { id: 'video-a', type: 'videoNode', position: { x: 800, y: 100 } },
  { id: 'image-b', type: 'imageNode', position: { x: 100, y: 100 } },
  { id: 'video-b', type: 'videoNode', position: { x: 800, y: 900 } },
];

const positions = getAutoLayoutPositions(nodes);
assert.equal(positions.get('image-a').x, positions.get('image-b').x,
  'all image nodes should share one vertical column');
assert.equal(positions.get('video-a').x, positions.get('video-b').x,
  'all video nodes should share one vertical column');
assert.equal(positions.get('video-a').x - positions.get('image-a').x, 560,
  'video column should sit beside the image column');
assert.equal(positions.get('script').x, positions.get('video-a').x + 560,
  'other node types should occupy a separate column');
assert.equal(Math.abs(positions.get('image-a').y - positions.get('image-b').y), 440,
  'images should be vertically spaced without overlap');
assert.equal(Math.abs(positions.get('video-a').y - positions.get('video-b').y), 440,
  'videos should be vertically spaced without overlap');
assert.deepEqual([...getAutoLayoutPositions([])], [], 'empty canvas should return no positions');

console.log('canvas auto-layout tests passed');
