/**
 * 视频节点「缺少 mode 导致 400」修复的单元级验证（不发真实请求，只断言「请求体构造」）。
 *
 * 覆盖：
 *  1) builtinSpec(kind=video) 在前后端 4 种模式下的最终 body（Agnes Video 2.5 规范）
 *  2) engine 的输出收敛辅助函数（clampVideoSeconds / resolveVideoSize / pickRefUrls）
 *  3) 兼容性：显式 openai-video 协议与「未传 mode」的传统调用，不注入 mode（保护其它网关）
 */
import { builtinSpec, digFirstKey, probeModel } from '../server/endpoint.js';
import { clampVideoSeconds, resolveVideoSize, pickRefUrls, videoArgsForImage } from '../server/engine.js';
import { deepTestVars } from '../server/ai.js';

const BASE = 'https://apihub.agnes-ai.com/v1';
const MODEL = 'agnes-video-2.5-flash';

let pass = 0;
let fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  \u2705 ${name}`); }
  else { fail++; console.log(`  \u274c ${name}${extra ? `  ${extra}` : ''}`); }
};

const build = (vars, protocol = 'openai') => builtinSpec({ kind: 'video', protocol, baseURL: BASE, model: MODEL, vars }).body;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* engine.js 的映射结果（node.data.mode → Agnes mode + 媒体字段）人为还原成 vars */
const cases = [
  { ui: '文生视频', vars: { prompt: '一只猫在草地上奔跑', mode: 'text', seconds: 5, size: '720P', ratio: '16:9' } },
  { ui: '全能参考', vars: { prompt: '参考图1 中的角色缓缓起舞', mode: 'reference', images: ['https://x.test/a.png'], seconds: 5, size: '720P', ratio: '16:9' } },
  { ui: '图生视频', vars: { prompt: '参考图1 中的角色向前走动', mode: 'keyframe', firstFrame: 'https://x.test/a.png', seconds: 5, size: '720P', ratio: '16:9' } },
  { ui: '首尾帧', vars: { prompt: '参考图1 过渡到 参考图2', mode: 'keyframe', firstFrame: 'https://x.test/a.png', lastFrame: 'https://x.test/b.png', seconds: 5, size: '720P', ratio: '16:9' } },
];

console.log('== 1. 4 个模式的最终请求体 ==');
const bodies = {};
for (const c of cases) {
  const body = build(c.vars);
  bodies[c.ui] = body;
  console.log(`\n[${c.ui}] → ${JSON.stringify(body)}`);
}

console.log('\n== 2. 断言（Agnes Video 2.5 规范） ==');
const t = bodies['文生视频'];
const r = bodies['全能参考'];
const i = bodies['图生视频'];
const f = bodies['首尾帧'];

// mode 必填
check('text 模式带 mode=text', t.mode === 'text');
check('reference 模式带 mode=reference', r.mode === 'reference');
check('keyframe 模式带 mode=keyframe（图生视频）', i.mode === 'keyframe');
check('keyframe 模式带 mode=keyframe（首尾帧）', f.mode === 'keyframe');

// text：不得出现任何媒体字段
check('text 不含 images/first_frame/last_frame/audios',
  !has(t, 'images') && !has(t, 'first_frame') && !has(t, 'last_frame') && !has(t, 'audios'));

// reference：images 非空、不得出现 first_frame/last_frame
check('reference 携带 images:[url]', Array.isArray(r.images) && r.images.length === 1 && r.images[0] === 'https://x.test/a.png');
check('reference 不含 first_frame/last_frame', !has(r, 'first_frame') && !has(r, 'last_frame'));

// keyframe：first_frame（可选 last_frame）、不得出现 images/audios
check('图生视频 携带 first_frame', i.first_frame === 'https://x.test/a.png');
check('图生视频 不含 last_frame/images/audios', !has(i, 'last_frame') && !has(i, 'images') && !has(i, 'audios'));
check('首尾帧 同时携带 first_frame + last_frame', f.first_frame === 'https://x.test/a.png' && f.last_frame === 'https://x.test/b.png');
check('首尾帧 不含 images', !has(f, 'images'));

// seconds 字符串
check('seconds 以字符串下发', t.seconds === '5' && typeof t.seconds === 'string');
// 通用分支已按 QA 结论移除 size 注入（几乎所有网关对多余字段严格）
check('通用分支不再注入 size', !has(t, 'size'));
check('aspect_ratio 透传', t.aspect_ratio === '16:9');

console.log('\n== 3. 兼容性（不破坏其它网关） ==');
// 显式 openai-video 协议：不注入 mode，沿用最小请求体
const ov = build({ prompt: 'x', mode: 'text', image: 'https://x.test/a.png' }, 'openai-video');
check('openai-video 协议不注入 mode', !has(ov, 'mode'));
check('openai-video 协议保持旧版 image 字段', ov.image === 'https://x.test/a.png');

// 未传 mode 的传统调用（分镜/剧情片出视频走这里）：不注入 mode，只发 image
const legacy = build({ prompt: 'x', image: 'https://x.test/a.png', ratio: '9:16' });
check('未传 mode 时不注入 mode', !has(legacy, 'mode'));
check('未传 mode 时保留 image + aspect_ratio', legacy.image === 'https://x.test/a.png' && legacy.aspect_ratio === '9:16');

// 非法 mode 值：不注入（防止把未知枚举带给严格网关）
const bad = build({ prompt: 'x', mode: '__probe__' });
check('非法 mode 值被丢弃', !has(bad, 'mode'));

// 条件收敛：text 模式即便误传媒体，也不落到 body 里
const converged = build({ prompt: 'x', mode: 'text', images: ['u'], firstFrame: 'f', lastFrame: 'l', audios: ['a'] });
check('text 模式对不适用媒体字段做条件收敛',
  !has(converged, 'images') && !has(converged, 'first_frame') && !has(converged, 'last_frame') && !has(converged, 'audios'));

console.log('\n== 4. engine 参数收敛辅助函数 ==');
check('clampVideoSeconds(3) → 4（AGNES 下限）', clampVideoSeconds(3) === 4);
check('clampVideoSeconds(20) → 12（AGNES 上限）', clampVideoSeconds(20) === 12);
check('clampVideoSeconds(undefined) → 5（默认）', clampVideoSeconds(undefined) === 5);
check('clampVideoSeconds("7") → 7', clampVideoSeconds('7') === 7);
check("resolveVideoSize('720p') → '720P'", resolveVideoSize('720p') === '720P');
check("resolveVideoSize('1080p') → '720P'（回落到受支持值）", resolveVideoSize('1080p') === '720P');
check("resolveVideoSize('2k') → '2K'", resolveVideoSize('2k') === '2K');
check('resolveVideoSize(undefined) → 720P（默认）', resolveVideoSize(undefined) === '720P');

console.log('\n== 5. pickRefUrls：@图片N 引用顺序 / 连线顺序 / 多张图 ==');
const refs = [
  { key: '图片1', type: 'image', url: 'https://x.test/1.png' },
  { key: '图片2', type: 'image', url: 'https://x.test/2.png' },
  { key: '图片3', type: 'image', url: 'https://x.test/3.png' },
];
const node = { data: { mediaRefs: refs } };
check('无 mention → 按连线顺序返回全部', JSON.stringify(pickRefUrls(node, '', [], 'image')) === JSON.stringify(['https://x.test/1.png', 'https://x.test/2.png', 'https://x.test/3.png']));
check('@图片2 @图片1 → 按引用顺序', JSON.stringify(pickRefUrls(node, '@图片2 @图片1', [], 'image')) === JSON.stringify(['https://x.test/2.png', 'https://x.test/1.png']));
check('无 mediaRefs → 回落上游最后一张图', JSON.stringify(pickRefUrls({ data: {} }, '', [{ type: 'uploadNode', _output: { url: 'https://x.test/up.png' } }], 'image')) === JSON.stringify(['https://x.test/up.png']));

console.log('\n== 6. videoArgsForImage：分镜 / 剧情片出片的统一入参 ==');
// 单镜有图 → keyframe + first_frame
const shotWithImg = videoArgsForImage({ image: 'data:image/png;base64,AAAA', duration: 5, ratio: '9:16' });
check('单镜有图 → mode=keyframe', shotWithImg.mode === 'keyframe');
check('单镜有图 → first_frame=图', shotWithImg.firstFrame === 'data:image/png;base64,AAAA');
check('单镜有图 → 不产出 image 字段（避免 image 与 first_frame 同时出现）', !has(shotWithImg, 'image'));

// 单镜无图 → text
const shotNoImg = videoArgsForImage({ image: null, duration: 5 });
check('单镜无图 → mode=text', shotNoImg.mode === 'text');
check('单镜无图 → 无 first_frame / image', !shotNoImg.firstFrame && !has(shotNoImg, 'image'));

// 时长 / size 复用 engine 收敛
check('videoArgsForImage 时长下限收敛（3→4）', videoArgsForImage({ image: null, duration: 3 }).duration === 4);
check('videoArgsForImage 时长上限收敛（20→12）', videoArgsForImage({ image: null, duration: 20 }).duration === 12);
check('videoArgsForImage size 默认 720P', videoArgsForImage({ image: null }).size === '720P');

// 批量混合：有图 / 无图镜头共存，各自 mode 独立判定
const batch = [
  { seq: 1, image: 'https://x.test/1.png' },
  { seq: 2, image: null },
  { seq: 3, image: 'https://x.test/3.png' },
];
const batchArgs = batch.map((s) => ({ seq: s.seq, ...videoArgsForImage({ image: s.image, duration: 5 }) }));
check('批量混合：镜头1 → keyframe', batchArgs[0].mode === 'keyframe');
check('批量混合：镜头2 → text', batchArgs[1].mode === 'text');
check('批量混合：镜头3 → keyframe', batchArgs[2].mode === 'keyframe');
check('批量混合：各自媒体字段正确', batchArgs[0].firstFrame === 'https://x.test/1.png'
  && !batchArgs[1].firstFrame
  && batchArgs[2].firstFrame === 'https://x.test/3.png');

// 端到端：出片入参 → builtinSpec 最终 body 检查
const shotBody = build({ prompt: '镜头1', ...videoArgsForImage({ image: 'https://x.test/1.png', duration: 5, ratio: '9:16' }) });
check('shot 有图 → body.mode=keyframe 且仅 first_frame（无 image / images）',
  shotBody.mode === 'keyframe'
  && shotBody.first_frame === 'https://x.test/1.png'
  && !has(shotBody, 'image')
  && !has(shotBody, 'images'));
const shotTextBody = build({ prompt: '镜头2', ...videoArgsForImage({ image: null, duration: 5 }) });
check('shot 无图 → body.mode=text 且无任何媒体字段',
  shotTextBody.mode === 'text'
  && !has(shotTextBody, 'first_frame')
  && !has(shotTextBody, 'image'));

console.log('\n== 7. agnes-video 独立协议（POST /videos + GET /agnesapi） ==');
const agnes = (vars) => builtinSpec({ kind: 'video', protocol: 'agnes-video', baseURL: BASE, model: MODEL, vars });

const aText = agnes({ prompt: '一只猫', mode: 'text', seconds: 5, ratio: '16:9' });
console.log(`\n[agnes text]  url=${aText.url}\n  body=${JSON.stringify(aText.body)}\n  poll=${aText.poll.url}\n  resultPath=${aText.poll.resultPath}`);
const aRef = agnes({ prompt: 'p', mode: 'reference', images: ['https://x.test/a.png'], seconds: 5, ratio: '16:9' });
console.log(`[agnes reference]  body=${JSON.stringify(aRef.body)}`);
const aKey = agnes({ prompt: 'p', mode: 'keyframe', firstFrame: 'https://x.test/a.png', seconds: 5, ratio: '16:9' });
console.log(`[agnes keyframe]   body=${JSON.stringify(aKey.body)}`);

// 端点 / 结构
check('agnes url 指向官方端点 /videos', aText.url === `${BASE}/videos`);
check('agnes poll.url 形如 /agnesapi?video_id={{id}}&model_name=<model>',
  aText.poll.url === `https://apihub.agnes-ai.com/agnesapi?video_id={{id}}&model_name=${MODEL}`);
