import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execa} from 'execa';
import {afterEach, describe, expect, it} from 'vitest';
import {prepareWorkspaceDiff} from '../../src/git/diff.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'gps-code-diff-'));
  tempDirs.push(root);
  return root;
}

async function git(root: string, args: string[]) {
  return execa('git', args, {cwd: root});
}

async function makeRepository() {
  const root = await makeRoot();
  await git(root, ['init']);
  await git(root, ['config', 'user.name', 'GPS Code Tests']);
  await git(root, ['config', 'user.email', 'gps-code-tests@example.com']);
  await writeFile(join(root, 'tracked.txt'), 'before\n', 'utf8');
  await git(root, ['add', 'tracked.txt']);
  await git(root, ['commit', '-m', 'initial']);
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('prepareWorkspaceDiff', () => {
  it('reports a clean git workspace', async () => {
    const root = await makeRepository();

    await expect(prepareWorkspaceDiff(root)).resolves.toEqual({
      isGitRepository: true,
      hasChanges: false,
      status: '',
      stat: '',
      patch: '',
      truncated: false
    });
  });

  it('prepares status, stat, and patch excerpts for tracked changes', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'tracked.txt'), 'after\n', 'utf8');

    const result = await prepareWorkspaceDiff(root);

    expect(result.isGitRepository).toBe(true);
    expect(result.hasChanges).toBe(true);
    expect(result.status).toContain('tracked.txt');
    expect(result.stat).toContain('tracked.txt');
    expect(result.patch).toContain('-before');
    expect(result.patch).toContain('+after');
  });

  it('includes staged changes without modifying the index or worktree', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'tracked.txt'), 'staged\n', 'utf8');
    await git(root, ['add', 'tracked.txt']);
    const before = await git(root, ['status', '--short']);

    const result = await prepareWorkspaceDiff(root);
    const after = await git(root, ['status', '--short']);

    expect(result.stat).toContain('tracked.txt');
    expect(result.patch).toContain('+staged');
    expect(after.stdout).toBe(before.stdout);
  });

  it('detects untracked files without reading their contents into the patch', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'secret.txt'), 'do not include this content\n', 'utf8');

    const result = await prepareWorkspaceDiff(root);

    expect(result.hasChanges).toBe(true);
    expect(result.status).toContain('?? secret.txt');
    expect(result.patch).not.toContain('do not include this content');
  });

  it('bounds diff output with a clear truncation marker', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'tracked.txt'), `${'changed line\n'.repeat(100)}`, 'utf8');

    const result = await prepareWorkspaceDiff(root, {maxPatchBytes: 64});

    expect(result.truncated).toBe(true);
    expect(result.patch).toContain('[diff output truncated]');
  });

  it('can omit the patch excerpt', async () => {
    const root = await makeRepository();
    await writeFile(join(root, 'tracked.txt'), 'after\n', 'utf8');

    const result = await prepareWorkspaceDiff(root, {includePatch: false});

    expect(result.hasChanges).toBe(true);
    expect(result.stat).toContain('tracked.txt');
    expect(result.patch).toBe('');
  });

  it('returns a non-repository result outside git', async () => {
    const root = await makeRoot();

    await expect(prepareWorkspaceDiff(root)).resolves.toEqual({
      isGitRepository: false,
      hasChanges: false,
      status: '',
      stat: '',
      patch: '',
      truncated: false
    });
  });

  it('supports staged changes before the first commit', async () => {
    const root = await makeRoot();
    await git(root, ['init']);
    await writeFile(join(root, 'first.txt'), 'first version\n', 'utf8');
    await git(root, ['add', 'first.txt']);

    const result = await prepareWorkspaceDiff(root);

    expect(result.hasChanges).toBe(true);
    expect(result.status).toContain('first.txt');
    expect(result.stat).toContain('first.txt');
    expect(result.patch).toContain('+first version');
  });

  it('limits inspection to the workspace when it is a repository subdirectory', async () => {
    const root = await makeRepository();
    const workspace = join(root, 'packages', 'app');
    await mkdir(workspace, {recursive: true});
    await writeFile(join(workspace, 'app.txt'), 'before\n', 'utf8');
    await git(root, ['add', '.']);
    await git(root, ['commit', '-m', 'add app']);
    await writeFile(join(root, 'tracked.txt'), 'outside change\n', 'utf8');
    await writeFile(join(workspace, 'app.txt'), 'inside change\n', 'utf8');

    const result = await prepareWorkspaceDiff(workspace);

    expect(result.hasChanges).toBe(true);
    expect(result.status).toContain('app.txt');
    expect(result.status).not.toContain('tracked.txt');
    expect(result.patch).toContain('+inside change');
    expect(result.patch).not.toContain('outside change');
  });
});
