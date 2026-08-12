import {formatCommandLine} from '../commands/runner.js';
import type {CommandRequest, CommandResult} from '../commands/types.js';

export type ConfirmationDecision = 'confirm' | 'reject' | 'unknown';

const confirmInputs = new Set(['y', 'yes', '确认', '执行', 'run']);
const rejectInputs = new Set(['n', 'no', '取消', 'cancel']);

export function getConfirmationDecision(input: string): ConfirmationDecision {
  const normalized = input.trim().toLowerCase();
  if (confirmInputs.has(normalized)) {
    return 'confirm';
  }
  if (rejectInputs.has(normalized)) {
    return 'reject';
  }
  return 'unknown';
}

function pushCurrentArg(args: string[], current: string, tokenStarted: boolean) {
  if (tokenStarted) {
    args.push(current);
  }
}

export function splitCommandLine(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;
  let tokenStarted = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      tokenStarted = true;
      continue;
    }

    if (char === '\\' && quote !== '\'') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushCurrentArg(args, current, tokenStarted);
      current = '';
      tokenStarted = false;
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (escaped) {
    current += '\\';
    tokenStarted = true;
  }
  if (quote) {
    throw new Error('Command contains an unclosed quote.');
  }

  pushCurrentArg(args, current, tokenStarted);
  return args;
}

export function parseManualCommandProposal(input: string): CommandRequest | null {
  const trimmed = input.trim();
  if (trimmed !== '/run' && !trimmed.startsWith('/run ')) {
    return null;
  }

  const parts = splitCommandLine(trimmed.slice('/run'.length));
  if (parts.length === 0) {
    throw new Error('Command is empty.');
  }

  return {
    command: parts[0],
    args: parts.slice(1)
  };
}

export function formatPendingCommand(command: CommandRequest) {
  return [
    '准备执行命令：',
    `$ ${formatCommandLine(command.command, command.args ?? [])}`,
    `工作目录：${command.cwd || '.'}`,
    '请回复 y/yes/确认/执行/run 执行，或 n/no/取消/cancel 取消。'
  ].join('\n');
}

/**
 * Higher-friction confirmation for risky-but-legitimate commands. `y` is
 * deliberately rejected: the whole point is to break the habit of confirming
 * without reading, so the user has to retype the command itself.
 */
export function getStrongConfirmationDecision(
  input: string,
  command: CommandRequest
): ConfirmationDecision {
  const normalized = input.trim();
  if (rejectInputs.has(normalized.toLowerCase())) {
    return 'reject';
  }
  if (normalized === formatCommandLine(command.command, command.args ?? [])) {
    return 'confirm';
  }
  return 'unknown';
}

export function formatPendingStrongCommand(command: CommandRequest, reason?: string) {
  const commandLine = formatCommandLine(command.command, command.args ?? []);
  return [
    '这条命令风险较高，需要二次确认：',
    `$ ${commandLine}`,
    `工作目录：${command.cwd || '.'}`,
    ...(reason ? [`原因：${reason}`] : []),
    '',
    `请完整输入以下命令以确认执行（回复 y 无效）：\n${commandLine}`,
    '或回复 n/no/取消/cancel 取消。'
  ].join('\n');
}

export function formatCommandStarted(command: CommandRequest) {
  return `开始执行命令：$ ${formatCommandLine(command.command, command.args ?? [])}`;
}

export function formatCommandCancelled(command: CommandRequest) {
  return `已取消命令：$ ${formatCommandLine(command.command, command.args ?? [])}`;
}

function formatOutputBlock(label: string, output: string) {
  const trimmed = output.trim();
  if (!trimmed) {
    return '';
  }
  return `${label}:\n${trimmed}`;
}

export function formatCommandResult(result: CommandResult) {
  const status = result.timedOut
    ? '超时'
    : result.exitCode === 0
      ? '成功'
      : `退出码 ${result.exitCode}`;
  const details = [
    `命令执行${status}：$ ${result.commandLine}`,
    `工作目录：${result.cwd}`,
    `耗时：${result.durationMs}ms`
  ];
  const stdout = formatOutputBlock('stdout', result.stdout);
  const stderr = formatOutputBlock('stderr', result.stderr);

  if (stdout) {
    details.push(stdout);
  }
  if (stderr) {
    details.push(stderr);
  }
  if (result.truncated) {
    details.push('输出已截断。');
  }

  return details.join('\n');
}

export function formatCommandResultWithSummary(result: CommandResult, summary?: string) {
  const fallback = formatCommandResult(result);
  const trimmedSummary = summary?.trim();
  if (!trimmedSummary) {
    return fallback;
  }

  return [
    '工程师摘要：',
    trimmedSummary,
    '',
    '原始执行结果：',
    fallback
  ].join('\n');
}
