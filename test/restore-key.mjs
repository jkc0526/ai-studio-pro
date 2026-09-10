// 从 WAL 备份中恢复用户密钥，写回 image_gen 配置；全过程不输出明文
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = path.join(import.meta.dirname, '..', 'data');
const wal = fs.readFileSync(path.join(dataDir, 'weave.db-wal.backup')).toString('latin1');

const cands = [...new Set(wal.match(/sk-Qjw[A-Za-z0-9_-]{0,60}?aZLI/g) || [])];
if (cands.length !== 1) {
  console.error(`候选数量异常：${cands.length}，已中止以保证安全`);
  process.exit(1);
}
const key = cands[0];
console.log(`恢复候选：长度=${key.length} 前6=${key.slice(0, 6)} 后4=${key.slice(-4)}`);

const db = new DatabaseSync(path.join(dataDir, 'weave.db'));
db.prepare('UPDATE ai_config SET api_key = ?, update_time = ? WHERE purpose = ?')
  .run(key, new Date().toISOString(), 'image_gen');
// 清掉测试期间写入的假密钥
db.prepare("UPDATE ai_config SET api_key = '' WHERE purpose = 'thinking' AND api_key LIKE 'sk-SAVEALL%'").run();

const rows = db.prepare('SELECT purpose, base_url, model_id, length(api_key) len, substr(api_key,1,6) p, substr(api_key,-4) s FROM ai_config').all();
for (const r of rows) {
  console.log(`${r.purpose}: base=${r.base_url} model=${r.model_id} key=${r.len ? `${r.p}••••${r.s}（${r.len}位）` : '未设置'}`);
}
