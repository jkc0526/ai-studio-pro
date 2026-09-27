import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* ============================================================
   WeaveCanvas ⇄ ComfyUI 桥接服务
   - WeaveCanvas 视频模型(Base URL) 填 http://127.0.0.1:9777/v1
   - POST /v1/video/generations  提交(OpenAI 风格)
   - GET  /v1/videos/{id}        轮询
   - 内部翻译成 ComfyUI /upload/image + /prompt + /history + /view
   ============================================================ */

const PORT = 9777;
// SSH tunnel (ssh_tunnel.py) forwards 127.0.0.1:8188 -> container ComfyUI
// Fallback: 'https://mm5z5ncdw17bui54-8188.container.x-gpu.com' (flaky gateway)
const COMFY = 'http://127.0.0.1:8188';
const FILES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bridge-files');
fs.mkdirSync(FILES_DIR, { recursive: true });

const UNET = 'minimax_h3_fl2va_pruned_int8_convrot.safetensors';
const CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors';
const VAE_VIDEO = 'minimax_h3_video_vae_fp16.safetensors';
const VAE_AUDIO = 'minimax_h3_audio_vae_fp32.safetensors';

// Turbo 蒸馏 LoRA（LightX2V/ModelTC v1.0）：4 步采样代替 24 步，shift 12->6
// 文戏/慢镜头 4 步够用；大动态可切 8-step LoRA（steps 8、shift 12）
const TURBO = true;
const TURBO_LORA = 'minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors';
const TURBO_STEPS = 4;
const TURBO_SHIFT = 6;

const jobs = new Map(); // id -> {status, url, error}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function snapFrames(durationSec) {
  // MiniMax H3 训练范围约 124-362 帧（~5-15s），帧数 17k+5 网格 @24fps
  let s = Number(durationSec) || 5;
  s = Math.min(15, Math.max(3, s));
  const f = Math.round(s * 24);
  if (f <= 5) return 5;
  return Math.min(362, Math.ceil((f - 5) / 17) * 17 + 5);
}

const snapDimsW = (v) => Math.max(320, Math.round(Number(v) / 32) * 32);

// resolution('480p'|'720p'|'1080p') + aspect_ratio('16:9') -> width/height（32 的倍数）
function dims(resolution, aspectRatio) {
  const m = String(aspectRatio || '16:9').match(/(\d+(?:\.\d+)?)\s*[:/xX]\s*(\d+(?:\.\d+)?)/);
  const ratio = m && Number(m[1]) > 0 && Number(m[2]) > 0 ? Number(m[1]) / Number(m[2]) : 16 / 9;
  const shortTarget = resolution === '480p' ? 480 : resolution === '720p' ? 720 : 1080;
  const snap32 = (v) => Math.max(320, Math.round(v / 32) * 32);
  const short = snap32(shortTarget); // 短边贴 32 网格
  const long = snap32(short * Math.max(ratio, 1 / ratio));
  return ratio >= 1 ? { width: long, height: short } : { width: short, height: long };
}

async function fetchComfy(url, opts) {
  let lastErr;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res;
      lastErr = new Error(`comfy ${url} -> ${res.status}`);
      if (res.status < 500) { // 4xx 不重试
        const e = new Error(lastErr.message); e.status = res.status; throw e;
      }
    } catch (e) {
      if (e.status && e.status < 500) throw e;
      lastErr = e;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw lastErr;
}

async function uploadImage(bytes, filename) {
  const fd = new FormData();
  fd.append('image', new Blob([bytes]), filename || `wv_${Date.now()}.png`);
  fd.append('overwrite', 'true');
  const res = await fetchComfy(`${COMFY}/upload/image`, { method: 'POST', body: fd });
  const j = await res.json();
  return j.name; // "subdir/file.png" or "file.png"
}

async function resolveImage(imageField) {
  if (!imageField) return null;
  try {
    let bytes = null;
    const s = String(imageField);
    const m = s.match(/^data:[^;]+;base64,(.+)$/s);
    if (m) bytes = Buffer.from(m[1], 'base64');
    else if (/^https?:\/\//.test(s)) {
      const r = await fetch(s);
      if (!r.ok) throw new Error(`image fetch ${r.status}`);
      bytes = Buffer.from(await r.arrayBuffer());
    }
    if (!bytes) return null;
    const ext = bytes[0] === 0x89 ? 'png' : 'jpg';
    return await uploadImage(bytes, `wv_${randomUUID().slice(0, 8)}.${ext}`);
  } catch (e) {
    log('resolveImage failed:', e.message);
    return null;
  }
}

