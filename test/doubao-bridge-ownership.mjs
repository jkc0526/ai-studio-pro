import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-bridge-ownership-'));
const bridgeDir = path.join(root, 'bridge');
fs.mkdirSync(path.join(bridgeDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(bridgeDir, 'src', 'server.js'), '');
fs.writeFileSync(path.join(bridgeDir, 'config.json'), JSON.stringify({ port: 61234 }));
process.env.WEAVE_DATA_DIR = path.join(root, 'data');
process.env.WEAVE_DOUBAO_BRIDGE_DIR = bridgeDir;

const { db } = await import('../server/db.js');
const bridge = await import('../server/doubaoBridge.js');
process.env.DOUBAO_BRIDGE_PORT = '61235';
assert.equal(bridge.bridgePort(bridgeDir), 61235, 'host and bridge must agree on an isolated port override');
const originalFetch = globalThis.fetch;
let shutdownRequests = 0;
let appServer;
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/health')) return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  if (String(url).endsWith('/v1/shutdown') && init?.method === 'POST') shutdownRequests++;
  return new Response('{}', { status: 200 });
};

try {
  const stopped = await bridge.stop({ waitMs: 0 });
  assert.equal(stopped.ok, false, 'a bridge started by another process cannot be stopped automatically');
  assert.equal(shutdownRequests, 0, 'stopping this app must not shut down a shared bridge');
  const restarted = await bridge.restart();
  assert.equal(restarted.ok, false, 'restart must also preserve a shared bridge');
  assert.equal(shutdownRequests, 0);

  const { app } = await import('../server/index.js');
  appServer = await new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  const base = `http://127.0.0.1:${appServer.address().port}`;
  const stopResponse = await originalFetch(`${base}/api/doubao/stop`, { method: 'POST' });
  assert.equal(stopResponse.status, 409, 'API must not report an unsuccessful bridge stop as success');
  const restartResponse = await originalFetch(`${base}/api/doubao/restart`, { method: 'POST' });
  assert.equal(restartResponse.status, 409, 'API must not report an unsuccessful bridge restart as success');
  assert.equal(shutdownRequests, 0);
  console.log('doubao bridge ownership tests passed');
} finally {
  if (appServer) {
    appServer.closeAllConnections();
    await new Promise((resolve) => appServer.close(resolve));
  }
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
}
