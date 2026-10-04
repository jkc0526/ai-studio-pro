import fs from 'node:fs';
import path from 'node:path';

export function resolveUserDataDirectory(appDataDirectory) {
  const original = path.join(appDataDirectory, 'weave-canvas');
  const renamed = path.join(appDataDirectory, 'WeaveCanvas');

  // Electron originally used the package name for userData. Keep reopening that
  // database after the product was renamed; do not overwrite either directory.
  if (fs.existsSync(path.join(original, 'data', 'weave.db'))) return original;
  if (fs.existsSync(path.join(renamed, 'data', 'weave.db'))) return renamed;
  return original;
}

export function importLegacyDataDirectory(sourceDirectory, targetDirectory) {
  const source = path.resolve(sourceDirectory);
  const target = path.resolve(targetDirectory);
  if (!fs.existsSync(path.join(source, 'weave.db'))) {
    throw new Error('所选目录中没有找到 weave.db，请选择旧版 WeaveCanvas-data 数据目录');
  }
  if (source === target) return false;
  if (fs.existsSync(path.join(target, 'weave.db'))) return false;

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: false, errorOnExist: false });
  return true;
}
