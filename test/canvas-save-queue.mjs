import assert from 'node:assert/strict';
import { createCanvasSaveQueue } from '../src/views/canvasSaveQueue.js';

const saved = [];
const states = [];
let failOnce = false;
const queue = createCanvasSaveQueue({
  delayMs: 20,
  save: async (snapshot) => {
    if (failOnce) { failOnce = false; throw new Error('disk unavailable'); }
    saved.push(snapshot);
  },
  onState: (state) => states.push(state),
});

queue.schedule({ canvasId: 'first', title: 'old' });
queue.schedule({ canvasId: 'first', title: 'latest' });
await queue.flush();
assert.deepEqual(saved.map((item) => item.title), ['latest'],
  'flush before navigation saves the newest snapshot exactly once');
assert.equal(queue.hasPending(), false);

failOnce = true;
queue.schedule({ canvasId: 'first', title: 'retry me' });
await assert.rejects(queue.flush(), /disk unavailable/);
assert.equal(queue.hasPending(), true, 'a failed save remains available for retry');
await queue.flush();
assert.deepEqual(saved.map((item) => item.title), ['latest', 'retry me']);

queue.schedule({ canvasId: 'second', title: 'on leave' });
await queue.flush();
assert.equal(saved.at(-1).title, 'on leave');
assert.ok(states.includes('unsaved') && states.includes('saved') && states.includes('error'));

let firstStarted;
let releaseFirst;
const started = new Promise((resolve) => { firstStarted = resolve; });
const concurrentStates = [];
const concurrentSaved = [];
const concurrentQueue = createCanvasSaveQueue({
  delayMs: 1000,
  save: async (snapshot) => {
    if (snapshot.title === 'old failure') {
      firstStarted();
      await new Promise((resolve) => { releaseFirst = resolve; });
      throw new Error('old save failed');
    }
    concurrentSaved.push(snapshot.title);
  },
  onState: (state) => concurrentStates.push(state),
});
concurrentQueue.schedule({ canvasId: 'one', title: 'old failure' });
const oldFlush = concurrentQueue.flush();
await started;
concurrentQueue.schedule({ canvasId: 'one', title: 'new edit' });
releaseFirst();
await assert.rejects(oldFlush, /old save failed/);
assert.equal(concurrentStates.at(-1), 'unsaved',
  'failure of an older snapshot must not mark newer edits as failed');
await concurrentQueue.flush();
assert.deepEqual(concurrentSaved, ['new edit']);
console.log('canvas save queue tests passed');
