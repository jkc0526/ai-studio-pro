import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

/* 管理员导出（v0.7.9）：
   A. 未设密码时 /api/admin/status.configured=false，设置后需旧密码才能改
   B. 未登录导出 withKeys=1 → 401；密码错误登录 → 403
   C. 登录后 withKeys=1 导出 schemaVersion=2 且包含 API Key；普通导出仍不含 Key
   D. 管理员配置（v2）导入后 API Key 一并写回 provider / ai_config */
if (isMainThread) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weave-admin-export-'));
  try {
    await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: dataDir });
      let result;
      worker.once('message', (message) => { result = message; });
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(new Error(`admin export test worker exited with code ${code}${result?.error ? `: ${result.error}` : ''}`));
        else if (result?.error) reject(new Error(result.error));
        else resolve();
      });
    });
  } finally { await fs.rm(dataDir, { recursive: true, force: true }); }
} else {
  process.env.WEAVE_DATA_DIR = workerData;
  const { app } = await import('../server/index.js');
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const secret = 'sk-admin-roundtrip-secret';
  const post = async (url, body, headers = {}) => {
    const res = await fetch(`${base}${url}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: res.status, payload: await res.json().catch(() => null) };
  };
  try {
    // A. 状态与设置
    let st = await (await fetch(`${base}/api/admin/status`)).json();
    assert.equal(st.data.configured, false);
    const tooShort = await post('/api/admin/setup', { password: 'abc' });
    assert.equal(tooShort.status, 400);
    const setup = await post('/api/admin/setup', { password: 'admin-pass-1' });
    assert.equal(setup.status, 200);
    const reSetup = await post('/api/admin/setup', { password: 'hack-attempt' });
    assert.equal(reSetup.status, 403, '已设置密码后必须提供旧密码');
    st = await (await fetch(`${base}/api/admin/status`)).json();
    assert.equal(st.data.configured, true);

    // B. 未登录导出被拒、错误密码被拒
    const denied = await fetch(`${base}/api/config/export?withKeys=1`);
    assert.equal(denied.status, 401);
    const badLogin = await post('/api/admin/login', { password: 'wrong' });
    assert.equal(badLogin.status, 403);
    const login = await post('/api/admin/login', { password: 'admin-pass-1' });
    assert.equal(login.status, 200);
    const token = login.payload.data.token;

    // C. 管理员导出含 Key，普通导出不含
    const seeded = await fetch(`${base}/api/config/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        app: 'weave-canvas', schemaVersion: 2,
        providers: [{ id: 'pv_admin_test', name: '管理员渠道', protocol: 'openai', base_url: 'http://127.0.0.1:9/v1', api_key: secret, models: [{ id: 'm-1', capability: 'image' }] }],
        aiConfigs: [{ purpose: 'image_gen', provider: 'openai', base_url: 'http://127.0.0.1:9/v1', model_id: 'm-1', provider_id: 'pv_admin_test', api_key: secret }],
      }),
    });
    assert.equal(seeded.status, 200);

    const adminExport = await (await fetch(`${base}/api/config/export?withKeys=1`, { headers: { 'x-admin-token': token } })).json();
    assert.equal(adminExport.data.schemaVersion, 2);
    assert.equal(adminExport.data.withKeys, true);
    assert.ok(JSON.stringify(adminExport).includes(secret), 'admin export must contain the API key');
    const exportedProvider = adminExport.data.providers.find((item) => item.name === '管理员渠道');
    assert.equal(exportedProvider.api_key, secret);
    const exportedConfig = adminExport.data.aiConfigs.find((item) => item.purpose === 'image_gen');
    assert.equal(exportedConfig.api_key, secret);

    const plainExport = await (await fetch(`${base}/api/config/export`)).json();
    assert.equal(plainExport.data.schemaVersion, 1);
    assert.equal(JSON.stringify(plainExport).includes(secret), false);

    // D. Key 确实写回了 provider（/api/providers 只返回 has_key，不回显明文）
    const providersPayload = await (await fetch(`${base}/api/providers`)).json();
    const importedProvider = providersPayload.data.find((item) => item.name === '管理员渠道');
    assert.equal(importedProvider.has_key, true, 'provider api_key must be written on v2 import');
    // ai_config 写回已由 C 中 adminExport 的 aiConfigs[].api_key 证明（导出即读库）

    console.log('admin export tests passed');
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ error: error.stack || error.message });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
