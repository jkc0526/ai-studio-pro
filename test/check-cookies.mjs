/** 检查 Edge/Chrome 的 Cookie 库里有没有 liblib.tv 的登录态（只读拷贝，不动原文件） */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const LOG = [];
const log = (...a) => { const s = a.map(String).join(' '); LOG.push(s); console.log(s); };
const ROOT = 'E:/work Buddy/weave-canvas';

const CANDIDATES = [
  ['Edge', 'C:/Users/HUAWEI/AppData/Local/Microsoft/Edge/User Data/Default/Network/Cookies'],
  ['Chrome', 'C:/Users/HUAWEI/AppData/Local/Google/Chrome/User Data/Default/Network/Cookies'],
];

for (const [name, src] of CANDIDATES) {
  log(`\n===== ${name} =====`);
  log(`源文件: ${src}`);
  if (!fs.existsSync(src)) { log('  不存在'); continue; }
  const tmp = path.join(os.tmpdir(), `cookies-${name}.db`);
  try {
    fs.copyFileSync(src, tmp);
    log(`  已拷贝到临时文件（原文件未动）`);
  } catch (e) { log(`  ✗ 拷贝失败（浏览器可能正占用）: ${e.message}`); continue; }
  let db = null;
  try {
    db = new DatabaseSync(tmp, { readOnly: true });
    const rows = db.prepare("SELECT host_key, name, datetime(expires_utc/1000000-11644473600,'unixepoch','localtime') AS exp FROM cookies WHERE host_key LIKE '%liblib%' OR host_key LIKE '%libtv%'").all();
    if (!rows.length) log('  ✗ 没有 liblib/libtv 相关 Cookie');
    for (const r of rows) log(`  ✓ ${r.host_key}  ${r.name}  过期=${r.exp}`);
    const total = db.prepare('SELECT COUNT(*) c FROM cookies').get().c;
    log(`  （该 profile 共 ${total} 条 Cookie）`);
  } catch (e) { log(`  ✗ 读取失败: ${e.message}`); }
  finally { try { db?.close(); } catch { /* ignore */ } }
}

fs.writeFileSync(path.join(ROOT, 'test/cookie-check.txt'), LOG.join('\n'), 'utf8');
process.exit(0);
