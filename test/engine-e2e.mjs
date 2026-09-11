/**
 * 工作流引擎端到端测试：4 个场景
 *  1) 单链路：textNode → imageNode
 *  2) 三路并行：textNode 扇出 3 个 imageNode（应并发而非串行）
 *  3) 含环：a→b→a（应直接报错，不执行）
 *  4) 一节点失败，独立分支继续
 */
import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 8899;

function httpReq(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: HOST, port: PORT, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      resolve(res);
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function readSSE(path, body) {
  const events = [];
  let fatal = null;
  let done = null;
  const t0 = Date.now();
  const res = await httpReq(path, body);
  return new Promise((resolve, reject) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      // 按空行分割事件块
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let event = 'message', dataStr = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (!dataStr) continue;
        let data;
        try { data = JSON.parse(dataStr); } catch { continue; }
        events.push({ event, data, t: Date.now() - t0 });
        if (event === 'done') done = data;
        if (event === 'fatal') fatal = data;
      }
    });
    res.on('end', () => resolve({ events, done, fatal, ms: Date.now() - t0 }));
    res.on('error', reject);
  });
}

/* ---- 场景 1：单链路 ---- */
async function scene1_singleChain() {
  console.log('\n=== 场景 1：单链路 textNode → imageNode ===');
  const body = {
    canvasId: null,
    canvas: {
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { content: '一只在月光下的橙色小猫，电影感构图，温暖色调。' } },
        { id: 'i1', type: 'imageNode', position: { x: 200, y: 0 }, data: { prompt: '{{input}}', size: '1024x1024' } },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'i1' }],
    },
    nodeIds: ['i1'],
    stream: true,
  };
  const { done, fatal, events, ms } = await readSSE('/api/run', body);
  const okEvents = events.filter((e) => e.event === 'node' && e.data.status === 'done');
  const errEvents = events.filter((e) => e.event === 'node' && e.data.status === 'error');
  console.log(`  events=${events.length} done=${okEvents.length} error=${errEvents.length} totalMs=${ms}`);
  console.log(`  status=${done?.status || (fatal ? 'fatal' : 'unknown')}`);
  if (fatal) console.log(`  fatal: ${fatal.message}`);
  return { ok: !!done && !fatal, ms, events };
}

/* ---- 场景 2：三路并行 ---- */
async function scene2_parallel() {
  console.log('\n=== 场景 2：textNode 扇出 3 个 imageNode（应并发）===');
  const body = {
    canvasId: null,
    canvas: {
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { content: '赛博朋克城市夜景，雨夜，霓虹灯，电影感。' } },
        { id: 'i1', type: 'imageNode', position: { x: 200, y: -100 }, data: { prompt: '{{input}}', size: '512x512' } },
        { id: 'i2', type: 'imageNode', position: { x: 200, y: 0 }, data: { prompt: '{{input}}', size: '512x512' } },
        { id: 'i3', type: 'imageNode', position: { x: 200, y: 100 }, data: { prompt: '{{input}}', size: '512x512' } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'i1' },
        { id: 'e2', source: 't1', target: 'i2' },
        { id: 'e3', source: 't1', target: 'i3' },
      ],
    },
    nodeIds: ['i1', 'i2', 'i3'],
    stream: true,
  };
  const { done, fatal, events, ms } = await readSSE('/api/run', body);
  const running = events.filter((e) => e.event === 'node' && e.data.status === 'running');
  const doneE = events.filter((e) => e.event === 'node' && e.data.status === 'done');
  console.log(`  events=${events.length} done=${doneE.length} ms=${ms}`);

  // 验证并发：3 个 imageNode 的 running 事件应该在同一秒内（或非常接近）触发
  const imgRunning = running.filter((e) => ['i1', 'i2', 'i3'].includes(e.data.nodeId));
  if (imgRunning.length === 3) {
    const times = imgRunning.map((e) => e.t).sort();
    const span = times[2] - times[0];
    console.log(`  并发检测：3 个 imageNode running 时间差 = ${span} ms`);
    console.log(`  ${span < 1000 ? '✅ 并发' : '⚠️ 串行'}`);
  }
  // done 事件含 textNode，因此 imageNode 成功数应 >= 3
  const imgDone = doneE.filter((e) => ['i1', 'i2', 'i3'].includes(e.data.nodeId)).length;
  return { ok: !!done && !fatal && imgDone === 3, ms, events };
}

