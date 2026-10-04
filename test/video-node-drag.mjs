import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/nodes/VideoNode.jsx', import.meta.url), 'utf8');
const outputVideo = source.match(/<video src=\{data\.videoUrl\}[^>]*\/>/)?.[0];

assert.ok(outputVideo, 'video node renders its completed video');
assert.match(outputVideo, /\bcontrols\b/, 'video playback controls remain available');
assert.doesNotMatch(outputVideo, /className=["'][^"']*\bnodrag\b/,
  'the output video must not opt out of React Flow node dragging');
assert.match(source, /className=["']oii-refs nodrag["']/,
  'reference thumbnails keep nodrag behavior so their buttons remain clickable');

console.log('video node drag interaction tests passed');
