import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * WeaveCanvas ↔ doubao-bridge 集成测试
 *
 * 覆盖：预置供应商注册、桥接生命周期（自启/停止/重启）、账号池代理、
 *      一键把 video 用途切到豆包号池。
 *
 * 全程用临时数据目录 + 干跑模式（DOUBAO_BRIDGE_MOCK=1），不碰真实账号与额度。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? `  ${extra}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ''}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const PORT = await unusedPort();
let BRIDGE_PORT = await unusedPort();
while (BRIDGE_PORT === PORT || BRIDGE_PORT === 9788) BRIDGE_PORT = await unusedPort();
const BASE = `http://127.0.0.1:${PORT}`;

async function call(method, url, body) {
  const r = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, ok: r.ok, json, text };
}

async function waitHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch { /* 还没起来 */ }
    await sleep(300);
  }
  return false;
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-bridge-it-'));
  const bridgeDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbv-it-'));

  console.log(`集成测试\n  数据目录      ${dataDir}\n  桥接数据目录  ${bridgeDataDir}\n`);

  let child;
  try {
    child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        DOUBAO_BRIDGE_PORT: String(BRIDGE_PORT),
        WEAVE_DATA_DIR: dataDir,
        DOUBAO_BRIDGE_DATA_DIR: bridgeDataDir,   // 隔离桥接的账号台账
        DOUBAO_BRIDGE_MOCK: '1',                 // 干跑：不碰浏览器
        WEAVE_DOUBAO_BRIDGE_DIR: path.resolve(ROOT, '..', 'doubao-bridge'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(bridgeDataDir, { recursive: true, force: true });
    throw error;
  }
  const serverLogs = [];
  child.stdout.on('data', (d) => serverLogs.push(d.toString()));
  child.stderr.on('data', (d) => serverLogs.push(`ERR ${d}`));
  // 桥接是不是本实例拉起的 —— 决定收尾时能不能停它（单例，可能是别的实例在用的共享桥接）
  let ownsBridge = false;

  try {
    ok('WeaveCanvas 服务可启动', await waitHealth(), `:${PORT}`);
    if (!(await waitHealth(1000))) {
      console.log(serverLogs.slice(-10).join(''));
      return;
    }

    /* ---- 1. 预置供应商 ---- */
    const providers = await call('GET', '/api/providers');
    const doubao = (providers.json?.data || []).find((p) => p.name === '豆包（网页版号池）');
    ok('启动时自动注册了「豆包（网页版号池）」供应商', !!doubao, doubao?.name || '未找到');
    ok('  协议为 openai-video（与桥接逐条对齐）', doubao?.protocol === 'openai-video', doubao?.protocol);
    ok('  base_url 指向本地桥接', /127\.0\.0\.1:\d+\/v1$/.test(doubao?.base_url || ''), doubao?.base_url);
    ok('  已带默认 Key（本地服务不校验但必填）', doubao?.has_key === true || !!doubao?.api_key, '');
    ok('  模型清单含免费额度模型',
      (doubao?.models || []).some((m) => String(m.id || m).includes('seedance')), '');

    /* ---- 2. 桥接状态（此时应已被开机自启拉起；自启是异步的，给它最多 25 秒） ---- */
    let st = await call('GET', '/api/doubao/status');
    ok('状态接口可用', st.json?.success === true);
    // 本机可能没有桥接目录（如 CI 构建机）：桥接相关用例整体跳过，不能算失败
    const bridgeFound = st.json?.data?.found === true;
    ok('找到桥接目录', bridgeFound, bridgeFound ? (st.json?.data?.dir || '') : 'SKIP：本机无桥接目录');
    if (!bridgeFound) console.log('\n  （SKIP）本机没有豆包桥接目录，桥接相关用例全部跳过');
    if (bridgeFound) {
    const upDeadline = Date.now() + 25000;
    while (Date.now() < upDeadline) {
      if (st.json?.data?.running) break;
      st = await call('GET', '/api/doubao/status');
      if (st.json?.data?.running) break;
      await sleep(700);
    }
    if (!st.json?.data?.running) {
      console.log('\n  ── 桥接未运行，诊断信息 ──');
      console.log(`  lastError: ${st.json?.data?.lastError}`);
      for (const l of (st.json?.data?.logs || [])) console.log(`  ${l}`);
      const childLog = path.join(dataDir, 'doubao-bridge-child.log');
      if (fs.existsSync(childLog)) {
        console.log('  ── 桥接子进程日志 ──');
        for (const l of fs.readFileSync(childLog, 'utf8').split('\n').slice(-30)) console.log(`  ${l}`);
      } else {
        console.log(`  ── 桥接子进程日志文件不存在：${childLog} ──`);
      }
      console.log('  ── 服务端日志 ──');
      for (const l of serverLogs.slice(-15)) console.log(`  ${l.trim()}`);
      // 关键判别：从测试进程直连桥接端口，看它到底有没有在监听
      try {
        const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/health`, { signal: AbortSignal.timeout(2500) });
        console.log(`  ── 从测试进程直连 ${BRIDGE_PORT}：HTTP ${r.status} → ${(await r.text()).slice(0, 120)}`);
      } catch (e) {
        console.log(`  ── 从测试进程直连 ${BRIDGE_PORT}：失败（${e.message}）→ 桥接确实没在监听`);
      }
      console.log('');
    }
    ok('桥接已随软件自动启动', st.json?.data?.running === true, `baseUrl=${st.json?.data?.baseUrl}`);
    ok('返回号池快照', !!st.json?.data?.pool, `账号数 ${st.json?.data?.pool?.accountCount}`);
    ok('状态里带上预置供应商信息', st.json?.data?.provider?.name === '豆包（网页版号池）');
    }  // ← bridgeFound：无桥接目录时，以上桥接状态用例到此为止

    // 桥接是单例（固定端口）。若此刻已有别的 WeaveCanvas 实例在跑，本实例会复用它 ——
    // 那是一个**共享的、用户真实的号池**，绝不能拿它跑会改数据的用例（否则会往真实号池里塞测试账号）。
    ownsBridge = bridgeFound && st.json?.data?.spawnedByUs === true;

    /* ---- 3. 账号池代理 ---- */
    if (!bridgeFound) {
      console.log('  （SKIP）本机没有桥接目录，跳过账号池用例');
    } else {
      let accounts = await call('GET', '/api/doubao/accounts');
      ok('代理读取账号列表', Array.isArray(accounts.json?.data) && accounts.json.data.length >= 1,
        `共 ${accounts.json?.data?.length} 个`);
    }

    if (!ownsBridge) {
      console.log('  （桥接由别的实例启动，跳过所有会改动号池的用例，只做只读校验）');
    } else {

    const created = await call('POST', '/api/doubao/accounts', { alias: '集成测试号' });
    ok('代理新增账号', created.json?.data?.id?.startsWith('acc_'), created.json?.data?.id || created.json?.error);
    ok('  自动分配了独立调试端口', created.json?.data?.debugPort > 0, `:${created.json?.data?.debugPort}`);

    const accId = created.json?.data?.id;
    const renamed = await call('PUT', `/api/doubao/accounts/${accId}`, { alias: '改名后' });
    ok('代理改别名', renamed.json?.data?.alias === '改名后', renamed.json?.data?.alias);

    const cooled = await call('POST', `/api/doubao/accounts/${accId}/cooldown`, { seconds: 30, reason: '测试' });
    ok('代理手动冷却', cooled.json?.data?.status === 'cooling', cooled.json?.data?.status);

    const recovered = await call('POST', `/api/doubao/accounts/${accId}/recover`);
    ok('代理手动恢复', recovered.json?.data?.status === 'active', recovered.json?.data?.status);

    st = await call('GET', '/api/doubao/status');
    ok('状态里的账号数已更新', st.json?.data?.pool?.accountCount === 2, `${st.json?.data?.pool?.accountCount}`);

    const removed = await call('DELETE', `/api/doubao/accounts/${accId}`);
    ok('代理删除账号', removed.json?.success === true);

    }  // ← ownsBridge：改动号池的用例到此为止

    /* ---- 4. 一键把 video 用途切到豆包号池 ---- */
    // 前置：/api/ai-config 内部会对每行调 resolveTarget，全新库 key 为空会整体报错，
    // 所以先给各用途填一个占位 Key（真实使用场景里用户本来就会配好）。
    for (const purpose of ['thinking', 'image_gen', 'video']) {
      const r = await call('PUT', `/api/ai-config/${purpose}`, { api_key: 'placeholder-key', model_id: 'placeholder-model' });
      if (!r.json?.success) console.log(`  提示：设置 ${purpose} 占位 Key 失败：${r.json?.error}`);
    }
    const sane = await call('GET', '/api/ai-config');
    ok('前置：ai-config 可读取', Array.isArray(sane.json?.data) && sane.json.data.length === 3,
      sane.json?.error || `${sane.json?.data?.length} 行`);

    const use = await call('POST', '/api/doubao/use-for-video', { model: 'doubao-seedance-2-0-fast' });
    ok('一键切换 video 用途', use.json?.success === true, use.json?.data?.model || use.json?.error);

    const cfg = await call('GET', '/api/ai-config');
    const rows = cfg.json?.data || [];
    const video = rows.find((c) => c.purpose === 'video');
    if (!video || video.provider_id !== doubao?.id) {
      console.log(`\n  ── ai-config 诊断 ──`);
      console.log(`  供应商 id（来自 /api/providers）: ${JSON.stringify(doubao?.id)}`);
      console.log(`  /api/ai-config 返回 ${rows.length} 行：${rows.map((r) => r.purpose).join(', ')}`);
      console.log(`  video 行: ${JSON.stringify(video, null, 2)}`);
      console.log('');
    }
    ok('  video 用途已指向豆包供应商', video?.provider_id === doubao?.id, `实际=${video?.provider_id} 期望=${doubao?.id}`);
    ok('  模型已设为 Seedance', video?.model_id === 'doubao-seedance-2-0-fast', video?.model_id || '');
    ok('  Base URL 已写入', /127\.0\.0\.1:\d+\/v1$/.test(video?.base_url || ''), video?.base_url || '');

    /* ---- 5. 生命周期：停止 / 重启 ---- */
    // 这两个用例会真的把桥接停掉。桥接是单例，若此刻是别的实例在用，停它会波及对方 ——
    // 所以只在「桥接由本实例启动」时才测。
    if (!ownsBridge) {
      console.log('  （桥接是共享的，跳过停止/重启用例，避免影响别的实例）');
    } else {
      await call('POST', '/api/doubao/stop');
      await sleep(1500);
      st = await call('GET', '/api/doubao/status');
      ok('停止后状态为未运行', st.json?.data?.running === false);

      const restarted = await call('POST', '/api/doubao/start');
      ok('可重新启动', restarted.json?.data?.ok === true,
        restarted.json?.data?.error || `already=${restarted.json?.data?.already}`);

      st = await call('GET', '/api/doubao/status');
      ok('重启后恢复可用', st.json?.data?.running === true);
    }

    /* ---- 6. 非 API 配置不应被破坏（回归） ---- */
    const list = await call('GET', '/api/scripts');
    ok('原有接口未受影响（/api/scripts）', list.json?.success === true);
    const models = await call('GET', '/api/models?purpose=video');
    ok('原有模型接口未受影响（/api/models）', models.json?.success === true);

    /* ---- 7. 配置持久化 ---- */
    const settings = await call('PUT', '/api/doubao/settings', { auto: false });
    ok('可关闭开机自启', settings.json?.data?.auto === false);

    await call('PUT', '/api/doubao/settings', { auto: true });
    ok('可重新打开开机自启', (await call('GET', '/api/doubao/status')).json?.data?.auto === true);

    const badDir = await call('PUT', '/api/doubao/settings', { dir: 'C:\\definitely\\not\\a\\bridge' });
    ok('无效桥接目录被拒绝', badDir.status >= 400, `HTTP ${badDir.status}`);
  } catch (e) {
    ok('测试过程未抛异常', false, e.message);
  } finally {
    // 只停自己拉起的桥接：若不是自己启的，说明有别的实例在用它，停掉会影响对方
    if (ownsBridge) {
      try { await call('POST', '/api/doubao/stop'); } catch { /* ignore */ }
    } else {
      console.log('  （桥接非本实例所有，收尾时不停它）');
    }
    await sleep(800);
    child.kill();
    await sleep(800);
    for (const d of [dataDir, bridgeDataDir]) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}

main();
