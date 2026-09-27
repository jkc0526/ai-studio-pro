import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [styles, imageNode, videoNode] = await Promise.all([
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/ImageNode.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/VideoNode.jsx', import.meta.url), 'utf8'),
]);

const cssRule = (selector) => styles.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] || '';
const widthOf = (rule) => rule.match(/\bwidth:\s*([^;]+)/)?.[1]?.trim();
const cardWidth = widthOf(cssRule('.oii-card'));
const titleRule = cssRule('.oii-node-title');

assert.ok(cardWidth, 'media card should have a stable width');
assert.equal(widthOf(titleRule), cardWidth, 'image and video titles should align to the same media-card edge');
assert.match(titleRule, /align-self:\s*center/, 'title should use the media card center line, not the wider video node edge');
assert.match(titleRule, /min-height:\s*18px/, 'image and video header rows should reserve the same height');

assert.match(imageNode, /data\.status === 'running'\s*&&\s*<GenerationLoading media="图片"\s*\/>/,
  'image generation should show a loading overlay while a task is running');
assert.match(videoNode, /data\.status === 'running'\s*&&\s*<GenerationLoading media="视频"\s*\/>/,
  'video generation should use the same loading treatment');
for (const [name, source] of [['image', imageNode], ['video', videoNode]]) {
  assert.match(source, /aria-busy=\{data\.status === 'running'\}/, `${name} card should expose its busy state`);
}
assert.match(styles, /\.oii-loading-progress[\s\S]*?animation:/, 'loading state should include an indeterminate progress animation');
assert.match(styles, /prefers-reduced-motion:\s*reduce/, 'loading animation should respect reduced-motion preferences');

console.log('image/video node alignment and loading checks passed');
