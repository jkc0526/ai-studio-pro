import assert from 'node:assert/strict';
import { sanitizeConfigForImport } from '../src/configImport.js';

const adminBackup = sanitizeConfigForImport({
  app: 'weave-canvas', schemaVersion: 2, withKeys: true,
  providers: [{
    id: 'portable-provider', name: '管理员渠道', protocol: 'openai',
    base_url: 'https://api.example/v1', api_key: 'provider-key', models: ['image-model'],
  }],
  aiConfigs: [{
    purpose: 'image_gen', provider_id: 'portable-provider', model_id: 'image-model', api_key: 'purpose-key',
  }],
});
assert.equal(adminBackup.schemaVersion, 2, 'admin backup schema must be preserved for the backend');
assert.equal(adminBackup.providers[0].api_key, 'provider-key', 'admin provider keys should be restored');
assert.equal(adminBackup.aiConfigs[0].api_key, 'purpose-key', 'admin purpose keys should be restored');

const regularBackup = sanitizeConfigForImport({
  app: 'weave-canvas', schemaVersion: 1, withKeys: false,
  providers: [{ name: '普通渠道', base_url: 'https://api.example/v1', api_key: 'must-not-import' }],
  aiConfigs: [{ purpose: 'video', api_key: 'must-not-import' }],
});
assert.equal(regularBackup.schemaVersion, 1);
assert.equal('api_key' in regularBackup.providers[0], false, 'regular backup imports must not accept provider keys');
assert.equal('api_key' in regularBackup.aiConfigs[0], false, 'regular backup imports must not accept purpose keys');

assert.throws(() => sanitizeConfigForImport({ app: 'weave-canvas', schemaVersion: 99 }), /不支持/);

console.log('configuration import UI tests passed');
