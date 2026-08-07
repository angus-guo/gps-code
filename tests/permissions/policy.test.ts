import {describe, expect, it} from 'vitest';
import {classifyCommand} from '../../src/permissions/policy.js';

describe('classifyCommand', () => {
  it('allows ordinary project commands', () => {
    expect(classifyCommand({command: 'ls'})).toEqual({classification: 'allow'});
    expect(classifyCommand({command: 'pnpm', args: ['test']})).toEqual({classification: 'allow'});
    expect(classifyCommand({command: 'git', args: ['status', '--short']})).toEqual({
      classification: 'allow'
    });
  });

  it('blocks bundled recursive force removal', () => {
    const result = classifyCommand({command: 'rm', args: ['-rf', '/']});
    expect(result.classification).toBe('block');
    expect(result.reason).toContain('递归');
  });

  it('blocks separated and long-form removal flags', () => {
    expect(classifyCommand({command: 'rm', args: ['-r', '-f', 'dir']}).classification).toBe('block');
    expect(classifyCommand({command: 'rm', args: ['--recursive', 'dir']}).classification).toBe('block');
    expect(classifyCommand({command: 'rm', args: ['--force', 'file']}).classification).toBe('block');
  });

  it('blocks uppercase recursive flag and windows switches', () => {
    expect(classifyCommand({command: 'rm', args: ['-R', 'dir']}).classification).toBe('block');
    expect(classifyCommand({command: 'rmdir', args: ['/s', '/q', 'dir']}).classification).toBe('block');
    expect(classifyCommand({command: 'del', args: ['/q', 'file']}).classification).toBe('block');
  });

  it('only asks for confirmation on a plain single-file removal', () => {
    const result = classifyCommand({command: 'rm', args: ['notes.txt']});
    expect(result.classification).toBe('confirm');
  });

  it('is case-insensitive about the executable name', () => {
    expect(classifyCommand({command: 'RM', args: ['-rf', 'dir']}).classification).toBe('block');
  });

  it('blocks force push in both flag spellings', () => {
    expect(classifyCommand({command: 'git', args: ['push', '--force']}).classification).toBe('block');
    expect(classifyCommand({command: 'git', args: ['push', '-f']}).classification).toBe('block');
    expect(classifyCommand({command: 'git', args: ['push', 'origin', 'main', '-f']}).classification)
      .toBe('block');
  });

  it('blocks hard reset and forced clean', () => {
    expect(classifyCommand({command: 'git', args: ['reset', '--hard']}).classification).toBe('block');
    expect(classifyCommand({command: 'git', args: ['clean', '-f', '-d']}).classification).toBe('block');
  });

  it('leaves non-destructive git subcommands alone', () => {
    expect(classifyCommand({command: 'git', args: ['push']}).classification).toBe('allow');
    expect(classifyCommand({command: 'git', args: ['reset', 'HEAD~1']}).classification).toBe('allow');
    expect(classifyCommand({command: 'git', args: ['clean', '--dry-run']}).classification).toBe('allow');
  });

  it('does not confuse a --force flag on an unrelated command', () => {
    expect(classifyCommand({command: 'pnpm', args: ['install', '--force']}).classification)
      .toBe('allow');
  });
});
