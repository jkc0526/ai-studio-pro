import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { q, ROOT, DATA_DIR } from './db.js';

/* ============================================================
   豆包号池桥接服务（doubao-bridge）生命周期管理
   - 定位桥接目录（环境变量 / kv 配置 / 自动探测）
   - 健康检查、自动拉起、停止
   - 把桥接的 HTTP API 代理给前端
   桥接本身是独立进程（零依赖 Node 服务），不侵入 WeaveCanvas 主逻辑。
   ============================================================ */

const DEFAULT_PORT = 9788;
const KV_DIR = 'doubao_bridge_dir';
const KV_AUTO = 'doubao_bridge_auto';

let child = null;
let spawnedByUs = false;
let lastError = null;
let startedAt = null;
let logs = [];
let launching = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pushLog(chunk) {
  const text = String(chunk).split('\n').map((s) => s.trim()).filter(Boolean).join('\n');
  if (!text) return;
  for (const line of text.split('\n')) {
    logs.push(`[${new Date().toTimeString().slice(0, 8)}] ${line}`);
  }
  if (logs.length > 300) logs = logs.slice(-300);
}

/* ---------------- 定位 ---------------- */

export function candidateDirs() {
  const list = [];
  if (process.env.WEAVE_DOUBAO_BRIDGE_DIR) list.push(process.env.WEAVE_DOUBAO_BRIDGE_DIR);
  const fromKv = q.one('SELECT value FROM kv WHERE key = ?', KV_DIR)?.value;
  if (fromKv) list.push(fromKv);
  // 与 weave-canvas 同级的 doubao-bridge（开发模式常见布局）
  list.push(path.resolve(ROOT, '..', 'doubao-bridge'));
  list.push(path.resolve(ROOT, '..', '..', 'doubao-bridge'));
  if (process.env.USERPROFILE) list.push(path.join(process.env.USERPROFILE, 'doubao-bridge'));
  list.push('E:\\work Buddy\\doubao-bridge');
  return [...new Set(list.filter(Boolean))];
}

export function isBridgeDir(dir) {
  try {
    return !!dir && fs.existsSync(path.join(dir, 'src', 'server.js')) && fs.existsSync(path.join(dir, 'config.json'));
  } catch { return false; }
}

export function resolveBridgeDir() {
  return candidateDirs().find(isBridgeDir) || null;
}

export function readBridgeConfig(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8')); } catch { return {}; }
}

export function bridgePort(dir) {
  const port = Number(process.env.DOUBAO_BRIDGE_PORT || readBridgeConfig(dir).port);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
}

export function bridgeBaseUrl(dir) {
  return `http://127.0.0.1:${bridgePort(dir)}`;
}

/**
 * 桥接声明的模型清单 → WeaveCanvas 供应商的 models 结构。
 * 以桥接的 config.json 为**单一数据源**，避免两边各硬编码一份导致不同步。
 */
export function bridgeModels(dir = null) {
  const d = dir || resolveBridgeDir();
  if (!d) return null;
  const models = readBridgeConfig(d).models;
  if (!Array.isArray(models) || !models.length) return null;
  return models.map((m) => ({ id: m.id, name: m.label || m.uiText || m.id }));
}

/** 桥接配置里声明的默认模型（便宜的那个，不是 5 倍消耗的旗舰） */
export function bridgeDefaultModel(dir = null) {
  const d = dir || resolveBridgeDir();
  return readBridgeConfig(d)?.defaults?.model || 'doubao-seedance-2-0-fast';
}

/** 模型完整信息（含消耗倍率），用于界面展示 */
export function bridgeModelDetails(dir = null) {
  const d = dir || resolveBridgeDir();
  const models = readBridgeConfig(d)?.models;
  if (!Array.isArray(models)) return [];
  return models.map((m) => ({
    id: m.id,
    label: m.label || m.uiText || m.id,
    uiText: m.uiText || m.id,
    costMultiplier: Math.max(1, Number(m.costMultiplier) || 1),
    premium: !!m.premium,
  }));
}

export function setBridgeDir(dir) {
  const value = String(dir || '').trim();
  if (value && !isBridgeDir(value)) {
    throw new Error(`该目录不是有效的桥接目录（需包含 src/server.js 与 config.json）：${value}`);
  }
  q.run('INSERT INTO kv (key, value, update_time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, update_time=excluded.update_time',
    KV_DIR, value, new Date().toISOString());
  return value;
}

export function setAutoStart(on) {
  q.run('INSERT INTO kv (key, value, update_time) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, update_time=excluded.update_time',
    KV_AUTO, on ? '1' : '0', new Date().toISOString());
  return !!on;
}

export function getAutoStart() {
  return (q.one('SELECT value FROM kv WHERE key = ?', KV_AUTO)?.value ?? '1') === '1';
}

/* ---------------- 通信 ---------------- */

async function ping(baseUrl, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(timer); }
}

/** 代理一次请求到桥接服务 */
export async function bridgeFetch(pathname, init = {}, timeoutMs = 240000) {
  const dir = resolveBridgeDir();
  if (!dir) throw Object.assign(new Error('未找到 doubao-bridge 目录，请在设置里指定'), { status: 400 });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${bridgeBaseUrl(dir)}${pathname}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    if (!r.ok) {
      throw Object.assign(new Error(data?.error?.message || `桥接服务返回 HTTP ${r.status}`), { status: 502 });
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('桥接服务响应超时'), { status: 504 });
    if (e.status) throw e;
    throw Object.assign(new Error(`无法连接桥接服务（${e.message}）。请先在设置里启动桥接。`), { status: 502 });
  } finally { clearTimeout(timer); }
}