// QA 用线上真实完成响应实测：产物地址在顶层 url（无 metadata 层）
check('agnes poll.resultPath = url（顶层，真实响应字段）', aText.poll.resultPath === 'url');
check('agnes poll 节奏 1500ms × 240', aText.poll.interval === 1500 && aText.poll.max === 240);
check('agnes id 提取优先 video_id → id → task_id',
  JSON.stringify(aText.idKeys) === JSON.stringify(['video_id', 'id', 'task_id']));

// text
check('agnes text → body.mode=text', aText.body.mode === 'text');
check('agnes text → 绝不注入 size', !has(aText.body, 'size'));
check('agnes text → 不含任何媒体字段',
  !has(aText.body, 'images') && !has(aText.body, 'first_frame') && !has(aText.body, 'last_frame') && !has(aText.body, 'audios'));
check('agnes seconds 以字符串下发', aText.body.seconds === '5' && typeof aText.body.seconds === 'string');
check('agnes aspect_ratio 透传', aText.body.aspect_ratio === '16:9');

// reference
check('agnes reference → mode=reference + images[]',
  aRef.body.mode === 'reference' && Array.isArray(aRef.body.images) && aRef.body.images[0] === 'https://x.test/a.png');
check('agnes reference → 无 size / 无 first_frame',
  !has(aRef.body, 'size') && !has(aRef.body, 'first_frame'));

