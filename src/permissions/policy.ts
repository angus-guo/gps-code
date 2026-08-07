import type {CommandRequest} from '../commands/types.js';
import type {CommandPolicyResult} from './types.js';

const FILE_REMOVAL_COMMANDS = new Set(['rm', 'rmdir', 'del', 'erase']);

/**
 * Expands bundled short flags so `-rf` is treated the same as `-r -f`.
 * Long flags are kept intact; non-flag arguments are dropped.
 */
function normalizeFlags(args: readonly string[]): Set<string> {
  const flags = new Set<string>();
  for (const arg of args) {
    if (arg.startsWith('--')) {
      flags.add(arg.toLowerCase());
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      for (const char of arg.slice(1)) {
        flags.add(`-${char.toLowerCase()}`);
      }
      continue;
    }
    // Windows-style switches such as `/s` and `/q`.
    if (arg.startsWith('/') && arg.length === 2) {
      flags.add(arg.toLowerCase());
    }
  }
  return flags;
}

function hasFlag(flags: Set<string>, ...candidates: string[]): boolean {
  return candidates.some((candidate) => flags.has(candidate));
}

function blocked(reason: string): CommandPolicyResult {
  return {classification: 'block', reason};
}

export function classifyCommand(request: CommandRequest): CommandPolicyResult {
  const command = request.command.toLowerCase();
  const args = request.args ?? [];
  const flags = normalizeFlags(args);

  if (FILE_REMOVAL_COMMANDS.has(command)) {
    const recursive = hasFlag(flags, '-r', '-R', '--recursive', '/s');
    const forced = hasFlag(flags, '-f', '--force', '/q');
    if (recursive || forced) {
      return blocked(`${command} 携带递归或强制删除参数，可能删除大量文件且无法恢复。`);
    }
    return {
      classification: 'confirm',
      reason: `${command} 会删除文件。`
    };
  }

  if (command === 'git') {
    const subcommand = args[0];
    if (subcommand === 'push' && hasFlag(flags, '-f', '--force')) {
      return blocked('git push --force 会覆盖远程历史，可能导致他人的提交丢失。');
    }
    if (subcommand === 'reset' && hasFlag(flags, '--hard')) {
      return blocked('git reset --hard 会丢弃工作区中未提交的修改。');
    }
    if (subcommand === 'clean' && hasFlag(flags, '-f', '--force')) {
      return blocked('git clean -f 会删除未跟踪的文件，且不进入回收站。');
    }
  }

  return {classification: 'allow'};
}
