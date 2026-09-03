const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Parse JSON bodies for proxy routes (large limit for base64 images/audio)
app.use(express.json({ limit: '200mb' }));

// Persistent storage directories
// In Electron: use userData/data and userData/media (set via env vars)
// In web mode: use directories next to server.js
const DATA_DIR = process.env.AI_STUDIO_DATA_DIR || path.join(__dirname, 'data');
const MEDIA_DIR = process.env.AI_STUDIO_MEDIA_DIR || path.join(__dirname, 'media');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Keep TEMP_DIR as alias for MEDIA_DIR for backward compatibility
const TEMP_DIR = MEDIA_DIR;

// History JSON file
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

// Serve media files (downloaded videos/images, concatenated videos)
app.use('/media', express.static(MEDIA_DIR));
// Keep /tmp route for backward compatibility
app.use('/tmp', express.static(MEDIA_DIR));

const DEFAULT_BASE = 'https://apihub.agnes-ai.com';

function getBaseUrl(req) {
  return req.headers['x-api-base'] || DEFAULT_BASE;
}

function buildHeaders(req) {
  const h = { 'Content-Type': 'application/json' };
  if (req.headers.authorization) h['Authorization'] = req.headers.authorization;
  return h;
}

// === Image generation proxy ===
app.post('/api/images/generations', async (req, res) => {
  const base = getBaseUrl(req);
  try {
    const resp = await fetch(`${base}/v1/images/generations`, {
      method: 'POST',
      headers: buildHeaders(req),
      body: JSON.stringify(req.body)
    });
    const text = await resp.text();
    res.status(resp.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Image proxy error:', err.message);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}` } });
  }
});

// === Video creation proxy ===
app.post('/api/videos', async (req, res) => {
  const base = getBaseUrl(req);
  try {
    const resp = await fetch(`${base}/v1/videos`, {
      method: 'POST',
      headers: buildHeaders(req),
      body: JSON.stringify(req.body)
    });
    const text = await resp.text();
    res.status(resp.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Video proxy error:', err.message);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}` } });
  }
});

// === Video query proxy ===
app.get('/api/agnesapi', async (req, res) => {
  const base = getBaseUrl(req);
  try {
    const params = new URLSearchParams(req.query).toString();
    const resp = await fetch(`${base}/agnesapi?${params}`, {
      headers: { 'Authorization': req.headers.authorization || '' }
    });
    const text = await resp.text();
    res.status(resp.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Query proxy error:', err.message);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}` } });
  }
});

// === Video status query proxy (GET /v1/videos/{videoId}) ===
app.get('/api/videos/:videoId', async (req, res) => {
  const base = getBaseUrl(req);
  const { videoId } = req.params;
  try {
    const resp = await fetch(`${base}/v1/videos/${videoId}`, {
      headers: { 'Authorization': req.headers.authorization || '' }
    });
    const text = await resp.text();
    res.status(resp.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Video status query error:', err.message);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}` } });
  }
});

// === Generic proxy (for custom API endpoints) ===
app.post('/api/proxy', async (req, res) => {
  const { url, method, headers, body } = req.body;
  if (!url) return res.status(400).json({ error: { message: 'Missing url' } });
  try {
    const resp = await fetch(url, {
      method: method || 'POST',
      headers: headers || { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await resp.text();
    res.status(resp.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (err) {
    console.error('Generic proxy error:', err.message);
    res.status(502).json({ error: { message: `Proxy error: ${err.message}` } });
  }
});

// === Download a media URL to local persistent storage ===
app.post('/api/download', async (req, res) => {
  const { url, filename, type } = req.body;
  if (!url) return res.status(400).json({ error: { message: 'Missing url' } });
  
  const ext = filename?.match(/\.(mp4|mov|avi|mkv|webm|png|jpg|jpeg|gif|webp)/i)?.[0]?.toLowerCase() 
    || (type === 'image' ? '.png' : '.mp4');
  const fname = filename || `media_${Date.now()}${ext}`;
  const localPath = path.join(MEDIA_DIR, fname);
  
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Download failed: HTTP ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(localPath, buffer);
    console.log(`Downloaded: ${fname} (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`);
    res.json({ success: true, url: `/media/${fname}`, tmpUrl: `/tmp/${fname}`, filename: fname, size: buffer.length });
  } catch (err) {
    console.error('Download error:', err.message);
    res.status(502).json({ error: { message: `Download error: ${err.message}` } });
  }
});

// === History persistence (JSON file in data directory) ===
app.get('/api/history', (req, res) => {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      const history = JSON.parse(data);
      res.json({ success: true, history });
    } else {
      res.json({ success: true, history: [] });
    }
  } catch (err) {
    console.error('History load error:', err.message);
    res.json({ success: true, history: [] });
  }
});

app.post('/api/history', (req, res) => {
  try {
    const { history } = req.body;
    if (!Array.isArray(history)) return res.status(400).json({ error: { message: 'Invalid history format' } });
    // Limit to 50 items to prevent excessive storage
    const trimmed = history.slice(0, 50);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
    console.log(`History saved: ${trimmed.length} items`);
    res.json({ success: true, count: trimmed.length });
  } catch (err) {
    console.error('History save error:', err.message);
    res.status(500).json({ error: { message: `History save error: ${err.message}` } });
  }
});

// === List all media files ===
app.get('/api/media-list', (req, res) => {
  try {
    const files = fs.readdirSync(MEDIA_DIR).map(f => {
      const stat = fs.statSync(path.join(MEDIA_DIR, f));
      return { name: f, size: stat.size, mtime: stat.mtime };
    }).sort((a, b) => b.mtime - a.mtime);
    res.json({ success: true, files, dir: MEDIA_DIR });
  } catch (err) {
    res.json({ success: true, files: [], dir: MEDIA_DIR });
  }
});

// === Concatenate videos using ffmpeg ===
app.post('/api/concat', async (req, res) => {
  const { videos } = req.body; // Array of {url, filename}
  if (!videos || !videos.length) return res.status(400).json({ error: { message: 'No videos provided' } });

  console.log(`Concatenating ${videos.length} videos...`);

  try {
    // Check ffmpeg availability
    let ffmpegCmd = 'ffmpeg';
    try {
      execSync('ffmpeg -version', { stdio: 'pipe' });
    } catch (e) {
      // Try common Windows paths
      const paths = [
        'C:\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
        'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe'
      ];
      ffmpegCmd = paths.find(p => fs.existsSync(p)) || 'ffmpeg';
    }

    // Download all videos
    const localFiles = [];
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      const ext = v.url.match(/\.(mp4|mov|avi|mkv|webm)/i)?.[0]?.toLowerCase() || '.mp4';
      const fname = `concat_${i}_${Date.now()}${ext}`;
      const localPath = path.join(TEMP_DIR, fname);
      
      console.log(`Downloading video ${i + 1}/${videos.length}: ${v.url.substring(0, 80)}...`);
      const resp = await fetch(v.url);
      if (!resp.ok) throw new Error(`Failed to download video ${i + 1}: HTTP ${resp.status}`);
      const buffer = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(localPath, buffer);
      localFiles.push(localPath);
      console.log(`  Downloaded ${i + 1}: ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);
    }

    // Create concat list file
    const listFile = path.join(TEMP_DIR, `concat_list_${Date.now()}.txt`);
    const listContent = localFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    // Run ffmpeg to concatenate
    const outputFile = `merged_${Date.now()}.mp4`;
    const outputPath = path.join(TEMP_DIR, outputFile);

    console.log('Running ffmpeg concatenation...');
    const ffmpegArgs = [
      '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-preset', 'fast',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegCmd, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) { console.log('ffmpeg concat success'); resolve(); }
        else { console.error('ffmpeg stderr:', stderr); reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`)); }
      });
      proc.on('error', reject);
    });

    // Cleanup temp files
    localFiles.forEach(f => { try { fs.unlinkSync(f); } catch (e) {} });
    try { fs.unlinkSync(listFile); } catch (e) {}

    const stat = fs.statSync(outputPath);
    console.log(`Merged video: ${outputFile} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

    res.json({
      success: true,
      url: `/media/${outputFile}`,
      filename: outputFile,
      size: stat.size,
      segments: videos.length
    });
  } catch (err) {
    console.error('Concat error:', err.message);
    res.status(500).json({ error: { message: `Concat error: ${err.message}` } });
  }
});

// === Check ffmpeg availability ===
app.get('/api/ffmpeg-check', (req, res) => {
  try {
    const out = execSync('ffmpeg -version', { stdio: 'pipe', timeout: 5000 }).toString();
    const version = out.split('\n')[0];
    res.json({ available: true, version });
  } catch (e) {
    const paths = [
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe'
    ];
    const found = paths.find(p => fs.existsSync(p));
    if (found) {
      try {
        const out = execSync(`"${found}" -version`, { stdio: 'pipe', timeout: 5000 }).toString();
        res.json({ available: true, version: out.split('\n')[0], path: found });
      } catch (e2) {
        res.json({ available: false });
      }
    } else {
      res.json({ available: false });
    }
  }
});

const httpServer = app.listen(PORT, () => {
  console.log(`\n  AI Studio Pro running at http://localhost:${PORT}\n`);
});

// === Version info ===
app.get('/api/version', (req, res) => {
  try {
    const pkg = require('./package.json');
    res.json({ version: pkg.version, name: pkg.name });
  } catch (e) {
    res.json({ version: '0.0.0', name: 'ai-studio-pro' });
  }
});

module.exports = httpServer;
