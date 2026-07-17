import {createHash} from 'node:crypto';
import {lstat, readFile, realpath, stat} from 'node:fs/promises';
import {dirname, isAbsolute, relative, sep} from 'node:path';
import {resolveWorkspacePath} from '../tools/path-safety.js';
import {MAX_EDIT_FILE_BYTES} from './types.js';

export function toPosixPath(path: string) {
  return sep === '/' ? path : path.split(sep).join('/');
}

export function hashContent(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

export function isMissingFileError(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function assertInsideWorkspace(root: string, path: string, inputPath: string) {
  const relativePath = relative(root, path);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(`Path is outside workspace: ${inputPath}`);
  }
}

function decodeTextFile(buffer: Buffer, path: string) {
  if (buffer.includes(0)) {
    throw new Error(`File appears to be binary: ${path}`);
  }

  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(buffer);
  } catch {
    throw new Error(`File is not valid UTF-8 text: ${path}`);
  }
}

export async function getCanonicalWorkspaceRoot(root: string) {
  const canonicalRoot = await realpath(root);
  if (!(await stat(canonicalRoot)).isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${root}`);
  }
  return canonicalRoot;
}

export async function inspectExistingTextFile(root: string, inputPath: string) {
  const targetPath = resolveWorkspacePath(root, inputPath);
  const targetLstat = await lstat(targetPath);
  if (targetLstat.isSymbolicLink()) {
    throw new Error(`Symbolic links cannot be edited: ${inputPath}`);
  }
  if (!targetLstat.isFile()) {
    throw new Error(`Path is not a file: ${inputPath}`);
  }
  if (targetLstat.size > MAX_EDIT_FILE_BYTES) {
    throw new Error(`File is too large: ${inputPath}.`);
  }

  const canonicalTarget = await realpath(targetPath);
  assertInsideWorkspace(root, canonicalTarget, inputPath);
  if (canonicalTarget !== targetPath) {
    throw new Error(`Symbolic links cannot be edited: ${inputPath}`);
  }

  const buffer = await readFile(canonicalTarget);
  return {
    targetPath: canonicalTarget,
    relativePath: toPosixPath(relative(root, canonicalTarget)),
    content: decodeTextFile(buffer, inputPath),
    hash: hashContent(buffer),
    mode: targetLstat.mode & 0o777
  };
}

export async function resolveSafeCreateTarget(root: string, inputPath: string) {
  const targetPath = resolveWorkspacePath(root, inputPath);
  try {
    await lstat(targetPath);
    throw new Error(`Create target already exists: ${inputPath}`);
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const lexicalParent = dirname(targetPath);
  const parentPath = await realpath(lexicalParent);
  assertInsideWorkspace(root, parentPath, inputPath);
  if (parentPath !== lexicalParent) {
    throw new Error(`Symbolic links cannot be edited: ${inputPath}`);
  }
  if (!(await stat(parentPath)).isDirectory()) {
    throw new Error(`Create target parent is not a directory: ${inputPath}`);
  }

  return {
    targetPath,
    relativePath: toPosixPath(relative(root, targetPath)),
    mode: 0o644
  };
}
