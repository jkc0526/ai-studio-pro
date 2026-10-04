/**
 * QA Round2 独立复验：agnes-video 独立协议（修复 size 400 + 轮询取不到结果）。
 *
 * 与工程师的 verify-video-mode.mjs 相互独立。分四层：
 *   A. builtinSpec(protocol='agnes-video') 请求体/轮询规格
 *   B. execute() 全链路（mock fetch）：submit → id 提取优先级 → poll → 落盘
 *   C. runWorkflow 画布 videoNode（临时 DB provider，protocol=agnes-video）
 *   D. 回归：通用视频分支删 size、openai-video 不受影响、image/text 未波及
 * 另附【真实轮询契约】断言：用线上真实任务响应校验 spec.poll.resultPath 是否指向真实字段。
 *
 * 数据目录指向临时目录，避免污染真实 data/outputs。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-qa-agv-'));
process.env.WEAVE_DATA_DIR = TMP;

const { builtinSpec, PROTOCOLS, digFirstKey, execute, pick } = await import('../server/endpoint.js');
const { runWorkflow } = await import('../server/engine.js');
const { q } = await import('../server/db.js');

const BASE = 'https://apihub.agnes-ai.com/v1';
const MODEL = 'agnes-video-2.5-flash';

let pass = 0; let fail = 0; const failures = [];
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  \u2705 ${name}`); }
  else { fail++; failures.push({ name, extra }); console.log(`  \u274c ${name}${extra ? `  → ${extra}` : ''}`); }
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const keys = (o) => Object.keys(o).sort();
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function exactKeys(name, body, allowed) {
  const extra = keys(body).filter((k) => !allowed.includes(k));
  const missing = allowed.filter((k) => !has(body, k));
  check(`${name}：字段恰好 [${allowed.join(',')}]`, extra.length === 0 && missing.length === 0,
    `多余=[${extra}] 缺失=[${missing}] 实际=[${keys(body)}]`);
}
const agv = (vars) => builtinSpec({ kind: 'video', protocol: 'agnes-video', baseURL: BASE, model: MODEL, vars });
const agv20 = (vars) => builtinSpec({ kind: 'video', protocol: 'agnes-video', baseURL: BASE, model: 'agnes-video-v2.0', vars });

/* ============================================================
   A. agnes-video 协议规格
   ============================================================ */