// keyframe
check('agnes keyframe → mode=keyframe + first_frame',
  aKey.body.mode === 'keyframe' && aKey.body.first_frame === 'https://x.test/a.png');
check('agnes keyframe → 无 size / 无 images',
  !has(aKey.body, 'size') && !has(aKey.body, 'images'));

// seconds 收敛（缺失/越界）
check('agnes seconds 越界收敛（3→4）', agnes({ prompt: 'p', mode: 'text', seconds: 3 }).body.seconds === '4');
check('agnes seconds 越界收敛（20→12）', agnes({ prompt: 'p', mode: 'text', seconds: 20 }).body.seconds === '12');
check('agnes 未提供 seconds → body 不含 seconds', !has(agnes({ prompt: 'p', mode: 'text' }).body, 'seconds'));

// 缺失 / 非法 mode → 直接抛错（不发请求）
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
check('agnes 缺失 mode → 抛错', throws(() => agnes({ prompt: 'p' })));
check('agnes 非法 mode → 抛错', throws(() => agnes({ prompt: 'p', mode: '__probe__' })));

// id 提取：按优先级，且不误取 progress / status
const d1 = digFirstKey({ id: 'x123456', task_id: 't999999', video_id: 'v777777', progress: 50, status: 'queued' }, ['video_id', 'id', 'task_id']);
check('digFirstKey 优先取 video_id', d1 === 'v777777');
check('digFirstKey 回落 id', digFirstKey({ id: 'x123456', task_id: 't999999' }, ['video_id', 'id', 'task_id']) === 'x123456');
check('digFirstKey 回落 task_id', digFirstKey({ task_id: 't999999' }, ['video_id', 'id', 'task_id']) === 't999999');
check('digFirstKey 不误取 progress / status', digFirstKey({ progress: 50, status: 'queued' }, ['video_id', 'id', 'task_id']) === null);