function buildGraph({ prompt, length, width, height, targetWidth, targetHeight, imageName, turbo }) {
  const g = {
    '1': { class_type: 'UNETLoader', inputs: { unet_name: UNET, weight_dtype: 'default' } },
    '2': { class_type: 'CLIPLoader', inputs: { clip_name: CLIP, type: 'minimax' } },
    '3': { class_type: 'VAELoader', inputs: { vae_name: VAE_VIDEO } },
    '4': { class_type: 'VAELoader', inputs: { vae_name: VAE_AUDIO } },
    '6': {
      class_type: 'MiniMaxH3ImageToVideo',
      inputs: { clip: ['2', 0], vae: ['3', 0], prompt: String(prompt || ''), width, height, length },
    },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
    '8': { class_type: 'MiniMaxH3SigmaShift', inputs: { model: ['1', 0], shift_video: 12, shift_audio: 3 } },
    '9': {
      class_type: 'KSampler',
      inputs: {
        model: ['8', 0], seed: Math.floor(Math.random() * 2 ** 31),
        steps: 24, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple',
        positive: ['6', 0], negative: ['7', 0], latent_image: ['6', 1], denoise: 1.0,
      },
    },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
    '11': { class_type: 'VAEDecodeAudio', inputs: { samples: ['9', 0], vae: ['4', 0] } },
    '12': { class_type: 'CreateVideo', inputs: { images: ['10', 0], fps: 24, audio: ['11', 0] } },
    '13': { class_type: 'SaveVideo', inputs: { video: ['12', 0], filename_prefix: 'weave/h3', format: 'mp4' } },
  };
  if (imageName) g['6'].inputs.first_frame = ['5', 0], g['5'] = { class_type: 'LoadImage', inputs: { image: imageName } };
  // Turbo 蒸馏 LoRA：插在 UNET 和 SigmaShift 之间，4 步采样
  if (turbo) {
    g['20'] = {
      class_type: 'LoraLoader',
      inputs: { lora_name: TURBO_LORA, strength_model: 1.0, strength_clip: 1.0, model: ['1', 0] },
    };
    g['8'].inputs.model = ['20', 0];
    g['8'].inputs.shift_video = TURBO_SHIFT;
    g['9'].inputs.steps = TURBO_STEPS;
  }
  // 低分辨率快速生成 -> Real-ESRGAN 超分 -> 精确缩放到目标尺寸（4090 上超分只花几秒）
  if (targetWidth && targetHeight && (targetWidth !== width || targetHeight !== height)) {
    g['14'] = { class_type: 'UpscaleModelLoader', inputs: { model_name: 'RealESRGAN_x2plus.pth' } };
    g['15'] = {
      class_type: 'ImageUpscaleWithModelBatched',
      inputs: { upscale_model: ['14', 0], images: ['10', 0], per_batch: 8, precision: 'float16' },
    };
    g['16'] = {
      class_type: 'ImageScale',
      inputs: { upscale_method: 'lanczos', width: targetWidth, height: targetHeight, crop: 'disabled', image: ['15', 0] },
    };
    g['12'].inputs.images = ['16', 0];
  }
  return g;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname.replace(/^\/v1/, '').replace(/^\/+/, '/');
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {});

    /* ---- 提交 ---- */
    if (req.method === 'POST' && (p === '/video/generations' || p === '/images/generations')) {
      const body = JSON.parse((await readBody(req)).toString() || '{}');
      const prompt = body.prompt || body.input;
      if (!prompt) return json(res, 400, { error: { message: 'prompt is required', type: 'invalid_request_error' } });
      const isImageGen = p === '/images/generations';
      if (isImageGen) return json(res, 400, { error: { message: 'this bridge serves video only', type: 'invalid_request_error' } });
      const imageName = await resolveImage(body.image || body.image_url);
      // 分辨率：显式 width/height > size('1920x1080') > resolution('1080p')+aspect_ratio > 默认
      // 1080p 目标走「720p 生成 + ESRGAN 超分」加速；720p/480p 直接生成不超分
      let width = Number(body.width) || 0;
      let height = Number(body.height) || 0;
      let targetWidth = 0, targetHeight = 0;
      const sm = String(body.size || '').match(/(\d+)\s*[xX*]\s*(\d+)/);
      if (!width || !height) {
        if (sm) {
          width = snapDimsW(Number(sm[1]));
          height = snapDimsW(Number(sm[2]));
        } else {
          const t = dims(body.resolution, body.aspect_ratio);
          width = t.width; height = t.height;
          if (Math.min(t.width, t.height) >= 1080) {
            const gen = dims('720p', body.aspect_ratio);
            targetWidth = t.width; targetHeight = t.height;
            width = gen.width; height = gen.height;
          }
        }
      }
      const graph = buildGraph({
        prompt,
        length: snapFrames(body.duration ?? body.duration_seconds),
        width,
        height,
        targetWidth,
        targetHeight,
        imageName,
        turbo: TURBO && body.turbo !== false,
      });
      const r = await fetchComfy(`${COMFY}/prompt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: graph, client_id: 'weave-bridge' }),
      });
      const j = await r.json();
      if (j.error || j.node_errors && Object.keys(j.node_errors).length) {
        log('comfy rejected:', JSON.stringify(j).slice(0, 600));
        return json(res, 500, { error: { message: JSON.stringify(j).slice(0, 500) } });
      }
      const id = j.prompt_id;
      jobs.set(id, { status: 'submitted' });
      log('submitted', id, turbo ? 'turbo-4step' : 'base-24step', `gen=${width}x${height}`, targetWidth ? `upscale->${targetWidth}x${targetHeight}` : 'no-upscale', `frames=${graph['6'].inputs.length}`, `img=${!!imageName}`);
      return json(res, 200, { id, status: 'submitted' });
    }

    /* ---- 轮询 ---- */
    const m = p.match(/^\/videos\/([\w-]+)$/) || p.match(/^\/video\/generations\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const id = m[1];
      const job = jobs.get(id);
      if (job && job.status === 'completed') return json(res, 200, { id, status: 'completed', url: job.url });
      if (job && job.status === 'failed') return json(res, 200, { id, status: 'failed', error: job.error });
      const r = await fetchComfy(`${COMFY}/history/${id}`);
      const hist = (await r.json())[id];
      if (!hist) return json(res, 200, { id, status: 'pending' });
      const st = hist.status || {};
      if (st.status_str === 'error') {
        jobs.set(id, { status: 'failed', error: st.messages?.map(x => x[1]?.g || x[1]?.c?.response || x[0]).join('; ').slice(0, 400) });
        return json(res, 200, { id, status: 'failed', error: jobs.get(id).error });
      }
      // 找输出文件
      for (const nodeOut of Object.values(hist.outputs || {})) {
        const arr = nodeOut.videos || nodeOut.images || nodeOut.gifs || [];
        if (Array.isArray(arr) && arr.length) {
          const f = arr.find(x => /\.(mp4|webm|gif)$/i.test(x.filename)) || arr[0];
          const vurl = `${COMFY}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`;
          const fr = await fetch(vurl);
          const buf = Buffer.from(await fr.arrayBuffer());
          const local = path.join(FILES_DIR, `${id}.mp4`);
          fs.writeFileSync(local, buf);
          jobs.set(id, { status: 'completed', url: `http://127.0.0.1:${PORT}/files/${id}.mp4` });
          log('completed', id, buf.length, 'bytes');
          return json(res, 200, { id, status: 'completed', url: `http://127.0.0.1:${PORT}/files/${id}.mp4` });
        }
      }
      return json(res, 200, { id, status: 'pending' });
    }

    /* ---- 文件 ---- */
    if (req.method === 'GET' && p.startsWith('/files/')) {
      const f = path.join(FILES_DIR, path.basename(p));
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
      return res.end(fs.readFileSync(f));
    }

    if (p === '/' || p === '/health') return json(res, 200, { ok: true, service: 'weave-comfy-bridge', comfy: COMFY, jobs: jobs.size });

    json(res, 404, { error: { message: 'not found' } });
  } catch (e) {
    log('ERR', p, e.message);
    json(res, 500, { error: { message: e.message } });
  }
});

server.listen(PORT, '127.0.0.1', () => log(`weave-comfy-bridge on http://127.0.0.1:${PORT} -> ${COMFY}`));
