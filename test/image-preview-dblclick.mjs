import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/nodes/ImageNode.jsx', import.meta.url), 'utf8');
const resultImage = source.match(/<img\s+src=\{data\.imageUrl\}[\s\S]*?\/>/);

assert.ok(resultImage, '图片节点应渲染生成结果图片');
assert.match(resultImage[0], /onDoubleClick=/, '双击生成结果图片应打开预览');
assert.match(resultImage[0], /stopPropagation/, '双击预览不应触发画布其他双击行为');
assert.match(resultImage[0], /setPreview\(/, '双击应复用图片预览弹窗');
assert.match(resultImage[0], /draggable=\{false\}/, '拖动画布或节点时图片不应被浏览器单独拖出');
assert.doesNotMatch(resultImage[0], /className="[^"]*\bnodrag\b/, '图片上的拖动应移动画布节点，不应阻断 React Flow 拖动');

console.log('图片节点双击预览回归检查通过');
