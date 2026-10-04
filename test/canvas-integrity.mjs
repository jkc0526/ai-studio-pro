import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCanvasTaskRows } from '../src/canvasTaskRows.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-canvas-integrity-'));
process.env.WEAVE_DATA_DIR = dataDir;
const { app } = await import('../server/index.js');
const { db, q } = await import('../server/db.js');
const realFetch = globalThis.fetch;
let server;
let modelCalls = 0;
let holdNextVideo = false;
let providerStarted;
let releaseProvider;

try {
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  globalThis.fetch = async (url, options) => {
    const value = String(url);
    if (value.startsWith(`${base}/`)) return realFetch(url, options);
    if (value.startsWith('https://mock.invalid/v1/')) {
      modelCalls += 1;
      if (holdNextVideo && value.includes('/video/generations')) {
        holdNextVideo = false;
        providerStarted?.();
        await new Promise((resolve) => { releaseProvider = resolve; });
      }
      const resultUrl = value.includes('/images/')
        ? 'https://mock.invalid/generated/image.png'
        : 'https://mock.invalid/generated/video.mp4';
      return new Response(JSON.stringify({ data: [{ url: resultUrl }], url: resultUrl }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value.startsWith('https://mock.invalid/generated/')) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'Content-Type': value.endsWith('.mp4') ? 'video/mp4' : 'image/png' },
      });
    }
    throw new Error(`Unexpected test request: ${value}`);
  };

  const request = async (route, body, method = 'POST') => {
    const response = await fetch(`${base}${route}`, body === undefined ? {} : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  q.run("UPDATE ai_config SET api_key = '', provider_id = NULL, custom_api_id = NULL");
  const configs = await request('/api/ai-config');
  assert.equal(configs.status, 200, 'settings remain readable before keys are entered');
  assert.equal(configs.body.data.length, 3);
  const save = await request('/api/ai-config/thinking', { model_id: 'draft-model' }, 'PUT');
  assert.equal(save.status, 200, 'partial configuration can be saved as a draft');
  assert.equal(q.one("SELECT model_id FROM ai_config WHERE purpose = 'thinking'").model_id, 'draft-model');

  q.run("UPDATE ai_config SET api_key = 'mock-key', base_url = 'https://mock.invalid/v1', model_id = 'mock-model'");
  const textRun = await request('/api/run', {
    stream: false,
    canvas: { nodes: [{ id: 'text', type: 'textNode', data: { content: 'local text' } }], edges: [] },
  });
  assert.equal(textRun.body.data.status, 'success');
  const loggedRun = textRun.body.data.runId;
  const runs = await request('/api/runs?limit=25');
  assert.ok(runs.body.data.some((run) => run.id === loggedRun));
  const jobs = await request('/api/jobs');
  const agentRuns = await request('/api/agent-runs');
  const rows = buildCanvasTaskRows(jobs.body.data, agentRuns.body.data, [], runs.body.data);
  assert.ok(rows.some((row) => row.id === `canvas:${loggedRun}`), 'canvas runs appear in the task center');

  const reference = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv0kAAAAASUVORK5CYII=';
  const imageRun = await request('/api/run', {
    stream: false,
    canvas: { nodes: [
      { id: 'reference', type: 'uploadNode', data: { kind: 'image', url: reference } },
      { id: 'generated', type: 'imageNode', data: { prompt: 'color the reference' } },
    ], edges: [{ id: 'link', source: 'reference', target: 'generated' }] },
    nodeIds: ['generated'],
  });
  assert.equal(imageRun.body.data.status, 'success', JSON.stringify(imageRun.body.data.errors));
  const imagePatch = imageRun.body.data.patches.find((patch) => patch.nodeId === 'generated' && patch.data.status === 'done');
  assert.match(imagePatch.data.imageUrl, /^\/outputs\/.*\.png$/);
  assert.notEqual(imagePatch.data.imageUrl, reference, 'reference must not replace the generated image');

  const script = await request('/api/scripts', { title: 'Test script' });
  const canvas = await request('/api/canvases', { title: 'Test canvas' });
  assert.equal(script.status, 200);
  assert.equal(canvas.status, 200);
  const videoRun = await request('/api/run', {
    stream: false,
    scriptId: script.body.data.id,
    canvasId: canvas.body.data.id,
    canvas: { nodes: [{ id: 'video', type: 'videoNode', data: { prompt: 'run', mode: 'text', duration: 5 } }], edges: [] },
  });
  assert.equal(videoRun.body.data.status, 'success', JSON.stringify(videoRun.body.data.errors));
  const videoPatch = videoRun.body.data.patches.find((patch) => patch.nodeId === 'video' && patch.data.status === 'done');
  assert.match(videoPatch.data.videoUrl, /^\/outputs\/.*\.mp4$/);
  const videoAsset = q.one("SELECT file_path FROM asset WHERE node_id = 'video' AND media_type = 'video'");
  assert.equal(videoAsset?.file_path, videoPatch.data.videoUrl, 'generated video must be indexed as video');
  assert.equal(q.one("SELECT COUNT(*) n FROM asset WHERE node_id = 'video' AND media_type = 'image'").n, 0);
  const projectMedia = await request(`/api/media?scriptId=${encodeURIComponent(script.body.data.id)}`);
  assert.ok(projectMedia.body.data.some((item) => item.kind === 'video'
    && item.file_path === videoPatch.data.videoUrl), 'canvas video must appear in the project media page');

  const providerWait = new Promise((resolve) => { providerStarted = resolve; });
  holdNextVideo = true;
  const streamResponse = await fetch(`${base}/api/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stream: true, scriptId: script.body.data.id, canvasId: canvas.body.data.id,
      canvas: { nodes: [{ id: 'video-stream', type: 'videoNode', data: { prompt: 'stream', mode: 'text' } }], edges: [] } }),
  });
  await providerWait;
  try {
    const inProgress = await request('/api/runs?limit=25');
    assert.ok(inProgress.body.data.some((run) => run.status === 'running' && run.canvas_id === canvas.body.data.id),
      'streaming canvas run must be visible while the provider is working');
  } finally {
    releaseProvider?.();
  }
  const events = await streamResponse.text();
  assert.match(events, /event: done/);
  assert.match(events, /"videoUrl":"\/outputs\/[^"\n]+\.mp4"/);
  assert.ok(q.one("SELECT id FROM asset WHERE node_id = 'video-stream' AND media_type = 'video'"),
    'streaming result also enters the asset library');
  const completed = await request('/api/runs?limit=25');
  assert.ok(completed.body.data.some((run) => run.status === 'success' && run.canvas_id === canvas.body.data.id));
  assert.equal(modelCalls, 3, 'only mock providers were called');
  console.log('canvas integrity tests passed');
} finally {
  globalThis.fetch = realFetch;
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
