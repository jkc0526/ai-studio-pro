import assert from 'node:assert/strict';
import { normalizeConfigImport } from '../server/configTransfer.js';

const legacy = {
  app: 'infinite-canvas',
  version: 1,
  config: {
    baseUrl: 'https://gateway.example/v1',
    apiKey: 'test-secret-not-for-output',
    apiFormat: 'openai',
    channels: [{
      id: 'default', name: '默认渠道', baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-secret-not-for-output', apiFormat: 'openai',
      models: [
        { name: 'default::gpt-image-2.5', capability: 'image', description: '图像模型' },
        { name: 'default::seedance2.5-video', capability: 'video', description: '视频模型', durationRange: { min: 4, max: 30, api_key: 'nested-secret' } },
      ],
    }],
    imageModel: 'default::gpt-image-2.5',
    videoModel: 'default::seedance2.5-video',
  },
  promptSources: { sources: [{ id: 'ignored-source', name: 'Prompt catalog' }] },
};

const normalized = normalizeConfigImport(legacy);
assert.equal(normalized.format, 'infinite-canvas');
assert.equal(normalized.providers.length, 1);
assert.equal(normalized.providers[0].name, '默认渠道');
assert.equal(normalized.providers[0].base_url, 'https://gateway.example/v1');
assert.equal('api_key' in normalized.providers[0], false, 'API keys must never be included in imported provider data');
assert.equal(normalized.providers[0].models[0].id, 'gpt-image-2.5');
assert.equal(normalized.providers[0].models[0].capability, 'image');
assert.equal(normalized.providers[0].models[1].id, 'seedance2.5-video');
assert.deepEqual(normalized.providers[0].models[1].durationRange, { min: 4, max: 30 });
assert.deepEqual(normalized.defaults, { image: 'gpt-image-2.5', video: 'seedance2.5-video' });
assert.equal(normalized.providers[0].id, undefined, 'legacy channel identifiers must not collide with local database IDs');

const backup = normalizeConfigImport({
  app: 'weave-canvas', schemaVersion: 1,
  providers: [{ id: 'portable-id', name: '自建服务', base_url: 'https://gateway.example/v1', api_key: 'must-not-be-imported', models: ['video-model'] }],
  aiConfigs: [{ purpose: 'video', provider_id: 'portable-id', model_id: 'video-model', api_key: 'also-secret' }],
  customApis: [{ name: 'must be ignored', headers_json: '{"Authorization":"secret"}' }],
});
assert.equal('api_key' in backup.providers[0], false);
assert.equal('api_key' in backup.aiConfigs[0], false);
assert.equal('customApis' in backup, false, 'custom API templates are excluded from portable config');
assert.equal(backup.providers[0].models[0].id, 'video-model');

assert.throws(() => normalizeConfigImport({ app: 'unknown', config: {} }), /不支持|格式/, '不支持的配置文件应安全拒绝');
assert.throws(() => normalizeConfigImport({ app: 'infinite-canvas', config: { channels: [] } }), /渠道|配置/, '没有有效渠道的文件应拒绝导入');

console.log('configuration transfer tests passed');
