import {mkdir, mkdtemp, realpath, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {runCommand} from '../../src/commands/runner.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-commands-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('runCommand', () => {
  it('runs an argv-style command in the workspace', async () => {
    const root = await makeRoot();

    const result = await runCommand(root, {
      command: process.execPath,
      args: ['-e', 'console.log("hello from command")']
    });

    expect(result.commandLine).toContain(process.execPath);
    expect(result.cwd).toBe(await realpath(root));
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe('hello from command');
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('runs from an optional workspace-relative cwd', async () => {
    const root = await makeRoot();
    await mkdir(join(root, 'packages', 'app'), {recursive: true});

    const result = await runCommand(root, {
      command: process.execPath,
      args: ['-e', 'console.log(process.cwd())'],
      cwd: 'packages/app'
    });

    const expectedCwd = await realpath(join(root, 'packages', 'app'));
    expect(result.cwd).toBe(expectedCwd);
    expect(result.stdout.trim()).toBe(expectedCwd);
  });

  it('rejects cwd traversal outside the workspace', async () => {
    const root = await makeRoot();

    await expect(runCommand(root, {
      command: process.execPath,
      args: ['-v'],
      cwd: '../outside'
    })).rejects.toThrow(/outside workspace/i);
  });

  it('rejects cwd symlinks that resolve outside the workspace', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await symlink(outside, join(root, 'linked-outside'));

    await expect(runCommand(root, {
      command: process.execPath,
      args: ['-v'],
      cwd: 'linked-outside'
    })).rejects.toThrow(/outside workspace/i);
  });

  it('captures non-zero exits without throwing', async () => {
    const root = await makeRoot();

    const result = await runCommand(root, {
      command: process.execPath,
      args: ['-e', 'console.error("failed command"); process.exit(7)']
    });

    expect(result.exitCode).toBe(7);
    expect(result.timedOut).toBe(false);
    expect(result.stderr.trim()).toBe('failed command');
  });

  it('marks timed-out commands', async () => {
    const root = await makeRoot();

    const result = await runCommand(root, {
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 1000)'],
      timeoutMs: 50
    });

    expect(result.exitCode).toBeNull();
    expect(result.timedOut).toBe(true);
  });

  it('truncates large output with a clear marker', async () => {
    const root = await makeRoot();

    const result = await runCommand(root, {
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(100))'],
      maxOutputBytes: 10
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout).toContain('[output truncated]');
    expect(result.stdout.length).toBeLessThan(100);
  });
});
