import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {getProposedCommand, proposeCommandTool} from '../../src/tools/propose-command.js';

let tempDirs: string[] = [];

async function makeRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'gps-code-propose-command-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, {recursive: true, force: true})));
  tempDirs = [];
});

describe('proposeCommandTool', () => {
  it('returns a command proposal without executing it', async () => {
    const root = await makeRoot();

    const result = await proposeCommandTool.execute({
      command: process.execPath,
      args: ['-e', 'throw new Error("should not run")'],
      reason: '验证命令提案不会执行'
    }, {root});

    expect(result.content).toContain('has not been executed');
    expect(result.metadata).toMatchObject({
      command: {
        command: process.execPath,
        args: ['-e', 'throw new Error("should not run")']
      },
      reason: '验证命令提案不会执行'
    });
  });

  it('normalizes workspace-relative cwd proposals', async () => {
    const root = await makeRoot();

    const result = await proposeCommandTool.execute({
      command: 'pnpm',
      args: ['test'],
      cwd: '.'
    }, {root});

    expect(result.metadata).toMatchObject({
      command: {
        command: 'pnpm',
        args: ['test'],
        cwd: ''
      }
    });
  });

  it('rejects cwd traversal outside the workspace', async () => {
    const root = await makeRoot();

    await expect(proposeCommandTool.execute({
      command: 'pnpm',
      args: ['test'],
      cwd: '../outside'
    }, {root})).rejects.toThrow(/outside workspace/i);
  });
});

describe('getProposedCommand', () => {
  it('extracts command metadata', () => {
    expect(getProposedCommand({
      command: {
        command: 'pnpm',
        args: ['test'],
        cwd: 'packages/app'
      }
    })).toEqual({
      command: 'pnpm',
      args: ['test'],
      cwd: 'packages/app'
    });
  });

  it('returns null for invalid metadata', () => {
    expect(getProposedCommand({command: {args: ['test']}})).toBeNull();
    expect(getProposedCommand(undefined)).toBeNull();
  });
});