console.log('\n===== A. builtinSpec(agnes-video) 规格 =====');
check('A PROTOCOLS 含 agnes-video', PROTOCOLS.some((p) => p.key === 'agnes-video'));
{
  const spec = agv({ prompt: 'x', mode: 'text', seconds: '4', ratio: '16:9' });
  check('A 提交 URL = /videos', spec.url === `${BASE}/videos`, spec.url);
  check('A idKeys = [video_id,id,task_id]', eq(spec.idKeys, ['video_id', 'id', 'task_id']));
  check('A poll URL 使用 Agnes host 根路径 /agnesapi（不带 /v1）', spec.poll.url === `https://apihub.agnes-ai.com/agnesapi?video_id={{id}}&model_name=agnes-video-2.5-flash`, spec.poll.url);
  check('A poll interval=1500 max=240', spec.poll.interval === 1500 && spec.poll.max === 240);
  check('A poll resultPath = url（顶层；真实契约见 E 组）', spec.poll.resultPath === 'url', spec.poll.resultPath);
}
{
  const t = agv({ prompt: 'x', mode: 'text', seconds: '4', ratio: '16:9', size: '720P' }).body; // 故意塞 size
  exactKeys('A text 模式', t, ['aspect_ratio', 'mode', 'model', 'prompt', 'seconds']);
  check('A text 模式 绝不注入 size（即便调用方传了 size）', !has(t, 'size'));
  check('A text 模式 mode=text', t.mode === 'text');
}
{
  const r = agv({ prompt: 'x', mode: 'reference', images: ['https://x.test/a.png'], seconds: '5', ratio: '16:9' }).body;
  exactKeys('A reference 模式', r, ['aspect_ratio', 'images', 'mode', 'model', 'prompt', 'seconds']);
  check('A reference 携 images、无 first_frame/last_frame/size',
    eq(r.images, ['https://x.test/a.png']) && !has(r, 'first_frame') && !has(r, 'last_frame') && !has(r, 'size'));
}
{
  const k = agv({ prompt: 'x', mode: 'keyframe', firstFrame: 'https://x.test/a.png', lastFrame: 'https://x.test/b.png', seconds: '5' }).body;
  check('A keyframe 携 first_frame+last_frame、无 images/size',
    k.first_frame === 'https://x.test/a.png' && k.last_frame === 'https://x.test/b.png' && !has(k, 'images') && !has(k, 'size'));
}
{
  const ref = agv20({ prompt: 'x', mode: 'reference', images: ['https://x.test/a.png', 'https://x.test/b.png'], seconds: 5, ratio: '16:9', size: '720P' }).body;
  check('A Agnes Video v2.0 将多参考图放入 extra_body.image，且时长/比例转换为原生参数',
    ref.mode === 'multi_reference' && eq(ref.extra_body?.image, ['https://x.test/a.png', 'https://x.test/b.png'])
      && !has(ref, 'images') && !has(ref, 'seconds') && !has(ref, 'aspect_ratio')
      && ref.width === 1280 && ref.height === 720 && ref.num_frames === 121 && ref.frame_rate === 24,
    JSON.stringify(ref));
  const frame = agv20({ prompt: 'x', mode: 'keyframe', firstFrame: 'https://x.test/a.png', lastFrame: 'https://x.test/b.png' }).body;
  check('A Agnes Video v2.0 首尾帧放入 extra_body.image，使用 keyframes 模式',
    frame.mode === 'keyframes' && eq(frame.extra_body?.image, ['https://x.test/a.png', 'https://x.test/b.png'])
      && frame.extra_body?.mode === 'keyframes' && !has(frame, 'first_frame') && !has(frame, 'last_frame'), JSON.stringify(frame));
  const oneFrame = agv20({ prompt: 'x', mode: 'keyframe', firstFrame: 'https://x.test/a.png' }).body;
  check('A Agnes Video v2.0 单首帧使用 image 字段，不误发 keyframes',
    oneFrame.image === 'https://x.test/a.png' && !has(oneFrame, 'mode') && !has(oneFrame, 'first_frame'), JSON.stringify(oneFrame));
  check('A Agnes Video v2.0 将 text 转为 ti2vid', agv20({ prompt: 'x', mode: 'text' }).body.mode === 'ti2vid');
  check('A 2.5-flash 仍保留 reference 模式值', agv({ prompt: 'x', mode: 'reference' }).body.mode === 'reference');
}
{
  // seconds 收敛在协议层也做了
  check("A seconds=0 → '4'", agv({ prompt: 'x', mode: 'text', seconds: 0 }).body.seconds === '4');
  check("A seconds=3 → '4'", agv({ prompt: 'x', mode: 'text', seconds: 3 }).body.seconds === '4');
  check("A seconds=13 → '12'", agv({ prompt: 'x', mode: 'text', seconds: 13 }).body.seconds === '12');
  check("A seconds='abc' → '5'", agv({ prompt: 'x', mode: 'text', seconds: 'abc' }).body.seconds === '5');
  check('A seconds=undefined → 不带该字段', !has(agv({ prompt: 'x', mode: 'text' }).body, 'seconds'));
}
{
  // mode 严格校验：非法/缺失 → 抛错（fail fast，不发请求）
  let threw = null;
  try { agv({ prompt: 'x', mode: 'omni' }); } catch (e) { threw = e; }
  check('A 非法 mode(omni) → 抛错而非发出', !!threw && /mode/.test(threw.message), threw?.message);
  threw = null;
  try { agv({ prompt: 'x' }); } catch (e) { threw = e; }
  check('A 缺失 mode → 抛错', !!threw && /mode/.test(threw.message), threw?.message);
}

/* ============================================================
   B. execute() 全链路（mock fetch）
   ============================================================ */
console.log('\n===== B. execute() 全链路（mock）=====');
const realFetch = globalThis.fetch;
let calls = [];
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : undefined });
    for (const r of routes) if (u.includes(r.match)) {
      return { ok: r.ok !== false, status: r.status || 200, text: async () => JSON.stringify(r.json), arrayBuffer: async () => new Uint8Array([0, 0, 0, 24]).buffer, headers: { get: () => r.ct || 'video/mp4' } };
    }
    return { ok: false, status: 404, text: async () => '{}' };
  };
}
const submit = (json) => ({ match: '/videos', json });
const poll = (json) => ({ match: '/agnesapi', json });
const media = { match: '.mp4', ok: true, ct: 'video/mp4' };

