import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const textNode = await readFile(new URL('../src/nodes/TextNode.jsx', import.meta.url), 'utf8');
const canvasView = await readFile(new URL('../src/views/CanvasView.jsx', import.meta.url), 'utf8');

assert.match(textNode, /aria-label="文本大模型"/, 'the text node should expose a selectable model');
assert.match(textNode, /ctx\.runNode\(id\)/, 'the text node should have an explicit process action');
assert.match(textNode, /data\.output/, 'the text node should render processed output');
assert.match(canvasView, /textModels:\s*modelGroups\?\.text/, 'configured text models should reach canvas nodes');
assert.match(canvasView, /onEvent: \(\{ event, data \}\)/, 'text node execution results should flow through the canvas event handler');

console.log('text node model picker UI tests passed');
