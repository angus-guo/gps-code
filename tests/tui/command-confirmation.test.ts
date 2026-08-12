import {describe, expect, it} from 'vitest';
import {
  formatCommandCancelled,
  formatCommandResult,
  formatCommandResultWithSummary,
  formatPendingCommand,
  formatPendingStrongCommand,
  getConfirmationDecision,
  getStrongConfirmationDecision,
  parseManualCommandProposal,
  splitCommandLine
} from '../../src/tui/command-confirmation.js';

describe('command confirmation helpers', () => {
  it('recognizes confirmation and rejection inputs', () => {
    expect(getConfirmationDecision('y')).toBe('confirm');
    expect(getConfirmationDecision(' YES ')).toBe('confirm');
    expect(getConfirmationDecision('确认')).toBe('confirm');
    expect(getConfirmationDecision('执行')).toBe('confirm');
    expect(getConfirmationDecision('run')).toBe('confirm');
    expect(getConfirmationDecision('n')).toBe('reject');
    expect(getConfirmationDecision('no')).toBe('reject');
    expect(getConfirmationDecision('取消')).toBe('reject');
    expect(getConfirmationDecision('cancel')).toBe('reject');
    expect(getConfirmationDecision('maybe')).toBe('unknown');
  });

  it('requires retyping the command for strong confirmation', () => {
    const command = {command: 'npm', args: ['install', '-g', 'typescript']};

    // Habitual confirmations are deliberately rejected.
    expect(getStrongConfirmationDecision('y', command)).toBe('unknown');
    expect(getStrongConfirmationDecision('yes', command)).toBe('unknown');
    expect(getStrongConfirmationDecision('确认', command)).toBe('unknown');

    // Retyping the exact command line confirms; rejection words still cancel.
    expect(getStrongConfirmationDecision('npm install -g typescript', command)).toBe('confirm');
    expect(getStrongConfirmationDecision(' npm install -g typescript ', command)).toBe('confirm');
    expect(getStrongConfirmationDecision('npm install -g eslint', command)).toBe('unknown');
    expect(getStrongConfirmationDecision('n', command)).toBe('reject');
    expect(getStrongConfirmationDecision('取消', command)).toBe('reject');
  });

  it('formats strong confirmation prompts with the reason and the command to retype', () => {
    const command = {command: 'npm', args: ['install', '-g', 'typescript']};
    const prompt = formatPendingStrongCommand(command, '全局安装会修改系统状态。');

    expect(prompt).toContain('二次确认');
    expect(prompt).toContain('$ npm install -g typescript');
    expect(prompt).toContain('原因：全局安装会修改系统状态。');
    expect(prompt).toContain('回复 y 无效');
    expect(prompt).toContain('npm install -g typescript');
  });

  it('splits command lines without invoking a shell', () => {
    expect(splitCommandLine('pnpm test -- --runInBand')).toEqual(['pnpm', 'test', '--', '--runInBand']);
    expect(splitCommandLine('node -e "console.log(1)"')).toEqual(['node', '-e', 'console.log(1)']);
    expect(splitCommandLine('printf \'hello world\'')).toEqual(['printf', 'hello world']);
    expect(splitCommandLine('printf ""')).toEqual(['printf', '']);
  });

  it('rejects unclosed quotes in manual command proposals', () => {
    expect(() => splitCommandLine('node -e "console.log(1)')).toThrow(/unclosed quote/i);
  });

  it('parses manual /run proposals into argv-style commands', () => {
    expect(parseManualCommandProposal('/run pnpm test')).toEqual({command: 'pnpm', args: ['test']});
    expect(parseManualCommandProposal('解释一下 README')).toBeNull();
    expect(() => parseManualCommandProposal('/run')).toThrow(/empty/i);
  });

  it('formats pending command prompts', () => {
    expect(formatPendingCommand({command: 'pnpm', args: ['test']})).toContain('$ pnpm test');
    expect(formatPendingCommand({command: 'pnpm', args: ['test'], cwd: ''})).toContain('工作目录：.');
    expect(formatPendingCommand({command: 'pnpm', args: ['test']})).toContain('确认');
  });

  it('formats cancelled commands', () => {
    expect(formatCommandCancelled({command: 'pnpm', args: ['test']})).toBe('已取消命令：$ pnpm test');
  });

  it('formats command results with output and status', () => {
    const result = {
      commandLine: 'pnpm test',
      cwd: '/workspace',
      exitCode: 1,
      timedOut: false,
      durationMs: 42,
      stdout: 'ok',
      stderr: 'failed',
      truncated: true
    };
    const summary = formatCommandResult(result);

    expect(summary).toContain('退出码 1');
    expect(summary).toContain('stdout');
    expect(summary).toContain('stderr');
    expect(summary).toContain('输出已截断');

    const modelSummary = formatCommandResultWithSummary(result, '测试失败，建议检查失败断言。');
    expect(modelSummary).toContain('工程师摘要');
    expect(modelSummary).toContain('测试失败，建议检查失败断言。');
    expect(modelSummary).toContain('原始执行结果');
    expect(modelSummary).toContain('stdout:\nok');
    expect(modelSummary).toContain('输出已截断');
  });

  it('falls back to deterministic command output without a model summary', () => {
    const result = {
      commandLine: 'pnpm test',
      cwd: '/workspace',
      exitCode: 0,
      timedOut: false,
      durationMs: 42,
      stdout: 'ok',
      stderr: '',
      truncated: false
    };

    expect(formatCommandResultWithSummary(result)).toBe(formatCommandResult(result));
    expect(formatCommandResultWithSummary(result, '   ')).toBe(formatCommandResult(result));
  });
});