/* ---- 场景 3：环检测 ---- */
async function scene3_cycle() {
  console.log('\n=== 场景 3：含环 a→b→a（应直接报错）===');
  const body = {
    canvasId: null,
    canvas: {
      nodes: [
        { id: 'a', type: 'textNode', position: { x: 0, y: 0 }, data: { content: 'A' } },
        { id: 'b', type: 'textNode', position: { x: 200, y: 0 }, data: { content: 'B' } },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b' },
        { id: 'e2', source: 'b', target: 'a' }, // 环！
      ],
    },
    nodeIds: ['a', 'b'],
    stream: false, // 用 JSON 路径，便于直接看到 400
  };
  return new Promise((resolve) => {
    httpReq('/api/run', body).then((res) => {
      let buf = '';
      res.on('data', (c) => buf += c.toString());
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          const ok = !j.success && /环/.test(j.error || '');
          console.log(`  status=${res.statusCode} ok=${ok} error="${(j.error || '').slice(0, 60)}"`);
          resolve({ ok, status: res.statusCode, error: j.error });
        } catch (e) {
          console.log(`  解析失败: ${e.message}`);
          resolve({ ok: false, error: e.message });
        }
      });
    });
  });
}

/* ---- 场景 4：错误隔离（独立分支继续）----
   上游 textNode OK → 两个 imageNode，其中 i1 故意触发空 prompt 让它失败
   验证 i2 仍能完成
   但 prompt 是必填的……改成 imageNode 配置一个会失败的 modelId 让它必然 404 */
async function scene4_isolation() {
  console.log('\n=== 场景 4：错误隔离：1 个失败 + 1 个独立分支应继续 ===');
  const body = {
    canvasId: null,
    canvas: {
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { content: '一只柴犬在樱花树下，浅景深，电影感。' } },
        { id: 'i1', type: 'imageNode', position: { x: 200, y: 0 }, data: { prompt: '故意无法成功的提示词关键字__XYZ_INVALID', modelId: '__no_such_model_9999', size: '512x512' } },
        { id: 'i2', type: 'imageNode', position: { x: 200, y: 100 }, data: { prompt: '{{input}}', size: '512x512' } },
        { id: 't2', type: 'textNode', position: { x: 0, y: 100 }, data: { content: '另一独立上游：晨曦中的雪山。' } },
        { id: 'i3', type: 'imageNode', position: { x: 200, y: 200 }, data: { prompt: '{{input}}', size: '512x512' } },
      ],
      edges: [
        { id: 'e1', source: 't1', target: 'i1' },
        { id: 'e2', source: 't1', target: 'i2' },
        { id: 'e3', source: 't2', target: 'i3' },
      ],
    },
    nodeIds: ['i1', 'i2', 'i3'],
    stream: true,
  };
  const { done, events, ms } = await readSSE('/api/run', body);
  const byStatus = {};
  for (const e of events) {
    if (e.event !== 'node') continue;
    byStatus[e.data.nodeId] = e.data.status;
  }
  console.log(`  ms=${ms} status=${done?.status}`);
  console.log(`  最终状态: ${JSON.stringify(byStatus)}`);
  const isolationOK = byStatus.i1 === 'error' && (byStatus.i2 === 'done' || byStatus.i3 === 'done');
  console.log(`  ${isolationOK ? '✅ 错误隔离：i1 失败但 i2/i3 独立完成' : '❌ 错误未隔离'}`);
  return { ok: isolationOK, ms, events };
}

(async () => {
  const r1 = await scene1_singleChain();
  const r2 = await scene2_parallel();
  const r3 = await scene3_cycle();
  const r4 = await scene4_isolation();
  console.log('\n=== 汇总 ===');
  console.log(`场景 1（单链路）: ${r1.ok ? '✅' : '❌'} ${r1.ms}ms`);
  console.log(`场景 2（并行）: ${r2.ok ? '✅' : '❌'} ${r2.ms}ms`);
  console.log(`场景 3（环检测）: ${r3.ok ? '✅' : '❌'} status=${r3.status}`);
  console.log(`场景 4（错误隔离）: ${r4.ok ? '✅' : '❌'} ${r4.ms}ms`);
  process.exit([r1.ok, r2.ok, r3.ok, r4.ok].every(Boolean) ? 0 : 1);
})();