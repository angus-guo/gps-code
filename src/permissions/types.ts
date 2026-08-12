/**
 * `strong-confirm` requires the user to retype the command rather than answer
 * `y`, for operations that are legitimate but expensive to undo.
 */
export type CommandClassification = 'allow' | 'confirm' | 'strong-confirm' | 'block';

export type CommandPolicyOptions = {
  /** Exact command lines, or `prefix *`, that downgrade a confirm to allow. */
  allowlist?: string[];
  /** Exact command lines, or `prefix *`, that are always refused. */
  denylist?: string[];
};

export type PermissionMode = 'default-confirm' | 'auto-accept-edits' | 'read-only' | 'plan';

export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default-confirm',
  'auto-accept-edits',
  'read-only',
  'plan'
];

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  'default-confirm': '默认确认模式',
  'auto-accept-edits': '自动接受编辑模式',
  'read-only': '只读模式',
  plan: '计划模式'
};

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
  'default-confirm': '命令和编辑都需要你确认',
  'auto-accept-edits': '命令需要确认，编辑自动应用',
  'read-only': '拒绝所有命令和编辑，只做只读分析',
  plan: '拒绝所有命令和编辑，只做方案规划'
};

export function isPermissionMode(value: string): value is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(value);
}

export type CommandPolicyResult = {
  classification: CommandClassification;
  reason?: string;
};

export type CommandProposalDecision = {
  action: 'confirm' | 'strong-confirm' | 'reject';
  reason?: string;
};

export type EditProposalDecision = {
  action: 'confirm' | 'auto-apply' | 'reject';
  reason?: string;
};
