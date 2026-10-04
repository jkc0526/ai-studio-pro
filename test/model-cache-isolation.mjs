import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-model-cache-'));
process.env.WEAVE_DATA_DIR = dataDir;
const { app } = await import('../server/index.js');
const { db } = await import('../server/db.js');

const modelServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ data: [] }));
});
const appServer = await new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
await new Promise((resolve) => modelServer.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${appServer.address().port}`;
const modelBase = `http://127.0.0.1:${modelServer.address().port}/v1`;

try {
  const providers = [];
  for (const id of ['local-video-a', 'local-video-b']) {
    const response = await fetch(`${base}/api/providers`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: id, protocol: 'openai', base_url: modelBase,
        api_key: 'same-credential', models: [{ id, capability: 'video' }] }),
    });
    assert.equal(response.status, 200);
    providers.push((await response.json()).data.id);
  }

  const first = await (await fetch(`${base}/api/models?purpose=video&providerId=${providers[0]}`)).json();
  const second = await (await fetch(`${base}/api/models?purpose=video&providerId=${providers[1]}`)).json();
  assert.ok(first.data.list.includes('local-video-a'));
  assert.ok(second.data.list.includes('local-video-b'), 'another provider must show its own saved model');
  assert.ok(!second.data.list.includes('local-video-a'), 'another provider must not inherit a previous provider model');
  console.log('model cache isolation tests passed');
} finally {
  appServer.closeAllConnections();
  modelServer.closeAllConnections();
  await new Promise((resolve) => appServer.close(resolve));
  await new Promise((resolve) => modelServer.close(resolve));
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