{
  // 正常链路：submit(queued) → poll(completed + url) → 下载落盘
  mockFetch([submit({ id: 'task_zzz111', video_id: 'video_ABC123456', task_id: 'task_ABC123456', status: 'queued', progress: 0 }),
    poll({ status: 'completed', progress: 100, url: 'https://cdn.test/out.mp4' }), media]);
  const spec = agv({ prompt: 'x', mode: 'text', seconds: '4', ratio: '16:9' });
  let out; let err;
  try { out = await execute({ spec, apiKey: 'qa', kind: 'video', retry429: false }); } catch (e) { err = e; }
  const post = calls.find((c) => c.url.endsWith('/videos'));
  const pollCall = calls.find((c) => c.url.includes('/agnesapi'));
  check('B submit 到 /videos 且 body 无 size', post?.url === `${BASE}/videos` && !has(post.body, 'size'));
  check('B id 提取优先 video_id（poll 用 video_id=video_ABC123456）', !!pollCall && pollCall.url.includes('video_id=video_ABC123456'), pollCall?.url);
  check('B poll URL 带 model_name', !!pollCall && pollCall.url.includes('model_name=agnes-video-2.5-flash'));
  check('B 取回结果并落盘为 /outputs/*.mp4', !!out && /^\/outputs\/.+\.mp4$/.test(out.url), err?.message || out?.url);
  check('B polls ≥ 1', !!out && out.polls >= 1);
}
{
  // id 回退：无 video_id → 用 id
  mockFetch([submit({ id: 'idval_12345', task_id: 'task_12345', status: 'queued' }),
    poll({ status: 'completed', url: 'https://cdn.test/out.mp4' }), media]);
  const spec = agv({ prompt: 'x', mode: 'text' });
  let err; try { await execute({ spec, apiKey: 'q', kind: 'video', retry429: false }); } catch (e) { err = e; }
  const pollCall = calls.find((c) => c.url.includes('/agnesapi'));
  check('B 无 video_id 时回退用 id', !!pollCall && pollCall.url.includes('video_id=idval_12345'), err?.message || pollCall?.url);
}
{
  // 失败态
  mockFetch([submit({ video_id: 'video_FAIL12345', status: 'queued' }),
    poll({ status: 'failed', error: { message: 'boom' } })]);
  const spec = agv({ prompt: 'x', mode: 'text' });
  let err; try { await execute({ spec, apiKey: 'q', kind: 'video', retry429: false }); } catch (e) { err = e; }
  check('B 轮询 failed → 抛「任务失败」', !!err && /任务失败/.test(err.message), err?.message);
}
{
  // 上游明确拒单时才重试；一旦任务被接收，后续只轮询这个任务。
  let submissions = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/videos')) {
      submissions++;
      const busy = submissions < 3;
      return {
        ok: !busy, status: busy ? 503 : 200,
        text: async () => JSON.stringify(busy
          ? { error: { message: 'video queue is full, please retry later' } }
          : { video_id: 'video_RETRY12345', status: 'queued' }),
      };
    }
    if (u.includes('/agnesapi')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'completed', url: 'https://cdn.test/retry.mp4' }) };
    }
    return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([0, 0, 0, 24]).buffer, headers: { get: () => 'video/mp4' } };
  };
  const spec = agv({ prompt: '小猫跑步', mode: 'text', seconds: '6' });
  spec.queueFullRetryDelays = [0, 0];
  let out; let err;
  try { out = await execute({ spec, apiKey: 'q', kind: 'video' }); } catch (e) { err = e; }
  check('B 503 队列满：退避后再次提交，接单后只轮询一次任务',
    submissions === 3 && !!out?.url && out.polls === 1, err?.message || `submissions=${submissions}`);
}
{
  let submissions = 0;
  globalThis.fetch = async () => {
    submissions++;
    return { ok: false, status: 503, text: async () => JSON.stringify({ code: 'video_queue_full', message: 'video queue is full' }) };
  };
  const spec = agv({ prompt: '小猫跑步', mode: 'text' });
  spec.queueFullRetryDelays = [0, 0];
  let err;
  try { await execute({ spec, apiKey: 'q', kind: 'video' }); } catch (e) { err = e; }
  check('B 持续队列满：限次停止并给出可操作提示',
    submissions === 3 && err?.code === 'UPSTREAM_VIDEO_QUEUE_FULL'
      && /队列已满/.test(err?.message || '') && /重试 2 次/.test(err?.message || ''),
    err?.message || `submissions=${submissions}`);
}
{
  let submissions = 0;
  globalThis.fetch = async () => {
    submissions++;
    return { ok: false, status: 503, text: async () => JSON.stringify({ error: { message: 'No available channel for model' } }) };
  };
  const spec = agv({ prompt: '小猫跑步', mode: 'text' });
  spec.queueFullRetryDelays = [0, 0];
  let err;
  try { await execute({ spec, apiKey: 'q', kind: 'video' }); } catch (e) { err = e; }
  check('B 无可用通道的 503 不重试', submissions === 1 && /No available channel/.test(err?.message || ''), err?.message);
}
{
  // 结果字段契约：产物 URL 无媒体后缀时仍能取到 → 证明已改走 resultPath('url')，不再依赖 digAnyUrl 的 .mp4 兜底
  mockFetch([submit({ video_id: 'video_NOEXT12345', status: 'queued' }),
    poll({ status: 'completed', url: 'https://cdn.test/signed-output-without-extension' }),
    { match: 'cdn.test', ok: true, ct: 'video/mp4' }]);
  const spec = agv({ prompt: 'x', mode: 'text' });
  let out; let err;
  try { out = await execute({ spec, apiKey: 'q', kind: 'video', retry429: false }); } catch (e) { err = e; }
  check('B resultPath 取顶层 url：无媒体后缀也能取到（不再依赖 digAnyUrl 兜底）',
    !!out && out.sourceUrl === 'https://cdn.test/signed-output-without-extension', err?.message || JSON.stringify(out?.sourceUrl));
}
{
  // Agnes 可能先返回 completed、下一轮才补齐地址；视频链接也可能是无扩展名的 metadata.url。
  let pollCount = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/videos')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ video_id: 'video_DELAY12345', status: 'queued' }) };
    }
    if (u.includes('/agnesapi')) {
      pollCount++;
      const json = pollCount === 1
        ? { completed_at: 1, created_at: 1, error: null, expires_at: 2, id: 'video_DELAY12345', model: MODEL, object: 'video', progress: 100, status: 'completed' }
        : { status: 'completed', metadata: { url: 'https://cdn.test/video/content?token=abc' } };
      return { ok: true, status: 200, text: async () => JSON.stringify(json) };
    }
    return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([0, 0, 0, 24]).buffer, headers: { get: () => 'video/mp4' } };
  };
  const spec = agv({ prompt: 'x', mode: 'text' });
  spec.poll.interval = 5;
  spec.poll.max = 20;
  let out; let err;
  try { out = await execute({ spec, apiKey: 'q', kind: 'video', retry429: false }); } catch (e) { err = e; }
  check('B completed 暂无地址时继续轮询，并可从 metadata.url 取无后缀视频链接',
    !!out && out.sourceUrl === 'https://cdn.test/video/content?token=abc' && pollCount === 2,
    err?.message || `pollCount=${pollCount}, sourceUrl=${out?.sourceUrl}`);
}
{
  let pollCount = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/videos')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ video_id: 'video_EMPTY12345', status: 'queued' }) };
    }
    if (u.includes('/agnesapi')) {
      pollCount++;
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'completed', progress: 100 }) };
    }
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const spec = agv({ prompt: 'x', mode: 'text' });
  spec.poll.interval = 10;
  spec.poll.max = 100;
  spec.poll.resultGracePolls = 3;
  let err;
  try { await execute({ spec, apiKey: 'q', kind: 'video', retry429: false }); } catch (e) { err = e; }
  check('B completed 永久缺少地址时经过限定重试后给出明确错误',
    !!err && /连续 3 次查询没有结果地址/.test(err.message) && pollCount === 3,
    err?.message || `pollCount=${pollCount}`);
}

