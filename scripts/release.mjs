// 版本发布：npm run release -- patch|minor|major "改动说明"
// 做三件事：升 package.json 版本 → 在 CHANGELOG.md 顶部插入条目 → git 提交并打标签
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [bump = 'patch', ...msgParts] = process.argv.slice(2);
const summary = msgParts.join(' ') || '常规更新';

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = bump === 'major' ? `${maj + 1}.0.0` : bump === 'minor' ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
const prev = pkg.version;
pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const date = new Date().toISOString().slice(0, 10);
const logPath = path.join(root, 'CHANGELOG.md');
const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '# 更新日志\n';
const entry = `## v${next} — ${date}\n\n- ${summary}\n\n`;
const head = log.startsWith('# ') ? log.slice(0, log.indexOf('\n') + 1) : '# 更新日志\n';
const rest = log.slice(head.length).replace(/^\s+/, '');
fs.writeFileSync(logPath, `${head}\n${entry}${rest}`);

const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'inherit' });
try {
  git('add', '-A');
  git('commit', '-m', `chore(release): v${next}\n\n${summary}`);
  git('tag', '-a', `v${next}`, '-m', `v${next} — ${summary}`);
  console.log(`\n已发布 v${prev} → v${next}，并打标签 v${next}`);
} catch (e) {
  console.error('\ngit 操作失败，但版本号与 CHANGELOG 已更新：', e.message);
  process.exitCode = 1;
}
