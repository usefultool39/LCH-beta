import path from 'node:path';
import { MAX_FILE_BYTES } from './protocol';

export type FilePayload = {
  name?: unknown;
  size?: unknown;
  base64?: unknown;
};

export function maxBase64PayloadBytes(maxFileBytes = MAX_FILE_BYTES) {
  return Math.ceil(maxFileBytes * 4 / 3) + 1024;
}

export function maxLocalApiBodyBytes(maxFileBytes = MAX_FILE_BYTES) {
  return maxBase64PayloadBytes(maxFileBytes) + 1024 * 1024;
}

export function maxControlMessageBytes(maxFileBytes = MAX_FILE_BYTES) {
  return Math.ceil(maxLocalApiBodyBytes(maxFileBytes) * 4 / 3) + 2 * 1024 * 1024;
}

export function decodeFilePayload(file: FilePayload, maxFileBytes = MAX_FILE_BYTES) {
  const name = path.basename(String(file?.name || 'received-file'));
  const hasBase64 = typeof file?.base64 === 'string';
  const base64 = String(file?.base64 || '').replace(/\s/g, '');
  const declaredSize = Number(file?.size ?? 0);

  if (!name || !hasBase64) throw new Error('文件无效或过大');
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 0 || declaredSize > maxFileBytes) {
    throw new Error('文件无效或过大');
  }
  if (base64.length > maxBase64PayloadBytes(maxFileBytes)) {
    throw new Error('文件无效或过大');
  }
  if (base64 && (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1)) {
    throw new Error('文件内容编码无效');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > maxFileBytes) throw new Error('文件无效或过大');
  if (buffer.length !== declaredSize) throw new Error('文件大小校验失败');

  return { name, buffer, size: buffer.length };
}
