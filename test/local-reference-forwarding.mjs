import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

if (isMainThread) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weave-local-reference-'));
  try {
    await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: dataDir });
      let result;
      worker.once('message', (message) => { result = message; });
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`reference forwarding worker exited ${code}${result?.error ? `: ${result.error}` : ''}`));
        else if (result?.error) reject(new Error(result.error));
        else resolve();
      });
    });
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
} else {
  process.env.WEAVE_DATA_DIR = workerData;
  const { OUTPUT_DIR } = await import('../server/db.js');
  const { builtinSpec, execute } = await import('../server/endpoint.js');
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03]);
  await fs.writeFile(path.join(OUTPUT_DIR, 'reference.png'), png);
  const received = [];
  const mock = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      received.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ url: `http://127.0.0.1:${mock.address().port}/result.mp4` }));
      return;
    }
    res.setHeader('content-type', 'video/mp4');
    res.end('mock-video');
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  const baseURL = `http://127.0.0.1:${mock.address().port}/v1`;
  try {
    const videoSpec = builtinSpec({
      kind: 'video', protocol: 'agnes-video', baseURL, model: 'agnes-video-2.5',
      vars: { prompt: '让参考图动起来', mode: 'keyframe', firstFrame: '/outputs/reference.png', seconds: 5 },
    });
    await execute({ spec: videoSpec, apiKey: 'test-key', kind: 'video', retry429: false });
    assert.equal(received[0].body.first_frame, png.toString('base64'), 'Agnes should receive raw base64 bytes, not a local path or data URI');

    const imageSpec = builtinSpec({
      kind: 'image', protocol: 'agnes-video', baseURL, model: 'agnes-image-2.5-flash',
      vars: { prompt: '根据参考图修改', image: '/outputs/reference.png', size: '1024x1024' },
    });
    await execute({ spec: imageSpec, apiKey: 'test-key', kind: 'image', retry429: false });
    assert.deepEqual(received[1].body.extra_body.image, [`data:image/png;base64,${png.toString('base64')}`], 'Agnes image editing should receive a data URI array in extra_body.image');
    assert.equal('image' in received[1].body, false, 'Agnes image editing must not put reference image in a top-level image field');

    const absoluteLocalImageSpec = builtinSpec({
      kind: 'image', protocol: 'openai', baseURL, model: 'agnes-image-2.5-flash',
      vars: { prompt: '根据参考图修改', image: `http://127.0.0.1:3001/outputs/reference.png?cache=1`, size: '1024x1024' },
    });
    await execute({ spec: absoluteLocalImageSpec, apiKey: 'test-key', kind: 'image', retry429: false });
    assert.deepEqual(received[2].body.extra_body.image, [`data:image/png;base64,${png.toString('base64')}`], 'absolute loopback /outputs URLs should be read locally and encoded, not sent as unreachable localhost URLs');

    const genericImageSpec = builtinSpec({
      kind: 'image', protocol: 'openai', baseURL, model: 'generic-image-edit-model',
      vars: { prompt: 'edit', image: '/outputs/reference.png', size: '1024x1024' },
    });
    await execute({ spec: genericImageSpec, apiKey: 'test-key', kind: 'image', retry429: false });
    assert.equal(received[3].body.image, `data:image/png;base64,${png.toString('base64')}`, 'other OpenAI-compatible image providers should retain the data URI field');
    const traversalSpec = builtinSpec({
      kind: 'video', protocol: 'agnes-video', baseURL, model: 'agnes-video-2.5',
      vars: { prompt: 'x', mode: 'keyframe', firstFrame: '/outputs/../weave.db', seconds: 5 },
    });
    await assert.rejects(() => execute({ spec: traversalSpec, apiKey: 'test-key', kind: 'video', retry429: false }), /本地地址无效/);
    assert.equal(received.length, 4, 'invalid paths must be rejected before contacting the model provider');
    console.log('local reference image forwarding tests passed');
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ error: error.stack || error.message });
  } finally {
    await new Promise((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
  }
}