/* ---------------- 生命周期 ---------------- */

export async function status() {
  const dir = resolveBridgeDir();
  const base = dir ? bridgeBaseUrl(dir) : null;
  const healthy = base ? await ping(base) : null;

  let pool = null;
  let bridgeVersion = null;
  if (healthy) {
    try {
      const r = await fetch(`${base}/v1/pool`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) pool = await r.json();
    } catch { /* 忽略 */ }
    bridgeVersion = healthy.version || null;
  }

  return {
    found: !!dir,
    running: !!healthy,
    dir,
    port: dir ? bridgePort(dir) : DEFAULT_PORT,
    baseUrl: base,
    version: bridgeVersion,
    candidates: candidateDirs(),
    auto: getAutoStart(),
    spawnedByUs,
    startedAt,
    lastError,
    pool,
    logs: logs.slice(-40),
    installHint: dir ? null : '未找到 doubao-bridge 目录。请把 doubao-bridge 放在 weave-canvas 同级目录，或在下方手动指定路径。',
  };
}

/** 启动桥接（幂等：已在跑则直接返回） */
export async function start({ waitMs = 20000 } = {}) {
  const dir = resolveBridgeDir();
  if (!dir) {
    lastError = '未找到 doubao-bridge 目录';
    return { ok: false, error: lastError };
  }
  const base = bridgeBaseUrl(dir);
  if (await ping(base)) return { ok: true, already: true, baseUrl: base };

  if (launching) return launching;

  launching = (async () => {
    pushLog(`启动桥接服务：${dir}`);
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    delete env.ELECTRON_NO_ATTACH_CONSOLE;
    delete env.NODE_OPTIONS;

    try {
      child = spawn(process.execPath, [path.join(dir, 'src', 'server.js')], {
        cwd: dir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      lastError = `无法启动桥接进程：${e.message}`;
      return { ok: false, error: lastError };
    }

    spawnedByUs = true;
    pushLog(`已 spawn 桥接进程 pid=${child.pid}，stdout=${child.stdout ? 'ok' : 'null'}`);
    // 子进程输出同时进内存环形缓冲和落盘日志（排障用）
    let childLog = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      childLog = fs.createWriteStream(path.join(DATA_DIR, 'doubao-bridge-child.log'), { flags: 'a' });
      childLog.write(`\n===== ${new Date().toISOString()} 启动 ${process.execPath} =====\n`);
    } catch { /* 写不了就算了 */ }
    const tap = (chunk, prefix = '') => {
      pushLog(prefix + chunk);
      try { childLog?.write(prefix + chunk); } catch { /* ignore */ }
    };
    child.stdout?.on('data', (d) => tap(d));
    child.stderr?.on('data', (d) => tap(d, 'ERR '));
    child.on('error', (e) => { lastError = `桥接进程错误：${e.message}`; pushLog(lastError); });
    child.on('exit', (code, signal) => {
      pushLog(`桥接进程退出（code=${code} signal=${signal}）`);
      if (code) lastError = `桥接进程异常退出（code ${code}），详见数据目录下的 doubao-bridge-child.log`;
      child = null;
      spawnedByUs = false;
      startedAt = null;
      try { childLog?.end(); } catch { /* ignore */ }
    });

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(400);
      if (await ping(base)) {
        startedAt = new Date().toISOString();
        lastError = null;
        pushLog(`桥接已就绪：${base}`);
        return { ok: true, started: true, baseUrl: base };
      }
    }
    lastError = `桥接启动后 ${Math.round(waitMs / 1000)} 秒内未就绪，请查看日志`;
    return { ok: false, error: lastError, logs: logs.slice(-20) };
  })();

  try { return await launching; } finally { launching = null; }
}

/** 只停止由本进程拉起的桥接，避免误关其他软件实例共用的服务。 */
export async function stop({ waitMs = 8000 } = {}) {
  const dir = resolveBridgeDir();
  const base = dir ? bridgeBaseUrl(dir) : null;
  const running = base ? !!(await ping(base, 1000)) : false;

  if (!running && !child) return { ok: true, already: true };
  if (!child) return { ok: false, error: '桥接由其他进程启动，本软件不会关闭共享服务；请在原启动程序中停止它' };

  pushLog('停止由本进程拉起的桥接');
  try { child.kill(); } catch (e) { pushLog(`kill 失败：${e.message}`); }
  child = null;
  spawnedByUs = false;
  startedAt = null;

  // 等端口真正释放（否则紧接着 start() 会误判成"已在运行"）
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await sleep(300);
    if (base && !(await ping(base, 800))) {
      pushLog('桥接已停止');
      return { ok: true, stopped: true };
    }
    if (!base) return { ok: true, stopped: true };
  }
  return { ok: false, error: `桥接在 ${Math.round(waitMs / 1000)} 秒内没有停止` };
}

export async function restart() {
  const stopped = await stop();
  if (!stopped.ok) return stopped;
  await sleep(700);
  return start();
}

/** 开机自启（供 startServer 调用，失败不阻塞主流程） */
export async function autoStart() {
  try {
    if (!getAutoStart()) return { ok: false, skipped: '自动启动已关闭' };
    const dir = resolveBridgeDir();
    if (!dir) return { ok: false, skipped: '未找到桥接目录' };
    if (await ping(bridgeBaseUrl(dir))) return { ok: true, already: true };
    return await start();
  } catch (e) {
    lastError = e.message;
    return { ok: false, error: e.message };
  }
}

export function recentLogs() { return logs.slice(-100); }
