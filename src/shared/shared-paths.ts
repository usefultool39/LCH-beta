import path from 'node:path';

export function cleanSharedPath(relativePath = '') {
  return String(relativePath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .join('/');
}

export function resolveInsideRoot(rootPath: string, parts: string[]) {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, ...parts);
  const escaped = path.relative(root, target);
  if (escaped.startsWith('..') || path.isAbsolute(escaped)) {
    throw new Error('路径超出共享目录范围');
  }
  return { root, target };
}
