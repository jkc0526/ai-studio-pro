import assert from 'node:assert/strict';
import { getVideoDurationRange, getVideoDurationOptions } from '../shared/videoCapabilities.js';

assert.deepEqual(getVideoDurationRange('seedance-2.0'), { min: 4, max: 15, source: 'model' });
assert.deepEqual(getVideoDurationRange('seedance-2.5'), { min: 4, max: 30, source: 'model' });
assert.deepEqual(getVideoDurationRange('seedance-2-5-turbo'), { min: 4, max: 30, source: 'model' });
assert.deepEqual(getVideoDurationRange('other-video-model'), { min: 4, max: 12, source: 'default' });
assert.deepEqual(getVideoDurationRange('custom-video', { min: 6, max: 18 }), { min: 6, max: 18, source: 'provider' });
assert.deepEqual(getVideoDurationRange('custom-video', { duration_range: [5, 22] }), { min: 5, max: 22, source: 'provider' });
assert.deepEqual(getVideoDurationRange('custom-video', { supported_durations: [4, 8, 15] }), { min: 4, max: 15, source: 'provider' });
assert.deepEqual(getVideoDurationRange('custom-video', { capabilities: { video: { duration: { min: 8, max: 14 } } } }),
  { min: 8, max: 14, source: 'provider' });
assert.deepEqual(getVideoDurationOptions({ min: 4, max: 7 }), [4, 5, 6, 7]);
assert.equal(getVideoDurationRange('seedance-2.5', { min: 8, max: 10 }).max, 10);

console.log('video capability tests passed');
