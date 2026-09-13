/**
 * 图片节点 @ 引用（与视频节点对齐）：
 *  1. builtinSpec(kind=image) 带 vars.image 时请求体包含 image（不再带 image_url，部分网关会拒绝）
 *  2. 不带时不包含（纯文生图行为不变）
 *  3. pickRefUrl / stripMentions 在图片节点场景下解析正确
 */
import assert from 'node:assert';
import { builtinSpec } from '../server/endpoint.js';
import { pickRefUrl, stripMentions, mentionKeys } from '../server/engine.js';

let pass = 0; let fail = 0;
const check = (n, c, x = '') => { if (c) { pass++; console.log(`  ✅ ${n}`); } else { fail++; console.log(`  ❌ ${n}${x ? ` — ${x}` : ''}`); } };

console.log('=== 1. image 请求体带参考图 ===');
const withImg = builtinSpec({
  kind: 'image', protocol: 'openai', baseURL: 'https://api.test.com/v1', model: 'gemini-image',
  vars: { prompt: '把这只猫变成像素风', image: '/outputs/med_1.png', size: '1024x1024' },
});
check('url 指向 /images/generations', withImg.url === 'https://api.test.com/v1/images/generations');
check('body 包含 image', withImg.body.image === '/outputs/med_1.png', JSON.stringify(withImg.body));
check('body 不含 image_url（避免严格网关 400）', !('image_url' in withImg.body));
check('prompt 不变', withImg.body.prompt === '把这只猫变成像素风');
check('size 保留', withImg.body.size === '1024x1024');

console.log('\n=== 2. image 请求体不带参考图（纯文生图不变） ===');
const noImg = builtinSpec({
  kind: 'image', protocol: 'openai', baseURL: 'https://api.test.com/v1', model: 'sd-xl',
  vars: { prompt: '一只猫', size: '512x512' },
});
check('body 不含 image', !('image' in noImg.body), JSON.stringify(noImg.body));
check('body 不含 image_url', !('image_url' in noImg.body));

console.log('\n=== 3. 图片节点的 @ 引用解析 ===');
const node = {
  id: 'i1', type: 'imageNode',
  data: {
    prompt: '把 @图片2 做成 @图片1 的风格',
    mediaRefs: [
      { key: '图片1', type: 'image', url: '/outputs/a.png' },
      { key: '图片2', type: 'image', url: '/outputs/b.png' },
    ],
  },
};
check('mentionKeys 解析出 图片2/图片1', JSON.stringify(mentionKeys(node.data.prompt)) === '["图片2","图片1"]',
  JSON.stringify(mentionKeys(node.data.prompt)));
check('pickRefUrl 取第一个 mention（图片2）', pickRefUrl(node, node.data.prompt, [], 'image') === '/outputs/b.png',
  pickRefUrl(node, node.data.prompt, [], 'image'));
check('stripMentions 换成「参考图N」', stripMentions(node.data.prompt) === '把 参考图2 做成 参考图1 的风格',
  stripMentions(node.data.prompt));
check('没写 mention 时回落第一张图', pickRefUrl({ id: 'i2', type: 'imageNode', data: { prompt: '一只猫', mediaRefs: node.data.mediaRefs } }, '一只猫', [], 'image') === '/outputs/a.png');
check('无 mention 无连线 → null', pickRefUrl({ id: 'i3', type: 'imageNode', data: { prompt: '一只猫' } }, '一只猫', [], 'image') === null);

console.log(`\n=== 汇总：✅ ${pass} 通过 / ❌ ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
