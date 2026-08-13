import {describe, expect, it} from 'vitest';
import {getStrongConfirmationDecision} from '../../src/tui/command-confirmation.js';

describe('getStrongConfirmationDecision', () => {
  const command = {command: 'chmod', args: ['-R', '755', './scripts']};

  it('confirms when the input exactly matches the formatted command line', () => {
    expect(getStrongConfirmationDecision('chmod -R 755 ./scripts', command)).toBe('confirm');
  });

  it('rejects on n/no/cancel variations', () => {
    for (const input of ['n', 'no', 'cancel', '取消', 'N', 'NO']) {
      expect(getStrongConfirmationDecision(input, command)).toBe('reject');
    }
  });

  it('returns unknown for y/yes', () => {
    // The whole point of strong confirmation is to prevent muscle-memory `y`.
    for (const input of ['y', 'yes', '确认', '执行']) {
      expect(getStrongConfirmationDecision(input, command)).toBe('unknown');
    }
  });

  it('returns unknown for a partial match', () => {
    expect(getStrongConfirmationDecision('chmod -R 755', command)).toBe('unknown');
  });

  it('returns unknown for an almost-match with extra arguments', () => {
    expect(getStrongConfirmationDecision('chmod -R 755 ./scripts --verbose', command))
      .toBe('unknown');
  });

  it('ignores leading and trailing whitespace', () => {
    expect(getStrongConfirmationDecision('  chmod -R 755 ./scripts  ', command)).toBe('confirm');
  });

  it('handles commands with no arguments', () => {
    expect(getStrongConfirmationDecision('shutdown', {command: 'shutdown'})).toBe('confirm');
  });

  it('handles commands with many arguments', () => {
    const cmd = {
      command: 'npm',
      args: ['install', '-g', '--registry', 'https://registry.npmjs.org', 'typescript']
    };
    expect(
      getStrongConfirmationDecision(
        'npm install -g --registry https://registry.npmjs.org typescript',
        cmd
      )
    ).toBe('confirm');
  });
});
