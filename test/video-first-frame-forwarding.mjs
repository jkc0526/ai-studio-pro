import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* 用临时数据目录，避免在测试进程里碰用户真实的 weave.db */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-ff-'));
process.env.WEAVE_DATA_DIR = dataDir;

const { builtinSpec } = await import('../server/endpoint.js');

const base = {
  kind: 'video',
  protocol: 'openai-video',
  baseURL: 'http://127.0.0.1:9788/v1',
  model: 'doubao-seedance-2-0-fast',
};

/* 1. 画布 VideoNode 的图生视频传的是 firstFrame（不是 image）。
      以前 openai-video 只认 image，首帧图被静默丢掉 —— 表现为"只传了文字、图没过去"。 */
const firstFrameSpec = builtinSpec({
  ...base,
  vars: { prompt: 'p', mode: 'keyframe', firstFrame: 'data:image/png;base64,AAA', seconds: 5, ratio: '16:9' },
});
assert.equal(firstFrameSpec.body.image, 'data:image/png;base64,AAA',
  'openai-video 必须把 firstFrame 当作 image 发出去');
assert.equal(firstFrameSpec.body.first_frame, undefined,
  'openai-video 走旧版单图格式，不该发 first_frame');
assert.equal(firstFrameSpec.body.prompt, 'p');
assert.equal(firstFrameSpec.body.aspect_ratio, '16:9');

/* 2. 分镜页传的是 image —— 行为必须保持不变 */
const imageSpec = builtinSpec({
  ...base,
  vars: { prompt: 'p', mode: 'keyframe', image: 'data:image/png;base64,BBB' },
});
assert.equal(imageSpec.body.image, 'data:image/png;base64,BBB');

/* 3. 同时给了 image 和 firstFrame 时，优先用 image（不改变既有优先级） */
const bothSpec = builtinSpec({
  ...base,
  vars: { prompt: 'p', mode: 'keyframe', image: 'IMG', firstFrame: 'FF' },
});
assert.equal(bothSpec.body.image, 'IMG');

/* 4. 文生视频不该凭空造出 image */
const textSpec = builtinSpec({
  ...base,
  vars: { prompt: 'p', mode: 'text' },
});
assert.equal(textSpec.body.image, undefined, '文生视频不应带 image');

/* 5. openai 协议（新版带 mode 的格式）仍然发 first_frame，且带 mode */
const openaiSpec = builtinSpec({
  ...base,
  protocol: 'openai',
  vars: { prompt: 'p', mode: 'keyframe', firstFrame: 'FF' },
});
assert.equal(openaiSpec.body.mode, 'keyframe');
assert.equal(openaiSpec.body.first_frame, 'FF');
assert.equal(openaiSpec.body.image, undefined, 'openai 协议走 first_frame，不该同时塞 image');

/* 6. 轮询地址与 id 取值保持契约不变 */
assert.equal(firstFrameSpec.url, 'http://127.0.0.1:9788/v1/video/generations');
assert.equal(firstFrameSpec.poll.url, 'http://127.0.0.1:9788/v1/videos/{{id}}');

/* sqlite 句柄还开着，临时目录删不掉属正常，交给系统清理即可 */
try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
console.log('video first-frame forwarding tests passed');
