import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {resolveWorkspacePath} from '../../src/tools/path-safety.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-tools-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('resolveWorkspacePath', () => {
  it('resolves a relative path inside the workspace', async () => {
    const root = await makeRoot();

    expect(resolveWorkspacePath(root, 'src/index.ts')).toBe(join(root, 'src', 'index.ts'));
  });

  it('rejects absolute paths outside the workspace', async () => {
    const root = await makeRoot();

    expect(() => resolveWorkspacePath(root, '/tmp/outside.txt')).toThrow(/outside workspace/i);
  });

  it('rejects parent traversal outside the workspace', async () => {
    const root = await makeRoot();

    expect(() => resolveWorkspacePath(root, '../outside.txt')).toThrow(/outside workspace/i);
  });

  it('rejects empty paths unless root access is explicitly allowed', async () => {
    const root = await makeRoot();

    expect(() => resolveWorkspacePath(root, '')).toThrow(/empty path/i);
    expect(resolveWorkspacePath(root, '', {allowRoot: true})).toBe(root);
  });
});
