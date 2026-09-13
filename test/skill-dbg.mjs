/** 调试：Skill 创建后 spec 是否完整保存、PUT 后是否深合并 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'tmp', 'skill-dbg');
const L = [];
const log = (...a) => { const s = a.map(String).join(' '); L.push(s); console.log(s); };

fs.rmSync(DATA_DIR, { recursive: true, force: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.WEAVE_DATA_DIR = DATA_DIR;

const { startServer } = await import('../server/index.js');
const { q } = await import('../server/db.js');
const { server, port } = await startServer({ port: 0 });
const api = async (p, method = 'GET', body) => (await fetch(`http://127.0.0.1:${port}${p}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
})).json();

const made = await api('/api/skills', 'POST', {
  command: 'dbg', title: '调试套路', category: '通用', kind: 'video', summary: 'x',
  spec: { styleName: '日系2D动画', shots: 4, ratio: '1:1', goalTemplate: '用 {title} 处理 {script}' },
});
log('创建返回 spec:', JSON.stringify(made.data.spec));
const rawRow = q.one('SELECT spec_json FROM skill WHERE id = ?', made.data.id);
log('库里 spec_json:', rawRow.spec_json);

const edited = await api(`/api/skills/${made.data.id}`, 'PUT', { title: '调试套路2', spec: { shots: 6 } });
log('编辑返回 spec:', JSON.stringify(edited.data.spec));
log('编辑后库里:', q.one('SELECT spec_json FROM skill WHERE id = ?', made.data.id).spec_json);

server.close();
fs.writeFileSync(path.join(ROOT, 'test/skill-dbg.out.txt'), L.join('\n'), 'utf8');
process.exit(0);
