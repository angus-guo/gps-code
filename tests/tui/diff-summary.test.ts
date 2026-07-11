import {describe, expect, it} from 'vitest';
import {formatWorkspaceDiff} from '../../src/tui/diff-summary.js';

describe('formatWorkspaceDiff', () => {
  it('asks what to do next and preserves bounded diff evidence', () => {
    const output = formatWorkspaceDiff({
      isGitRepository: true,
      hasChanges: true,
      status: ' M src/app.ts',
      stat: ' src/app.ts | 2 +-',
      patch: '-before\n+after\n[diff output truncated]',
      truncated: true
    });

    expect(output).toContain('可能在刚才的命令执行前就已存在');
    expect(output).toContain('git status --short');
    expect(output).toContain('src/app.ts');
    expect(output).toContain('[diff output truncated]');
    expect(output).toContain('下一步你希望');
  });

  it('returns no message for clean or non-git workspaces', () => {
    expect(formatWorkspaceDiff({
      isGitRepository: true,
      hasChanges: false,
      status: '',
      stat: '',
      patch: '',
      truncated: false
    })).toBe('');
    expect(formatWorkspaceDiff({
      isGitRepository: false,
      hasChanges: false,
      status: '',
      stat: '',
      patch: '',
      truncated: false
    })).toBe('');
  });
});
