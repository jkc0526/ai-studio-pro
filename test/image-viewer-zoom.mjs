import assert from 'node:assert/strict';
import { getNextImageScale, zoomImageAtPoint } from '../src/components/imageZoom.js';

assert.equal(getNextImageScale(1, -100), 1.2, 'wheel up zooms in');
assert.equal(getNextImageScale(1.2, 100), 1, 'wheel down zooms out to fit');
assert.equal(getNextImageScale(1.2, 0), 1.2, 'a horizontal-only wheel event does not change zoom');
assert.equal(getNextImageScale(8, -100), 8, 'zoom is capped');
assert.equal(getNextImageScale(1, 100), 1, 'zoom cannot go below fit');

const current = { scale: 2, x: -100, y: -50 };
const pointer = { x: 300, y: 200 };
const zoomed = zoomImageAtPoint(current, 4, pointer);
assert.equal((pointer.x - current.x) / current.scale, (pointer.x - zoomed.x) / zoomed.scale,
  'image point under the pointer remains anchored horizontally');
assert.equal((pointer.y - current.y) / current.scale, (pointer.y - zoomed.y) / zoomed.scale,
  'image point under the pointer remains anchored vertically');

console.log('image viewer zoom math: passed');
