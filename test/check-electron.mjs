import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const exe = require('electron');
const code = 'console.log(JSON.stringify({node:process.versions.node,electron:process.versions.electron,sqlite:!!require("node:sqlite")}))';
const out = execFileSync(exe, ['-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
console.log('Electron 运行时:', out.toString().trim());
