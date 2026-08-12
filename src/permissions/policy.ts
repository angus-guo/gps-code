import type {CommandRequest} from '../commands/types.js';
import type {CommandPolicyOptions, CommandPolicyResult} from './types.js';

const FILE_REMOVAL_COMMANDS = new Set(['rm', 'rmdir', 'del', 'erase']);

/** Never appropriate from an agent, whatever the arguments. */
const DESTRUCTIVE_SYSTEM_COMMANDS = new Set([
  'dd',
  'mkfs',
  'mkfs.ext4',
  'mkfs.xfs',
  'format',
  'fdisk',
  'diskpart',
  'shutdown',
  'reboot',
  'halt',
  'poweroff'
]);

const MIGRATION_TOOLS = new Set([
  'prisma',
  'sequelize',
  'knex',
  'typeorm',
  'alembic',
  'flyway',
  'liquibase',
  'rails',
  'rake',
  'django-admin',
  'manage.py',
  'drizzle-kit',
  'atlas'
]);

/** Migration subcommands that drop or rewind data. */
const DESTRUCTIVE_MIGRATION_TOKENS = new Set([
  'reset',
  'drop',
  'db:drop',
  'db:reset',
  'downgrade',
  'rollback',
  'db:rollback',
  'migrate:rollback',
  'clean',
  'wipe',
  'flush'
]);

/** Migration subcommands that move schema forward. */
const FORWARD_MIGRATION_TOKENS = new Set([
  'migrate',
  'db:migrate',
  'deploy',
  'upgrade',
  'push',
  'db:push',
  'migrate:latest',
  'apply'
]);

const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'gem', 'cargo']);

/**
 * Absolute paths outside the workspace whose recursive modification is never
 * something a workspace-scoped agent should be doing.
 */
const SYSTEM_PATH_PATTERN = /^([a-z]:[\\/]?$|[\\/]$|[\\/](etc|usr|bin|sbin|var|lib|boot|dev|proc|sys|windows|system32)([\\/]|$)|~[\\/]?$)/i;

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
    // Windows-style switches such as `/s` and `/q`, but not paths like /usr.
    if (arg.startsWith('/') && arg.length === 2) {
      flags.add(arg.toLowerCase());
    }
  }
  return flags;
}

/** Arguments that are not flags: subcommands and paths. */
function positionals(args: readonly string[]): string[] {
  return args.filter((arg) => {
    if (arg.startsWith('-')) return false;
    if (/^\/[a-z]$/i.test(arg)) return false;
    return arg.length > 0;
  });
}

function hasFlag(flags: Set<string>, ...candidates: string[]): boolean {
  return candidates.some((candidate) => flags.has(candidate.toLowerCase()));
}

function looksLikeSystemPath(value: string): boolean {
  return SYSTEM_PATH_PATTERN.test(value);
}

/** True when a path argument climbs out of the workspace. */
function escapesWorkspace(value: string): boolean {
  return value.split(/[\\/]/).includes('..');
}

function blocked(reason: string): CommandPolicyResult {
  return {classification: 'block', reason};
}

function strongConfirm(reason: string): CommandPolicyResult {
  return {classification: 'strong-confirm', reason};
}

/** Normalized form used for allowlist and denylist matching. */
function commandKey(request: CommandRequest): string {
  return [request.command, ...(request.args ?? [])].join(' ');
}

/** Supports an exact match, or a `prefix *` wildcard. */
function matchesPattern(key: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith('*')) {
    return key.startsWith(trimmed.slice(0, -1).trimEnd());
  }
  return key === trimmed;
}

function classifyRemoval(command: string, flags: Set<string>): CommandPolicyResult {
  const recursive = hasFlag(flags, '-r', '--recursive', '/s');
  const forced = hasFlag(flags, '-f', '--force', '/q');
  if (recursive || forced) {
    return blocked(`${command} 携带递归或强制删除参数，可能删除大量文件且无法恢复。`);
  }
  return {classification: 'confirm', reason: `${command} 会删除文件。`};
}