/* ============================================================
   C. runWorkflow 画布 videoNode（protocol=agnes-video）
   ============================================================ */
console.log('\n===== C. runWorkflow 画布视频节点（agnes-video）=====');
q.run('INSERT INTO provider (id,name,protocol,base_url,api_key,models_json,notes,enabled,create_time,update_time) VALUES (?,?,?,?,?,?,?,1,?,?)',
  'pv_qa_agnes', 'QA agnes-video', 'agnes-video', BASE, 'qa-key', '[]', 'qa', '', '');
// resolveTarget('video', …) 会从 ai_config(purpose=video) 读，再经 provider 取 protocol；
// 故临时库里也要落一条 video 配置（指向上面这条 agnes-video provider）。
q.run('DELETE FROM ai_config WHERE purpose = ?', 'video');
q.run('INSERT INTO ai_config (id,purpose,provider_id,base_url,api_key,model_id,update_time) VALUES (?,?,?,?,?,?,?)',
  'cfg_qa_video', 'video', 'pv_qa_agnes', BASE, 'qa-key', MODEL, new Date().toISOString());
const CFG = { purpose: 'video', base_url: BASE, api_key: 'qa-key', model_id: MODEL, provider_id: 'pv_qa_agnes' };
const refs6 = Array.from({ length: 6 }, (_, i) => ({ key: `图片${i + 1}`, type: 'image', url: `https://x.test/${i + 1}.png` }));