// 通用分支回归：size 已移除
const genOpenai = build({ prompt: 'p', mode: 'text', seconds: 5, size: '720P', ratio: '16:9' });
check('通用 openai 分支不含 size', !has(genOpenai, 'size'));
check('通用 openai 分支仍保留 mode（其它聚合网关需要）', genOpenai.mode === 'text');
const genOv = build({ prompt: 'p', mode: 'text', seconds: 5, size: '720P', image: 'https://x.test/a.png' }, 'openai-video');
check('openai-video 分支不含 size', !has(genOv, 'size'));
check('openai-video 分支不含 mode', !has(genOv, 'mode'));

console.log('\n== 8. ai.js 深度测试探活 + probeModel 的 agnes-video 适配 ==');
// 8.1 深度测试：agnes-video 补 mode='text'，通用视频协议不带 mode（回归）
const dvAgnes = deepTestVars('video', 'agnes-video');
check("deepTestVars('video','agnes-video') 含 mode='text'", dvAgnes.mode === 'text');
const dvAgnesBody = builtinSpec({ kind: 'video', protocol: 'agnes-video', baseURL: BASE, model: MODEL, vars: dvAgnes }).body;
console.log(`  [深度测试 agnes-video]  body=${JSON.stringify(dvAgnesBody)}`);
check("agnes-video 探活 body 含 mode='text'", dvAgnesBody.mode === 'text');
check('agnes-video 探活 body 不含 size', !has(dvAgnesBody, 'size'));
const dvGenBody = builtinSpec({ kind: 'video', protocol: 'openai', baseURL: BASE, model: MODEL, vars: deepTestVars('video', 'openai') }).body;
console.log(`  [深度测试 通用视频]    body=${JSON.stringify(dvGenBody)}`);
check('通用视频探活 body 不含 mode（回归）', !has(dvGenBody, 'mode'));
check('通用视频探活 body 不含 size（回归）', !has(dvGenBody, 'size'));

