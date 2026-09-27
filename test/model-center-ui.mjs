import assert from 'node:assert/strict';
import fs from 'node:fs';

const settings = fs.readFileSync(new URL('../src/components/SettingsModal.jsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

assert.match(settings, /模型中心/, 'settings should present a dedicated model center');
assert.match(settings, /精选/, 'model center should include the featured mode');
assert.match(settings, /自定义/, 'model center should include the custom mode');
assert.match(settings, /aria-label="模型类型"/, 'model categories should be named for assistive technology');
assert.match(settings, /音频模型/, 'the model category strip should communicate audio support status');
assert.match(settings, /type=\{visibleKeys/, 'API keys should be masked by default and revealable');
assert.match(settings, /aria-pressed/, 'mode and category selections should expose their selected state');
assert.match(settings, /htmlFor=\{`model-id-\$\{p\.key\}`\}/, 'model input must have a programmatic label');
assert.match(settings, /htmlFor=\{`base-url-\$\{p\.key\}`\}/, 'base URL input must have a programmatic label');
assert.match(settings, /导入配置/, 'settings should offer one-click configuration import');
assert.match(settings, /导出配置/, 'settings should offer configuration export');
assert.match(settings, /safeConfig = \{/, 'imports must be rebuilt from an allowlist before leaving the renderer');
assert.match(settings, /safeBaseUrl/, 'credential-like URL query strings must not be sent during import');
assert.match(settings, /API Key 未导入/, 'the UI should explain that credentials need to be added separately');
assert.match(styles, /\.model-center-banner/, 'model center should have a distinct onboarding banner');
assert.match(styles, /\.model-purpose-tabs/, 'model categories should have a dedicated tab treatment');

console.log('model center UI contract passed');