{
  // 旧剧本分镜接口只传 image；Agnes 必须将它适配为 keyframe + first_frame。
  mockFetch([submit({ video_id: 'video_LEGACY12345', status: 'queued' }),
    poll({ status: 'completed', url: 'https://cdn.test/legacy.mp4' }), media]);
  const { callVideo } = await import('../server/ai.js');
  const frameData = 'data:image/png;base64,aGVsbG8=';
  let err;
  try { await callVideo(CFG, { model: MODEL, prompt: '分镜图动起来', image: frameData, duration: 5, ratio: '16:9' }); }
  catch (e) { err = e; }
  const post = calls.find((c) => c.url.endsWith('/videos'));
  check('C legacy shot API：Agnes 自动补 mode=keyframe', post?.body.mode === 'keyframe', err?.message || JSON.stringify(post?.body));
  check('C legacy shot API：image 自动映射为 first_frame（不再发送 image 字段）',
    post?.body.first_frame === 'aGVsbG8=' && !has(post.body, 'image'), err?.message || JSON.stringify(post?.body));
}

async function runVideo(data, mediaRefs = []) {
  calls = [];
  globalThis.fetch = (async (url, opts = {}) => {
    calls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : undefined });
    if (String(url).endsWith('/videos')) return { ok: true, status: 200, text: async () => JSON.stringify({ video_id: 'video_RUN1234567', status: 'queued' }) };
    if (String(url).includes('/agnesapi')) return { ok: true, status: 200, text: async () => JSON.stringify({ status: 'completed', url: 'https://cdn.test/run.mp4' }) };
    return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer, headers: { get: () => 'video/mp4' } };
  });
  const nodes = [{ id: 'v1', type: 'videoNode', data: { prompt: '一段描述', ...data, mediaRefs } }];
  const res = await runWorkflow({ nodes, edges: [], targetIds: ['v1'], configs: { video: CFG } });
  return { res, post: calls.find((c) => c.url.endsWith('/videos')) };
}
{
  const { res, post } = await runVideo({ mode: 'text', duration: 5, resolution: '720p', ratio: '16:9' });
  check('C text：经 agnes-video 协议提交到 /videos', post?.url === `${BASE}/videos`, post?.url);
  check('C text：body 无 size（用户报 400 的根因已消除）', post && !has(post.body, 'size'), JSON.stringify(post?.body));
  check('C text：结果落盘成功', /^\/outputs\//.test(res.patches.find((p) => p.data?.videoUrl)?.data?.videoUrl || ''), res.error);
}
{
  const { post } = await runVideo({ mode: 'omni', duration: 8, resolution: '1080p', ratio: '9:16' }, refs6);
  check('C omni：mode=reference、images 截断 5、无 first_frame、无 size',
    post.body.mode === 'reference' && post.body.images?.length === 5 && !has(post.body, 'first_frame') && !has(post.body, 'size'));
}
{
  const { post } = await runVideo({ modelId: 'agnes-video-v2.0', mode: 'omni', duration: 5 }, refs6);
  check('C Agnes v2.0 画布节点将全能参考发为 multi_reference',
    post.body.model === 'agnes-video-v2.0' && post.body.mode === 'multi_reference'
      && post.body.extra_body?.image?.length === 5 && !has(post.body, 'images'),
    JSON.stringify(post?.body));
}
{
  const { post } = await runVideo({ modelId: 'agnes-video-v2.0', mode: 'image', duration: 5 }, [{ key: '图片1', type: 'image', url: 'https://x.test/1.png' }]);
  check('C Agnes v2.0 画布单图模式使用 image 字段',
    post.body.model === 'agnes-video-v2.0' && post.body.image === 'https://x.test/1.png' && !has(post.body, 'first_frame'),
    JSON.stringify(post?.body));
}
{
  const { post } = await runVideo({ mode: 'image', duration: 3, resolution: '720p', ratio: '16:9' }, [{ key: '图片1', type: 'image', url: 'https://x.test/1.png' }]);
  check('C image：mode=keyframe、first_frame 正确、无 images、无 size',
    post.body.mode === 'keyframe' && post.body.first_frame === 'https://x.test/1.png' && !has(post.body, 'images') && !has(post.body, 'size'));
  check('C image：seconds 3→"4"', post.body.seconds === '4');
}
{
  const { res, post } = await runVideo({ mode: 'omni', duration: 5, resolution: '720p' }, []);
  check('C omni 无图：不发请求且报错', !post && /参考图/.test(res.error || ''), res.error);
}

/* ============================================================
   D. 回归
   ============================================================ */
console.log('\n===== D. 回归 =====');
{
  const gen = builtinSpec({ kind: 'video', protocol: 'openai', baseURL: BASE, model: MODEL, vars: { prompt: 'x', mode: 'text', seconds: 5, size: '720P', ratio: '16:9' } }).body;
  check('D 通用 openai 视频分支已删除 size', !has(gen, 'size'));
  const ov = builtinSpec({ kind: 'video', protocol: 'openai-video', baseURL: BASE, model: MODEL, vars: { prompt: 'x', mode: 'text', image: 'https://x.test/a.png' } }).body;
  check('D openai-video 仍不注入 mode/size', !has(ov, 'mode') && !has(ov, 'size') && ov.image === 'https://x.test/a.png');
  const img = builtinSpec({ kind: 'image', protocol: 'openai', baseURL: BASE, model: 'm', vars: { prompt: 'p', image: 'https://x.test/a.png', size: '1024x1024' } }).body;
  check('D image 分支 size/image 未受影响', img.size === '1024x1024' && img.image === 'https://x.test/a.png');
  // agnes-video 守卫仅对 video 生效
  const txt = builtinSpec({ kind: 'text', protocol: 'agnes-video', baseURL: BASE, model: 'm', vars: { user: 'u' } });
  check('D agnes-video 守卫仅 video 生效（text 仍走 chat/completions）', txt.url === `${BASE}/chat/completions`);
  // digFirstKey 优先级
  check('D digFirstKey 优先 video_id', digFirstKey({ id: 'a111111', video_id: 'video_b2222222', task_id: 'task_c3333333' }, ['video_id', 'id', 'task_id']) === 'video_b2222222');
  check('D digFirstKey 无 video_id 时用 id', digFirstKey({ id: 'a111111', task_id: 'task_c3333333' }, ['video_id', 'id', 'task_id']) === 'a111111');
}

/* ============================================================
   E. 真实轮询契约（用线上真实任务的响应，离线断言）
   ============================================================ */
console.log('\n===== E. 真实轮询响应契约 =====');
const realPollResponse = {
  completed_at: 1789399863, created_at: 1789399822, error: null,
  id: 'video_fc932e871a5e0ce5db353e3a8e1090e2714ddb461752b9de', object: 'video', progress: 100,
  quality: 'standard', seconds: '5', size: '720P', started_at: 1789399822, status: 'completed',
  url: 'https://platform-outputs.agnes-ai.space/videos/agnes-video-2.5/video_fc932e871a5e0ce5db353e3a8e1090e2714ddb461752b9de.mp4',
};
check('E 真实响应结果字段在顶层 url 且为 .mp4', typeof realPollResponse.url === 'string' && realPollResponse.url.endsWith('.mp4'));
const realSpec = agv({ prompt: 'x', mode: 'text', seconds: '5' });
check('E spec.poll.resultPath 指向真实响应中确实存在的字段（顶层 url）',
  realSpec.poll.resultPath === 'url' && pick(realPollResponse, realSpec.poll.resultPath) != null,
  `resultPath=${realSpec.poll.resultPath}；pick(real,resultPath)=${pick(realPollResponse, realSpec.poll.resultPath)}`);
// 顺带确认：即便响应无 metadata 层，也能取到结果（不再依赖 digAnyUrl 的 .mp4 兜底）
check('E 真实响应无 metadata 层（故不可用 metadata.url）', pick(realPollResponse, 'metadata.url') == null);

globalThis.fetch = realFetch;

console.log(`\n===== 结果：${pass} passed, ${fail} failed =====`);
if (fail) { console.log('\n失败明细：'); for (const f of failures) console.log(`  - ${f.name}${f.extra ? `  → ${f.extra}` : ''}`); }
process.exit(fail ? 1 : 0);