// 8.2 probeModel 端点按协议区分（mock fetch，离线；不发真实请求）
const realFetch = globalThis.fetch;
const captured = [];
globalThis.fetch = async (url) => {
  captured.push(String(url));
  return { ok: true, status: 200, text: async () => '{}' };
};
try {
  await probeModel({ kind: 'video', baseURL: BASE, apiKey: 'k', model: MODEL, protocol: 'agnes-video' });
  await probeModel({ kind: 'video', baseURL: BASE, apiKey: 'k', model: MODEL, protocol: 'openai' });
} finally {
  globalThis.fetch = realFetch;
}
console.log(`  [probeModel] agnes-video → ${captured[0]}\n  [probeModel] 通用视频   → ${captured[1]}`);
check('probeModel(agnes-video) URL = /videos', captured[0] === `${BASE}/videos`, captured[0]);
check('probeModel(通用视频) URL = /video/generations（回归）', captured[1] === `${BASE}/video/generations`, captured[1]);

// 8.3 probeModel 状态分类：503(queue full) 归入 limited（避免误报不可用），且不放宽真·不可用
console.log('\n== 8.3 probeModel 状态分类（mock fetch，离线） ==');
const probeWith = async (status, bodyText) => {
  const keep = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: status >= 200 && status < 300, status, text: async () => bodyText });
  try {
    return await probeModel({ kind: 'video', baseURL: BASE, apiKey: 'k', model: MODEL, protocol: 'agnes-video' });
  } finally {
    globalThis.fetch = keep;
  }
};
const p503 = await probeWith(503, '{"message":"queue is full"}');
console.log(`  503(queue full) → state=${p503.state}（${p503.detail}）`);
check('probeModel 503 → limited（稍后重试，不误报为不可用）', p503.state === 'limited');
const p429 = await probeWith(429, 'rate limited');
check('probeModel 429 → limited（回归）', p429.state === 'limited');
const p503blocked = await probeWith(503, '{"error":{"message":"No available channel for model"}}');
console.log(`  503(No available channel) → state=${p503blocked.state}`);
check('probeModel 503 但正文为 No available channel → 仍判 blocked（未放宽真·不可用）', p503blocked.state === 'blocked');
const p404 = await probeWith(404, '{"error":{"message":"model_not_found"}}');
check('probeModel 404 model_not_found → blocked（回归）', p404.state === 'blocked');

console.log(`\n===== 结果：${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
