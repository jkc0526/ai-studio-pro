import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getAutoConnectParams } from '../src/views/canvasConnections.js';

assert.deepEqual(getAutoConnectParams({
  connection: { nodeId: 'source-image', handleType: 'source', handleId: 'out' },
  nodeId: 'new-video',
  nodeType: 'videoNode',
}), {
  source: 'source-image',
  sourceHandle: 'out',
  target: 'new-video',
});

assert.deepEqual(getAutoConnectParams({
  connection: { nodeId: 'target-image', handleType: 'target', handleId: 'in' },
  nodeId: 'new-text',
  nodeType: 'textNode',
}), {
  source: 'new-text',
  target: 'target-image',
  targetHandle: 'in',
});

assert.equal(getAutoConnectParams({
  connection: { nodeId: 'source-text', handleType: 'source' },
  nodeId: 'new-note',
  nodeType: 'noteNode',
}), null, 'nodes without compatible handles should be added without an invalid edge');

const canvasView = await readFile(new URL('../src/views/CanvasView.jsx', import.meta.url), 'utf8');
assert.match(canvasView, /onConnectEnd=\{onConnectEnd\}/, 'dropping a wire should use React Flow connection-end handling');
assert.match(canvasView, /setPalette\(\{\s*flow:[\s\S]*?connection:/,
  'the same node picker should receive the wire drop location and starting connector');
assert.match(canvasView, /addNode\(item, palette\.flow, palette\.connection\)/,
  'choosing a module from the picker should create it at the drop point and pass the pending connector');

console.log('canvas wire-to-node tests passed');
