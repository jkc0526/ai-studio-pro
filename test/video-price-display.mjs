import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatVideoModelPrice } from '../shared/videoCapabilities.js';

assert.equal(formatVideoModelPrice({
  pricing: { video: { price: 1.5, currency: 'CNY', unit: 'generation' } },
}), '¥1.5/次');
assert.equal(formatVideoModelPrice({
  price_per_second: 0.2, currency: 'CNY', unit: 'second',
}), '¥0.2/秒');
assert.equal(formatVideoModelPrice({
  pricing: { video: { per_call: { amount: '1.25', currency: 'CNY' } } },
}), '¥1.25/次');
assert.equal(formatVideoModelPrice({ price: '¥1.50/次' }), '¥1.5/次');
assert.equal(formatVideoModelPrice({ pricing: { prompt: '0.0001', completion: '0.0005' } }), null,
  'text token prices are not video generation prices');
assert.equal(formatVideoModelPrice({ id: 'video-model' }), null);

const videoNode = await readFile(new URL('../src/nodes/VideoNode.jsx', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
assert.match(videoNode, /oii-video-price/, 'the selected video model price should render in the video controls');
assert.match(videoNode, /modelPrices\[durationModel\]/, 'displayed price follows the selected video model');
assert.match(app, /videoPrices:.*modelPrices/, 'video prices should pass through app model state');
assert.match(server, /formatVideoModelPrice\(record\)/, 'prices should be read from upstream model records');

console.log('video model price display tests passed');
