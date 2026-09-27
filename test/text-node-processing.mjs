import assert from 'node:assert/strict';
import { runWorkflow } from '../server/engine.js';

const originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (url, options = {}) => {
  requests.push({ url: String(url), body: JSON.parse(options.body || '{}') });
  const content = requests.length === 1 ? '整理后的剧本文本' : '下游继续处理完成';
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { total_tokens: 18 },
    }),
  };
};

try {
  const result = await runWorkflow({
    nodes: [
      { id: 'text-1', type: 'textNode', data: {
        content: '把这段素材整理成更清晰的剧本',
        modelId: 'selected-text-model',
        processWithModel: true,
      } },
      { id: 'llm-1', type: 'llmNode', data: {
        prompt: '基于上游继续扩写：{{input}}',
        modelId: 'downstream-model',
      } },
    ],
    edges: [{ source: 'text-1', target: 'llm-1' }],
    targetIds: ['llm-1'],
    configs: {
      thinking: {
        purpose: 'thinking',
        base_url: 'http://text-gateway.test/v1',
        api_key: 'test-key',
        model_id: 'default-text-model',
      },
    },
  });

  assert.equal(result.status, 'success', JSON.stringify(result.errors));
  assert.equal(requests.length, 2, 'the selected text model and the downstream LLM should both run');
  assert.equal(requests[0].url, 'http://text-gateway.test/v1/chat/completions');
  assert.equal(requests[0].body.model, 'selected-text-model');
  assert.equal(requests[0].body.messages.at(-1).content, '把这段素材整理成更清晰的剧本');
  assert.equal(requests[1].body.messages.at(-1).content, '基于上游继续扩写：整理后的剧本文本');

  const textPatch = result.patches.find((patch) => patch.nodeId === 'text-1' && patch.data.output)?.data;
  assert.equal(textPatch?.output, '整理后的剧本文本');
  assert.equal(textPatch?.modelUsed, 'selected-text-model');

  requests.length = 0;
  const passthrough = await runWorkflow({
    nodes: [{ id: 'plain-text', type: 'textNode', data: { content: '保留原文', processWithModel: false } }],
    edges: [],
    targetIds: ['plain-text'],
    configs: {},
  });
  assert.equal(passthrough.status, 'success');
  assert.equal(requests.length, 0, 'plain text mode must not call a model');
  assert.equal(passthrough.patches.find((patch) => patch.nodeId === 'plain-text' && patch.data.output)?.data.output, '保留原文');

  console.log('text node model processing tests passed');
} finally {
  globalThis.fetch = originalFetch;
}
