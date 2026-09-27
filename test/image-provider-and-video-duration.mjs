import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-image-provider-duration-'));
process.env.WEAVE_DATA_DIR = tempDataDir;

const { clampVideoSeconds, runWorkflow } = await import('../server/engine.js');
const { q, db } = await import('../server/db.js');
const { modelKind } = await import('../server/video.js');
const timestamp = new Date().toISOString();
const addProvider = (id, name, baseUrl, protocol = 'openai') => q.run(
  'INSERT INTO provider (id,name,protocol,base_url,api_key,models_json,notes,enabled,create_time,update_time) VALUES (?,?,?,?,?,?,?,1,?,?)',
  id, name, protocol, baseUrl, `${id}-key`, '[]', '', timestamp, timestamp,
);

addProvider('image-default', 'Image default', 'https://image-default.test/v1');
addProvider('image-selected', 'Image selected', 'https://image-selected.test/v1', 'agnes-video');
addProvider('video-default', 'Video default', 'https://video-default.test/v1');
q.run('INSERT INTO ai_config (id,purpose,provider_id,base_url,api_key,model_id,update_time) VALUES (?,?,?,?,?,?,?)',
  'cfg_image', 'image_gen', 'image-default', 'https://image-default.test/v1', 'image-default-key', 'default-image', timestamp);
q.run('INSERT INTO ai_config (id,purpose,provider_id,base_url,api_key,model_id,update_time) VALUES (?,?,?,?,?,?,?)',
  'cfg_video', 'video', 'video-default', 'https://video-default.test/v1', 'video-default-key', 'seedance-2.5', timestamp);

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  const body = options.body instanceof FormData ? options.body : JSON.parse(options.body || '{}');
  calls.push({ url: requestUrl, body, auth: options.headers?.Authorization });
  if (requestUrl.endsWith('/images/generations') || requestUrl.endsWith('/images/edits')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ url: 'https://cdn.test/image.png' }] }) };
  }
  if (requestUrl.endsWith('/video/generations')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ url: 'https://cdn.test/video.mp4' }) };
  }
  if (requestUrl.startsWith('https://cdn.test/')) {
    return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      headers: { get: () => requestUrl.endsWith('.mp4') ? 'video/mp4' : 'image/png' } };
  }
  throw new Error(`Unexpected mocked request: ${requestUrl}`);
};

try {
  assert.equal(modelKind('imagen-4.0-generate'), 'image');
  assert.equal(modelKind('ideogram-v3'), 'image');
  assert.equal(clampVideoSeconds(20, 'seedance-2.0'), 15);
  assert.equal(clampVideoSeconds(25, 'seedance-2.5'), 25);
  assert.equal(clampVideoSeconds(25, 'other-video', { min: 4, max: 30 }), 25);

  const imageResult = await runWorkflow({
    nodes: [{ id: 'image-1', type: 'imageNode', data: {
      prompt: 'A film still', providerId: 'image-selected', modelId: 'custom-image-model', size: '1024x1024',
    } }],
    edges: [], targetIds: ['image-1'],
    configs: { image_gen: { purpose: 'image_gen', provider_id: 'image-default', base_url: 'https://image-default.test/v1',
      api_key: 'image-default-key', model_id: 'default-image' } },
  });
  const imageRequest = calls.find((call) => call.url.endsWith('/images/generations'));
  assert.equal(imageRequest?.url, 'https://image-selected.test/v1/images/generations');
  assert.equal(imageRequest?.auth, 'Bearer image-selected-key');
  assert.equal(imageRequest?.body?.model, 'custom-image-model');
  assert.equal(imageResult.status, 'success', JSON.stringify(imageResult));

  const referenceA = `data:image/png;base64,${Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]).toString('base64')}`;
  const referenceB = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 2]).toString('base64')}`;
  const editResult = await runWorkflow({
    nodes: [{ id: 'image-edit', type: 'imageNode', data: {
      prompt: '让 @图片1 的人物抱着 @图片2 的猫', providerId: 'image-default', modelId: 'gpt-image-2-vi', size: '2048x1152',
      mediaRefs: [
        { key: '图片1', type: 'image', url: referenceA },
        { key: '图片2', type: 'image', url: referenceB },
      ],
    } }],
    edges: [], targetIds: ['image-edit'],
    configs: { image_gen: { purpose: 'image_gen', provider_id: 'image-default', base_url: 'https://image-default.test/v1',
      api_key: 'image-default-key', model_id: 'default-image' } },
  });
  const imageEditRequest = calls.find((call) => call.url.endsWith('/images/edits'));
  assert.equal(imageEditRequest?.url, 'https://image-default.test/v1/images/edits', 'GPT Image references should use the image-edit endpoint');
  assert.equal(imageEditRequest?.body?.get('model'), 'gpt-image-2-vi');
  assert.equal(imageEditRequest?.body?.get('prompt'), '让 参考图1 的人物抱着 参考图2 的猫');
  assert.equal(imageEditRequest?.body?.get('size'), '2048x1152');
  assert.equal(imageEditRequest?.body?.getAll('image[]').length, 2, 'all mentioned reference images should be sent as image[] files');
  assert.equal(editResult.status, 'success', JSON.stringify(editResult));

  const videoResult = await runWorkflow({
    nodes: [{ id: 'video-1', type: 'videoNode', data: {
      prompt: 'A cinematic sequence', mode: 'text', modelId: 'seedance-2.5', duration: 25,
      durationRange: { min: 4, max: 30 },
    } }],
    edges: [], targetIds: ['video-1'],
    configs: { video: { purpose: 'video', provider_id: 'video-default', base_url: 'https://video-default.test/v1',
      api_key: 'video-default-key', model_id: 'seedance-2.5' } },
  });
  const videoRequest = calls.find((call) => call.url.endsWith('/video/generations'));
  assert.equal(videoRequest?.body?.duration, 25);
  assert.equal(videoRequest?.body?.seconds, undefined);
  assert.equal(videoResult.status, 'success');

  const { callVideo } = await import('../server/ai.js');
  const frame = 'data:image/png;base64,aGVsbG8=';
  await callVideo('video', { model: 'seedance-2.5-480', prompt: '让分镜图动起来', image: frame, duration: 5 });
  const seedanceShotRequest = [...calls].reverse().find((call) => call.url.endsWith('/video/generations'));
  assert.equal(seedanceShotRequest?.body?.mode, 'keyframe', 'legacy storyboard Seedance image requests must declare keyframe mode');
  assert.equal(seedanceShotRequest?.body?.first_frame, frame, 'Seedance keyframe requests must map legacy image to first_frame');
  assert.equal(seedanceShotRequest?.body?.image, undefined, 'Seedance mode-aware requests must not also send legacy image');

  await callVideo('video', { model: 'generic-video-model', prompt: 'keep the existing format', image: frame, duration: 5 });
  const genericShotRequest = [...calls].reverse().find((call) => call.url.endsWith('/video/generations'));
  assert.equal(genericShotRequest?.body?.image, frame, 'non-Seedance OpenAI-compatible models must keep the legacy image field');
  assert.equal(genericShotRequest?.body?.mode, undefined, 'do not inject mode for unrelated models');
  assert.equal(genericShotRequest?.body?.first_frame, undefined, 'do not inject first_frame for unrelated models');

  console.log('image provider routing and Seedance duration tests passed');
} finally {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(tempDataDir, { recursive: true, force: true });
}
