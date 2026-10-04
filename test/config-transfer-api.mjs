import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

if (isMainThread) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weave-config-transfer-'));
  try {
    await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: dataDir });
      let result;
      worker.once('message', (message) => { result = message; });
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`config API test worker exited with code ${code}${result?.error ? `: ${result.error}` : ''}`));
        else if (result?.error) reject(new Error(result.error));
        else resolve();
      });
    });
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
} else {
  process.env.WEAVE_DATA_DIR = workerData;
  const { app } = await import('../server/index.js');
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const secret = 'secret-that-must-never-be-returned';
  try {
  const imported = await fetch(`${base}/api/config/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      app: 'infinite-canvas', version: 1,
      config: {
        baseUrl: 'http://127.0.0.1:9/v1', apiKey: secret, apiFormat: 'openai',
        channels: [{
          id: 'default', name: '迁移渠道', baseUrl: 'http://127.0.0.1:9/v1', apiKey: secret,
          models: [
            { id: 'gpt-image-2.5', capability: 'image' },
            { id: 'seedance2.5-video', capability: 'video', durationRange: { min: 4, max: 30 } },
          ],
        }],
        imageModel: 'gpt-image-2.5', videoModel: 'seedance2.5-video',
      },
    }),
  });
  const importPayload = await imported.json();
  assert.equal(imported.status, 200);
  assert.equal(importPayload.data.imported[0].models, 2);
  assert.equal(JSON.stringify(importPayload).includes(secret), false);

  const providersResponse = await fetch(`${base}/api/providers`);
  const providersPayload = await providersResponse.json();
  const provider = providersPayload.data.find((item) => item.name === '迁移渠道');
  assert.ok(provider);
  assert.equal(provider.has_key, false, 'import must never install an API key');

  const modelsResponse = await fetch(`${base}/api/models?purpose=video&providerId=${provider.id}`);
  const modelsPayload = await modelsResponse.json();
  assert.ok(modelsPayload.data.list.includes('seedance2.5-video'), 'saved model choices remain available without credentials');
  const defaultModels = await (await fetch(`${base}/api/models?purpose=video`)).json();
  assert.ok(defaultModels.data.list.includes('seedance2.5-video'), 'the configured provider also remains selectable without credentials');

  const exported = await fetch(`${base}/api/config/export`);
  const exportedPayload = await exported.json();
  const exportedText = JSON.stringify(exportedPayload);
  assert.equal(exportedPayload.data.app, 'weave-canvas');
  assert.equal(exportedText.includes(secret), false);
  assert.equal(exportedText.includes('customApis'), false);
  assert.equal(exportedText.includes('api_key'), false);
  console.log('configuration transfer API tests passed');
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ error: error.stack || error.message });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
