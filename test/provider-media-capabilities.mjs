import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { providerSupportsMedia } from '../shared/providerCapabilities.js';

const deepseek = {
  id: 'deepseek', name: 'DeepSeek', protocol: 'openai', base_url: 'https://api.deepseek.com/v1', models: [],
};
assert.equal(providerSupportsMedia(deepseek, 'image'), false, 'DeepSeek text-only should not appear for image generation');
assert.equal(providerSupportsMedia(deepseek, 'video'), false, 'DeepSeek text-only should not appear for video generation');

assert.equal(providerSupportsMedia({ name: 'Custom Gateway', models: ['deepseek-chat'] }, 'image'), false);
assert.equal(providerSupportsMedia({ name: 'Mixed Gateway', models: ['gpt-4o', 'flux-pro'] }, 'image'), true);
assert.equal(providerSupportsMedia({ name: 'Mixed Gateway', models: ['gpt-4o', 'flux-pro'] }, 'video'), false);
assert.equal(providerSupportsMedia({ name: 'Video Gateway', models: ['seedance-2.0'] }, 'video'), true);
assert.equal(providerSupportsMedia({ name: 'User Gateway', models: [] }, 'image'), true, 'unknown empty model lists retain existing compatibility behavior');

const imageNode = await readFile(new URL('../src/nodes/ImageNode.jsx', import.meta.url), 'utf8');
const videoNode = await readFile(new URL('../src/nodes/VideoNode.jsx', import.meta.url), 'utf8');
assert.match(imageNode, /providerSupportsMedia\(p, 'image'\)/, 'image provider choices must use image capability filtering');
assert.match(videoNode, /providerSupportsMedia\(p, 'video'\)/, 'video provider choices must use video capability filtering');

console.log('provider media capability tests passed');
