import {describe, expect, it} from 'vitest';
import {classifyCommand} from '../../src/permissions/policy.js';

describe('classifyCommand', () => {
  it('allows safe commands', () => {
    expect(classifyCommand({command: 'ls'})).toEqual({classification: 'allow'});
    expect(classifyCommand({command: 'echo', args: ['hello']})).toEqual({classification: 'allow'});
    expect(classifyCommand({command: 'pnpm', args: ['test']})).toEqual({classification: 'allow'});
  });

  it('blocks rm -rf', () => {
    const result = classifyCommand({command: 'rm', args: ['-rf', '/']});
    expect(result.classification).toBe('block');
    expect(result.reason).toContain('rm -rf');
  });

  it('blocks git push --force', () => {
    const result = classifyCommand({command: 'git', args: ['push', '--force']});
    expect(result.classification).toBe('block');
    expect(result.reason).toContain('push --force');
  });

  it('blocks git push -f', () => {
    const result = classifyCommand({command: 'git', args: ['push', '-f']});
    expect(result.classification).toBe('block');
    expect(result.reason).toContain('push --force');
  });

  it('blocks git reset --hard', () => {
    const result = classifyCommand({command: 'git', args: ['reset', '--hard']});
    expect(result.classification).toBe('block');
    expect(result.reason).toContain('reset --hard');
  });

  it('confirms rm without -rf', () => {
    const result = classifyCommand({command: 'rm', args: ['file.txt']});
    expect(result.classification).toBe('confirm');
  });

  it('confirms rmdir', () => {
    const result = classifyCommand({command: 'rmdir', args: ['dir']});
    expect(result.classification).toBe('confirm');
  });

  it('allows git push without --force', () => {
    expect(classifyCommand({command: 'git', args: ['push']})).toEqual({classification: 'allow'});
  });

  it('allows git reset without --hard', () => {
    expect(classifyCommand({command: 'git', args: ['reset', 'HEAD~1']})).toEqual({classification: 'allow'});
  });
});
