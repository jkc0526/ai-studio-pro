import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clampVideoDuration } from '../shared/videoCapabilities.js';

const modelRange = { min: 4, max: 15 };
assert.equal(clampVideoDuration(1, modelRange), 4);
assert.equal(clampVideoDuration(19, modelRange), 15);
assert.equal(clampVideoDuration(7.6, modelRange), 8);
assert.equal(clampVideoDuration('not-a-number', modelRange), 5);
assert.equal(clampVideoDuration(28, { min: 4, max: 30 }), 28);

const component = await readFile(new URL('../src/nodes/VideoNode.jsx', import.meta.url), 'utf8');
assert.match(component, /type="range"/);
assert.match(component, /type="number"/);
assert.match(component, /aria-expanded=\{durationOpen\}/);
assert.match(component, /aria-valuetext=/);
assert.doesNotMatch(component, /oii-video-duration-select/);

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.match(styles, /\.oii-duration-popover/);
assert.match(styles, /\.oii-duration-control/);

console.log('video duration control tests passed');
