import fs from 'node:fs';
import path from 'node:path';

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
