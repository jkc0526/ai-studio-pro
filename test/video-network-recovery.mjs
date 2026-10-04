import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'weave-video-network-'));
process.env.WEAVE_DATA_DIR = temp;
const { db, q } = await import('../server/db.js');
const { builtinSpec, execute } = await import('../server/endpoint.js');
const originalFetch = globalThis.fetch;
const spec = () => {
  const s = builtinSpec({ kind: 'video', protocol: 'agnes-video', baseURL: 'https://vendor.test/v1',
    model: 'agnes-video-2.5-flash', vars: { mode: 'text', prompt: 'test', seconds: 4 } });
  s.poll.interval = 1;
  s.poll.max = 20;
  s.networkRetryDelays = [0, 0];
  s.connectRetryDelays = [0, 0];
  return s;
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const video = () => new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'Content-Type': 'video/mp4' } });
const disconnected = () => new TypeError('fetch failed', { cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }) });

try {
  let submissions = 0;
  globalThis.fetch = async () => { submissions++; throw disconnected(); };
  await assert.rejects(execute({ spec: spec(), kind: 'video', apiKey: 'secret-key' }), (error) => {
    assert.equal(error.phase, 'submit');
    assert.equal(error.networkCode, 'ECONNRESET');
    assert.match(error.message, /提交/);
    assert.doesNotMatch(error.message, /secret-key/);
    return true;
  });
  assert.equal(submissions, 1, 'uncertain POST failures must not create another paid task');

  submissions = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      if (++submissions === 1) throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } });
      return json({ video_id: 'connected-second-attempt' });
    }
    return String(url).includes('/agnesapi') ? json({ status: 'completed', url: 'https://cdn.test/connected.mp4' }) : video();
  };
  assert.match((await execute({ spec: spec(), kind: 'video', apiKey: 'secret-key' })).url, /\.mp4$/);
  assert.equal(submissions, 2, 'a connection that never opened can be retried before any request was sent');

  let polls = 0;
  submissions = 0;
  const receipts = [];
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { submissions++; return json({ video_id: 'accepted-one', status: 'queued' }); }
    if (String(url).includes('/agnesapi')) {
      if (++polls === 1) throw disconnected();
      return json({ status: 'completed', url: 'https://cdn.test/result.mp4' });
    }
    return video();
  };
  const recovered = await execute({ spec: spec(), kind: 'video', apiKey: 'secret-key', onTask: (task) => receipts.push({ ...task }) });
  assert.match(recovered.url, /^\/outputs\/.*\.mp4$/);
  assert.equal(submissions, 1);
  assert.equal(polls, 2);
  assert.equal(receipts[0].id, 'accepted-one', 'save the task before its first poll');
  assert.equal(receipts.at(-1).status, 'completed');

  let downloads = 0;
  submissions = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { submissions++; return json({ video_id: 'accepted-two' }); }
    if (String(url).includes('/agnesapi')) return json({ status: 'completed', url: 'https://cdn.test/result.mp4' });
    downloads++;
    if (downloads === 1) return { ok: true, headers: new Headers(), arrayBuffer: async () => { throw disconnected(); } };
    return video();
  };
  assert.match((await execute({ spec: spec(), kind: 'video', apiKey: 'secret-key' })).url, /\.mp4$/);
  assert.equal(submissions, 1);
  assert.equal(downloads, 2, 'retry a broken download without regenerating the video');

  let latestReceipt;
  submissions = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'POST') { submissions++; return json({ video_id: 'recover-next-run' }); }
    throw disconnected();
  };
  await assert.rejects(execute({ spec: spec(), kind: 'video', apiKey: 'secret-key',
    onTask: (task) => { latestReceipt = { ...task }; } }), (error) => {
    assert.equal(error.phase, 'poll');
    assert.equal(error.taskId, 'recover-next-run');
    assert.match(error.message, /recover-next-run/);
    return true;
  });
  assert.equal(latestReceipt.id, 'recover-next-run');
  globalThis.fetch = async (url, options = {}) => {
    assert.notEqual(options.method, 'POST', 'resuming must only query the original task');
    return String(url).includes('/agnesapi') ? json({ status: 'completed', url: 'https://cdn.test/resumed.mp4' }) : video();
  };
  assert.match((await execute({ spec: spec(), kind: 'video', apiKey: 'secret-key', resumeTask: latestReceipt })).url, /\.mp4$/);
  assert.equal(submissions, 1);

  globalThis.fetch = async (url, options = {}) => options.method === 'POST'
    ? json({ video_id: 'auth-failed' }) : json({ error: { message: 'token expired' } }, 401);
  await assert.rejects(execute({ spec: spec(), kind: 'video', apiKey: 'secret-key' }), /鉴权失败/,
    'an explicit auth rejection must not turn into a generic polling timeout');

  const { app } = await import('../server/index.js');
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const local = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, body) => {
      const r = await originalFetch(local + route, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal(r.status, 200);
      return (await r.json()).data;
    };
    q.run("INSERT INTO provider (id,name,protocol,base_url,api_key,enabled) VALUES (?,?,?,?,?,1)",
      'network-vendor', 'Test', 'agnes-video', 'https://vendor.test/v1', 'secret-key');
    const canvas = await request('/api/canvases', { title: 'Recovery test' });
    const input = { stream: false, canvasId: canvas.id, nodeIds: ['video'], canvas: { edges: [], nodes: [
      { id: 'video', type: 'videoNode', data: { prompt: 'test', mode: 'text', modelId: 'agnes-video-2.5-flash', providerId: 'network-vendor' } },
    ] } };
    await originalFetch(local + `/api/canvases/${canvas.id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas: input.canvas }) });
    const loadVideo = async () => (await (await originalFetch(local + `/api/canvases/${canvas.id}`)).json()).data.canvas.nodes[0].data;
    submissions = 0;
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') { submissions++; return json({ video_id: 'saved-server-side' }); }
      const log = q.one('SELECT steps_json FROM run_log WHERE canvas_id = ? ORDER BY create_time DESC LIMIT 1', canvas.id);
      assert.equal(JSON.parse(log.steps_json)[0].upstreamTask.id, 'saved-server-side',
        'task receipt must already be durable while polling is still in progress');
      throw disconnected();
    };
    const interrupted = await request('/api/run', input);
    assert.equal(interrupted.status, 'failed');
    assert.equal(interrupted.steps[0].upstreamTask.id, 'saved-server-side');
    assert.equal(interrupted.steps[0].networkCode, 'ECONNRESET');
    assert.equal((await loadVideo()).upstreamTask?.id, 'saved-server-side',
      'refresh must expose the durable receipt before the next generate action');
    globalThis.fetch = async (url, options = {}) => {
      assert.notEqual(options.method, 'POST', 'the next canvas run recovers its saved task without a new charge');
      return String(url).includes('/agnesapi') ? json({ status: 'completed', url: 'https://cdn.test/recovered.mp4' }) : video();
    };
    input.canvas.nodes[0].data.mode = 'omni';
    input.canvas.nodes.push({ id: 'lost-reference', type: 'imageNode', data: { status: 'error', prompt: 'old reference' } });
    input.canvas.edges = [{ id: 'ref-link', source: 'lost-reference', target: 'video' }];
    const nextRun = await request('/api/run', input);
    assert.equal(nextRun.status, 'success');
    assert.equal(nextRun.steps[0].upstreamTask.status, 'completed');
    assert.equal(q.one("SELECT COUNT(*) n FROM asset WHERE node_id = 'video' AND media_type = 'video'").n, 1);
    assert.equal(submissions, 1);
    assert.equal((await loadVideo()).videoUrl, nextRun.steps[0].upstreamTask.localUrl,
      'refresh must recover the completed video even if the client missed the final event');
    const editedCanvas = structuredClone(input.canvas);
    editedCanvas.nodes[0].data.prompt = 'a different generation';
    await originalFetch(local + `/api/canvases/${canvas.id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas: editedCanvas }) });
    assert.equal((await loadVideo()).videoUrl, undefined, 'old results must not overwrite an edited prompt');
    await originalFetch(local + `/api/canvases/${canvas.id}`, { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canvas: input.canvas }) });

    input.canvas.nodes = [input.canvas.nodes[0]];
    input.canvas.edges = [];
    input.canvas.nodes[0].data.mode = 'text';
    input.canvas.nodes[0].data.upstreamTask = interrupted.steps[0].upstreamTask;
    input.freshNodeIds = ['video'];
    globalThis.fetch = async (url, options = {}) => options.method === 'POST'
      ? (submissions++, json({ video_id: 'explicitly-new-task' }))
      : String(url).includes('/agnesapi') ? json({ status: 'completed', url: 'https://cdn.test/new.mp4' }) : video();
    const freshRun = await request('/api/run', input);
    assert.equal(freshRun.steps[0].upstreamTask.id, 'explicitly-new-task');
    assert.equal(submissions, 2, 'only an explicit fresh action creates the next generation');

    const nativeInterval = globalThis.setInterval;
    let releasePoll;
    const pollGate = new Promise((resolve) => { releasePoll = resolve; });
    globalThis.setInterval = (fn, ms, ...args) => nativeInterval(fn, ms === 15000 ? 5 : ms, ...args);
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') return json({ video_id: 'heartbeat-task' });
      if (String(url).includes('/agnesapi')) {
        await pollGate;
        return json({ status: 'completed', url: 'https://cdn.test/heartbeat.mp4' });
      }
      return video();
    };
    try {
      const response = await originalFetch(local + '/api/run', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, stream: true }),
        signal: AbortSignal.timeout(2000) });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      try {
        while (!text.includes(': ping')) {
          const chunk = await reader.read();
          assert.equal(chunk.done, false, 'generation stream must remain open');
          text += decoder.decode(chunk.value);
        }
      } catch (error) {
        assert.fail(`Idle generation stream had no keepalive: ${error.message}`);
      }
      releasePoll();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }
      assert.match(text, /event: done/);
    } finally {
      releasePoll();
      globalThis.setInterval = nativeInterval;
      // Let a failed keepalive assertion still cleanly finish the isolated mock task.
      for (let i = 0; i < 50 && q.one('SELECT status FROM run_log WHERE canvas_id = ? ORDER BY create_time DESC LIMIT 1', canvas.id)?.status === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  console.log('video network recovery tests passed');
} finally {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
