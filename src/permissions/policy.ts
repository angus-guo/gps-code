import type {CommandRequest} from '../commands/types.js';
import type {CommandPolicyResult} from './types.js';

const DANGEROUS_COMMANDS = new Set([
  'rm',
  'rmdir',
  'del'
]);

const DANGEROUS_PATTERNS = [
  {command: 'git', args: ['push', '--force']},
  {command: 'git', args: ['push', '-f']},
  {command: 'git', args: ['reset', '--hard']}
];

function matchesPattern(request: CommandRequest, pattern: {command: string; args: string[]}): boolean {
  if (request.command !== pattern.command) {
    return false;
  }
  const requestArgs = request.args ?? [];
  return pattern.args.every((arg, index) => requestArgs[index] === arg);
}

export function classifyCommand(request: CommandRequest): CommandPolicyResult {
  const command = request.command;
  const args = request.args ?? [];

  // Block: rm -rf
  if (command === 'rm' && args.includes('-rf')) {
    return {
      classification: 'block',
      reason: 'rm -rf 是危险操作，可能删除大量文件。'
    };
  }

  // Block: git push --force / -f
  if (command === 'git' && (args.includes('push')) && (args.includes('--force') || args.includes('-f'))) {
    return {
      classification: 'block',
      reason: 'git push --force 会覆盖远程历史，可能导致他人工作丢失。'
    };
  }

  // Block: git reset --hard
  if (command === 'git' && args.includes('reset') && args.includes('--hard')) {
    return {
      classification: 'block',
      reason: 'git reset --hard 会丢弃未提交的本地修改。'
    };
  }

  // Confirm: other dangerous commands (base list)
  if (DANGEROUS_COMMANDS.has(command)) {
    return {
      classification: 'confirm',
      reason: `${command} 可能修改或删除文件。`
    };
  }

  // Allow: everything else
  return {classification: 'allow'};
}
