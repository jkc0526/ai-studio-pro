import fs from 'node:fs';

const file = process.argv[2] || 'weave.db-wal.backup';
const buf = fs.readFileSync(file).toString('latin1');

const loose = [...new Set(buf.match(/sk-[A-Za-z0-9_-]{8,}/g) || [])];
console.log(`松散命中 ${loose.length} 个：`);
loose.forEach((h) => console.log(`  长度=${h.length} 前6=${h.slice(0, 6)} 后4=${h.slice(-4)}`));

console.log('\n带上下文（掩码显示，仅看边界字符）：');
const re = /sk-[A-Za-z0-9_-]{8,}/g;
let m; let shown = 0;
while ((m = re.exec(buf)) && shown < 12) {
  const s = m[0];
  const after = buf.slice(m.index + s.length, m.index + s.length + 3).replace(/[^\x20-\x7e]/g, '.');
  console.log(`  ${s.slice(0, 6)}…${s.slice(-4)} len=${s.length} 后随字符="${after}"`);
  shown++;
}

const byQuote = [...new Set(buf.match(/sk-[A-Za-z0-9_-]{8,}?(?=")/g) || [])];
console.log(`\n按引号闭合命中 ${byQuote.length} 个：`);
byQuote.forEach((h) => console.log(`  长度=${h.length} 前6=${h.slice(0, 6)} 后4=${h.slice(-4)}`));
