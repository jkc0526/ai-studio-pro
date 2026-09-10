import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { DATA_DIR, OUTPUT_DIR, q, uid, now } from './db.js';

const TMP = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

/* ---------------- ffmpeg 定位 ---------------- */
const candidates = () => {
  const list = [];
  if (process.env.WEAVE_FFMPEG) list.push(process.env.WEAVE_FFMPEG);
  const local = path.join(DATA_DIR, 'runtime', 'ffmpeg');
  if (fs.existsSync(local)) {
    for (const f of fs.readdirSync(local)) {
      if (/\.exe$/i.test(f)) list.push(path.join(local, f));
      const p = path.join(local, f);
      if (fs.statSync(p).isDirectory()) {
        for (const g of fs.readdirSync(p)) if (/^ffmpeg(\.exe)?$/i.test(g)) list.push(path.join(p, g));
      }
    }
  }
  try {
    const mod = require.resolve('ffmpeg-static');
    if (mod) list.push(mod.replace(/index\.js$/, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  } catch { /* 未安装 */ }
  // 本机其他软件自带的 ffmpeg（仅本地开发兜底）
  const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
  for (const dir of ['com.loomart.desktop']) {
    const root = path.join(roaming, dir, 'runtime', 'ffmpeg');
    if (!fs.existsSync(root)) continue;
    for (const v of fs.readdirSync(root)) {
      const exe = path.join(root, v, 'ffmpeg.exe');
      if (fs.existsSync(exe)) list.push(exe);
    }
  }
  list.push('ffmpeg');
  return list;
};

export function findFfmpeg() {
  for (const c of candidates()) {
    try { if (c === 'ffmpeg' || fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

function run(bin, args, onLine) {
  return new Promise((resolve, reject) => {
    const p = execFile(bin, args, { maxBuffer: 1024 * 1024 * 64 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${err.message}\n${String(stderr).slice(-600)}`));
      resolve({ stdout, stderr });
    });
    if (onLine && p.stderr) p.stderr.on('data', (d) => onLine(String(d)));
  });
}

const esc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/* ---------------- 单镜 → 规整片段 ---------------- */
async function buildSegment({ bin, shot, index, width, height, fps, silent }) {
  const out = path.join(TMP, `seg_${shot.id}_${Date.now()}.mp4`);
  const duration = Math.max(1, Number(shot.duration) || 5);
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}`;
  let args;
  if (shot.video_url) {
    const src = path.join(OUTPUT_DIR, path.basename(shot.video_url));
    if (!fs.existsSync(src)) throw new Error(`镜头 ${shot.seq} 的视频文件缺失`);
    args = ['-y', '-i', src, '-t', String(duration), '-vf', vf, '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', out];
  } else if (shot.image_url) {
    const src = path.join(OUTPUT_DIR, path.basename(shot.image_url));
    if (!fs.existsSync(src)) throw new Error(`镜头 ${shot.seq} 的图片文件缺失`);
    args = ['-y', '-loop', '1', '-t', String(duration), '-i', src, '-vf', vf, '-an',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(fps), out];
  } else {
    throw new Error(`镜头 ${shot.seq} 既没有图片也没有视频，先出图再导出`);
  }
  if (silent) args.splice(args.indexOf('-an'), 1);
  await run(bin, args);
  return { file: out, duration, seq: shot.seq, dialogue: shot.dialogue || '' };
}

/* ---------------- 成片导出 ---------------- */
export async function exportMovie({ scriptId, width = 1080, height = 1920, fps = 30, onProgress }) {
  const bin = findFfmpeg();
  if (!bin) throw new Error('未找到 ffmpeg，无法导出成片。可设置环境变量 WEAVE_FFMPEG 指向 ffmpeg 可执行文件，或把 ffmpeg.exe 放到 data/runtime/ffmpeg/ 下');
  const script = q.one('SELECT * FROM script WHERE id = ?', scriptId);
  if (!script) throw new Error('剧本不存在');
  const shots = q.all('SELECT * FROM shot WHERE script_id = ? ORDER BY seq', scriptId);
  if (!shots.length) throw new Error('还没有镜头，无法导出');

  const total = shots.length;
  const segs = [];
  const skipped = [];
  for (let i = 0; i < shots.length; i++) {
    if (!shots[i].video_url && !shots[i].image_url) { skipped.push(shots[i].seq); continue; }
    if (onProgress) onProgress({ stage: 'segment', done: segs.length, total, seq: shots[i].seq });
    try {
      segs.push(await buildSegment({ bin, shot: shots[i], index: i, width, height, fps }));
    } catch (e) {
      skipped.push(shots[i].seq);
      if (onProgress) onProgress({ stage: 'skip', seq: shots[i].seq, error: e.message });
    }
  }
  if (!segs.length) throw new Error('所有镜头都缺少可用的图片/视频文件，无法导出');

  const listFile = path.join(TMP, `list_${Date.now()}.txt`);
  fs.writeFileSync(listFile, segs.map((s) => `file '${s.file.replace(/\\/g, '/')}'`).join('\n'), 'utf8');

  const outName = `movie_${uid('m').slice(2)}.mp4`;
  const outPath = path.join(OUTPUT_DIR, outName);
  if (onProgress) onProgress({ stage: 'concat', done: total, total });
  await run(bin, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outPath]);

  // 字幕文件（台词按镜序输出，导入剪映/播放器即可对齐）
  const srtLines = [];
  let cursor = 0;
  segs.forEach((s) => {
    const start = cursor;
    cursor += s.duration;
    const text = (s.dialogue || '').trim();
    if (!text) return;
    srtLines.push(`${srtLines.length + 1}\n${fmtTime(start)} --> ${fmtTime(cursor)}\n${text}\n`);
  });
  const srtName = outName.replace(/\.mp4$/, '.srt');
  if (srtLines.length) fs.writeFileSync(path.join(OUTPUT_DIR, srtName), srtLines.join('\n'), 'utf8');

  for (const s of segs) { try { fs.unlinkSync(s.file); } catch { /* ignore */ } }
  try { fs.unlinkSync(listFile); } catch { /* ignore */ }

  const duration = segs.reduce((a, s) => a + s.duration, 0);
  const url = `/outputs/${outName}`;
  q.run('INSERT INTO media_asset (id, script_id, shot_id, kind, file_path, duration, prompt, model, meta_json, create_time) VALUES (?,?,?,?,?,?,?,?,?,?)',
    uid('md'), scriptId, null, 'movie', url, duration, '', bin, JSON.stringify({ shots: segs.length, skipped, width, height, fps, srt: srtLines.length ? `/outputs/${srtName}` : null }), now());
  return { url, srt: srtLines.length ? `/outputs/${srtName}` : null, duration, shots: segs.length, skipped, width, height, ffmpeg: bin };
}

const fmtTime = (sec) => {
  const s = Math.max(0, sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const ms = String(Math.round((s - Math.floor(s)) * 1000)).padStart(3, '0');
  return `${hh}:${mm}:${ss},${ms}`;
};
