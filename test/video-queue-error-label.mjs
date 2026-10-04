import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-video-error-'));
process.env.WEAVE_DATA_DIR = dataDir;
const { db } = await import('../server/db.js');
const { builtinSpec, execute } = await import('../server/endpoint.js');
const originalFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => ({
    ok: false, status: 503,
    text: async () => JSON.stringify({ message: 'video queue is full' }),
  });
  const spec = builtinSpec({ kind: 'video', protocol: 'openai-video',
    baseURL: 'http://127.0.0.1:9/v1', model: 'other-video-model',
    vars: { prompt: 'test', duration: 4 } });
  spec.queueFullRetryDelays = [];
  await assert.rejects(execute({ spec, apiKey: 'test', kind: 'video' }), (error) => {
    assert.equal(error.code, 'UPSTREAM_VIDEO_QUEUE_FULL');
    assert.match(error.message, /视频队列已满/);
    assert.doesNotMatch(error.message, /Agnes/, 'other providers must not be labeled Agnes');
    return true;
  });
  console.log('video queue error label tests passed');
} finally {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