function classifyGit(args: readonly string[], flags: Set<string>): CommandPolicyResult | null {
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
  return null;
}

function classifyPermissionChange(command: string, args: readonly string[], flags: Set<string>) {
  if (!hasFlag(flags, '-r', '-R', '--recursive')) {
    return null;
  }
  const targets = positionals(args).slice(1);
  const dangerous = targets.find((target) => looksLikeSystemPath(target) || escapesWorkspace(target));
  if (dangerous) {
    return blocked(`${command} -R 指向工作区之外的路径（${dangerous}），可能破坏系统权限。`);
  }
  return strongConfirm(`${command} -R 会递归修改权限，影响范围可能超出预期。`);
}

function classifyGlobalInstall(command: string, args: readonly string[], flags: Set<string>) {
  if (!PACKAGE_MANAGERS.has(command)) {
    return null;
  }
  const isGlobal = hasFlag(flags, '-g', '--global')
    || positionals(args).includes('global')
    || (command.startsWith('pip') && hasFlag(flags, '--user'));
  if (!isGlobal) {
    return null;
  }
  return strongConfirm(`${command} 正在进行全局安装，会修改工作区之外的系统状态。`);
}

function classifyMigration(command: string, args: readonly string[]) {
  const tokens = positionals(args);
  const isMigrationTool = MIGRATION_TOOLS.has(command)
    || tokens.some((token) => MIGRATION_TOOLS.has(token));
  if (!isMigrationTool) {
    return null;
  }

  const destructive = tokens.find((token) => DESTRUCTIVE_MIGRATION_TOKENS.has(token));
  if (destructive) {
    return blocked(`数据库迁移命令包含破坏性操作（${destructive}），可能丢失数据。`);
  }

  const forward = tokens.find((token) => FORWARD_MIGRATION_TOKENS.has(token));
  if (forward) {
    return strongConfirm('数据库迁移会修改数据库结构，且通常难以回退。');
  }
  return null;
}

/**
 * Built-in classification. Deliberately independent of user config so the hard
 * gate in runCommand() cannot be widened by a config file.
 */
function classifyBuiltin(request: CommandRequest): CommandPolicyResult {
  const command = request.command.toLowerCase();
  const args = request.args ?? [];
  const flags = normalizeFlags(args);

  if (DESTRUCTIVE_SYSTEM_COMMANDS.has(command)) {
    return blocked(`${command} 会直接操作磁盘或系统电源状态。`);
  }

  if (FILE_REMOVAL_COMMANDS.has(command)) {
    return classifyRemoval(command, flags);
  }

  if (command === 'git') {
    const git = classifyGit(args, flags);
    if (git) return git;
  }

  if (command === 'chmod' || command === 'chown' || command === 'icacls') {
    const permission = classifyPermissionChange(command, args, flags);
    if (permission) return permission;
  }

  const globalInstall = classifyGlobalInstall(command, args, flags);
  if (globalInstall) return globalInstall;

  const migration = classifyMigration(command, args);
  if (migration) return migration;

  return {classification: 'allow'};
}

/**
 * Classifies a command, optionally consulting a user allowlist and denylist.
 *
 * Precedence: denylist, then the built-in blacklist, then the allowlist, then
 * the remaining built-in rules. An allowlist entry can downgrade a `confirm` or
 * `strong-confirm` to `allow`, but **cannot** override a built-in `block` — the
 * point of a block is that no config file makes it reachable.
 */
export function classifyCommand(
  request: CommandRequest,
  options: CommandPolicyOptions = {}
): CommandPolicyResult {
  const key = commandKey(request);

  const denied = options.denylist?.find((pattern) => matchesPattern(key, pattern));
  if (denied) {
    return blocked(`命令匹配配置中的 denylist 规则：${denied}`);
  }

  const builtin = classifyBuiltin(request);
  if (builtin.classification === 'block') {
    return builtin;
  }

  if (builtin.classification !== 'allow') {
    const allowed = options.allowlist?.find((pattern) => matchesPattern(key, pattern));
    if (allowed) {
      return {classification: 'allow'};
    }
  }

  return builtin;
}
