// 探测视频生成接口的真实返回结构（一次调用，尽量小参数）
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.join(import.meta.dirname, '..', 'data');
const db = new DatabaseSync(path.join(dataDir, 'weave.db'));
const cfg = db.prepare("SELECT base_url, api_key FROM ai_config WHERE purpose='thinking'").get();
const base = cfg.base_url.replace(/\/+$/, '');
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` };

const png = fs.readdirSync(path.join(dataDir, 'outputs')).find((f) => f.endsWith('.png'));
const dataUrl = `data:image/png;base64,${fs.readFileSync(path.join(dataDir, 'outputs', png)).toString('base64')}`;
console.log('参考图:', png, `(${Math.round(dataUrl.length / 1024)} KB base64)`);

const post = async (label, url, body) => {
  const t0 = Date.now();
  const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  console.log(`\n${label} → HTTP ${r.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(text.slice(0, 1200));
  return { status: r.status, text };
};

const url = `${base}/video/generations`;

await post('[A] image 字段名探测（非法值）', url, { model: 'agnes-video-v2.0', prompt: 'x', image: 'not-a-url' });
await post('[B] duration 类型探测', url, { model: 'agnes-video-v2.0', prompt: 'x', duration: 'abc' });
await post('[C] 真实最小调用（图生视频 4 秒）', url, {
  model: 'agnes-video-v2.0',
  prompt: '镜头缓慢推近，衣袂飘动',
  image: dataUrl,
  duration: 4,
});
