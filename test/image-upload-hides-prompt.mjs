import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const imageNode = await readFile(new URL('../src/nodes/ImageNode.jsx', import.meta.url), 'utf8');

assert.match(imageNode, /sourceUrl:\s*url/, 'directly uploaded images should be distinguishable from generated images');
assert.match(imageNode, /\{!data\.sourceUrl\s*&&\s*<div className="oii-prompt">/,
  'uploading an image should hide the prompt and model controls while preserving the preview card');

console.log('uploaded image prompt visibility tests passed');
