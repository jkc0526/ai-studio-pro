import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  if (!fs.existsSync(file)) { console.log(`(跳过 ${file})`); continue; }
  const buf = fs.readFileSync(file).toString('latin1');
  console.log(`===== ${file} (${buf.length} 字节) =====`);

  // 找出所有以 sk-Qjw 开头、以 aZLI 结尾的片段（用户那把 51 位密钥）
  const re = /sk-Qjw[A-Za-z0-9_-]{0,60}?aZLI/g;
  const cands = [...new Set(buf.match(re) || [])];
  console.log(`匹配 sk-Qjw…aZLI 的片段 ${cands.length} 个：`);
  cands.forEach((c) => console.log(`  len=${c.length} 前6=${c.slice(0, 6)} 后6=${c.slice(-6)}`));

  // 所有 sk-Qjw 开头的片段，观察真实结尾
  const all = [...new Set(buf.match(/sk-Qjw[A-Za-z0-9_-]{0,80}/g) || [])];
  console.log(`\n所有 sk-Qjw 片段 ${all.length} 个（只看首尾，避免泄露中段）：`);
  all.forEach((c) => console.log(`  len=${c.length} 前6=${c.slice(0, 6)} 后8=${c.slice(-8)}`));
}
